import { emailDomain, isPersonalEmail } from './extractors.js';
import type { SourceFinding } from './dossier.js';
import type { EvidenceAccessLevel } from '../types.js';

/**
 * Email map — Stage 2 extraction. Collects EVERY email found across the official
 * site + supporting sources (visible text AND mailto links), then classifies each
 * into one of four buckets, associating it with a staff member when possible.
 * Nothing is discarded: an unmatchable personal address is preserved as
 * "unassigned", not dropped (it just never becomes the church office email).
 *
 *   person     — matched to a named staff member (by local-part or adjacency)
 *   role       — a functional mailbox (giving@, missions@, kids@, students@…)
 *   church     — a general church mailbox (info@, office@, contact@, hello@…)
 *   unassigned — everything else (incl. personal webmail we couldn't attribute)
 */

export type EmailBucket = 'person' | 'role' | 'church' | 'unassigned';

export interface EmailRecord {
  email: string;
  source_url: string;
  access_level: EvidenceAccessLevel;
  near: string;                 // surrounding text (for person adjacency)
}
export interface ClassifiedEmail extends EmailRecord {
  bucket: EmailBucket;
  person: string | null;        // matched staff name
  role_hint: string | null;     // info / giving / missions / …
  confidence: number;
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// A general "the church" mailbox (no specific person/function).
const CHURCH_GENERAL = /^(info|office|contact|hello|hi|welcome|admin|administration|church|mail|general|reception|frontdesk|secretary)\b/i;
// A functional/ministry mailbox.
const ROLE_FUNCTIONAL = /^(giving|give|donate|donations?|finance|missions?|outreach|global|kids?|children'?s?|students?|youth|nextgen|next|groups?|connect|connections?|prayer|care|worship|music|media|comms?|communications?|marketing|events?|weddings?|facilities|hr|jobs?|careers?|volunteer|serve|guest|hospitality|pastor|pastors?|staff|leadership)\b/i;

export function hostOf(url: string | null | undefined): string {
  if (!url) return '';
  try { return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, '').toLowerCase(); }
  catch { return ''; }
}

function addEmail(map: Map<string, EmailRecord>, raw: string, url: string, access: EvidenceAccessLevel, near: string): void {
  const email = raw.trim().toLowerCase().replace(/[.,;:)\]]+$/, '');
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) return;
  if (/\.(png|jpg|jpeg|gif|webp|svg|css|js)$/i.test(email)) return; // sprite/asset false-positives
  const existing = map.get(email);
  // keep the highest-access source (live official site beats a snippet)
  if (!existing || ACCESS_RANK(access) > ACCESS_RANK(existing.access_level)) {
    map.set(email, { email, source_url: url, access_level: access, near: (near || '').slice(0, 160) });
  }
}
const ACCESS_ORDER: EvidenceAccessLevel[] = ['vendor_reference', 'search_snippets', 'social_profile', 'job_posting', 'third_party_directory', 'staff_profile', 'live_official_site', 'user_provided_ground_truth'];
const ACCESS_RANK = (a: EvidenceAccessLevel) => ACCESS_ORDER.indexOf(a);

/** Collect every email from all findings (visible text + structured mailto fields). */
export function collectEmails(findings: SourceFinding[]): EmailRecord[] {
  const map = new Map<string, EmailRecord>();
  for (const f of findings) {
    const text = `${f.title ?? ''} ${(f.fetched ? f.text : f.snippet) ?? ''}`;
    for (const field of f.fields ?? []) {
      if (field.field_name === 'email' && field.value) addEmail(map, String(field.value), f.url, f.accessLevel, field.evidence_text ?? '');
    }
    let m: RegExpExecArray | null;
    EMAIL_RE.lastIndex = 0;
    while ((m = EMAIL_RE.exec(text)) !== null) {
      const start = Math.max(0, m.index - 70);
      addEmail(map, m[0], f.url, f.accessLevel, text.slice(start, m.index + m[0].length + 30));
    }
  }
  return [...map.values()];
}

/** Match an email LOCAL-PART to a staff name (strong signal: jeff.bogue, jbogue, bogue). */
function matchPersonLocal(local: string, staffNames: string[]): string | null {
  for (const name of staffNames) {
    const parts = name.toLowerCase().split(/\s+/).filter(Boolean);
    if (parts.length < 2) continue;
    const first = parts[0], last = parts[parts.length - 1];
    const patterns = new Set([`${first}.${last}`, `${first}${last}`, `${first}_${last}`, `${first[0]}${last}`, `${first}${last[0]}`, last]);
    if (patterns.has(local)) return name;
    if (last.length >= 4 && local.includes(last)) return name;
  }
  return null;
}
/**
 * Match a staff name appearing in the surrounding text (weaker — a nearby card).
 * Gated by local-part CONSISTENCY: if the local-part contains a name-like run
 * (≥4 letters) that isn't part of the adjacent name, it's a DIFFERENT person
 * (e.g. "dhiggins@" sitting next to "Jennifer Brumit") → do NOT attribute it.
 * Short/initials local-parts (e.g. "md@") are ambiguous, so adjacency is trusted.
 */
function matchPersonAdjacency(local: string, near: string, staffNames: string[]): string | null {
  const nearL = near.toLowerCase();
  const runs = local.match(/[a-z]{4,}/g) ?? [];
  for (const name of staffNames) {
    if (name.length < 5 || !nearL.includes(name.toLowerCase())) continue;
    const compact = name.toLowerCase().replace(/[^a-z]/g, '');
    if (runs.every((r) => compact.includes(r))) return name; // consistent (or no long runs)
  }
  return null;
}

export function classifyEmail(rec: EmailRecord, staffNames: string[], officialDomain: string): ClassifiedEmail {
  const local = rec.email.split('@')[0];
  const onDomain = !!officialDomain && emailDomain(rec.email) === officialDomain;
  // 1) strong: the local-part IS a person's name.
  const byLocal = matchPersonLocal(local, staffNames);
  if (byLocal) return { ...rec, bucket: 'person', person: byLocal, role_hint: null, confidence: onDomain ? 82 : 66 };
  // 2) a functional/general mailbox — classify BEFORE name-adjacency so a generic
  //    "giving@" near a staff card isn't mis-attributed to that person.
  const roleM = local.match(ROLE_FUNCTIONAL);
  if (roleM && !CHURCH_GENERAL.test(local)) return { ...rec, bucket: 'role', person: null, role_hint: roleM[1], confidence: onDomain ? 70 : 52 };
  if (CHURCH_GENERAL.test(local)) return { ...rec, bucket: 'church', person: null, role_hint: local.replace(/[._-].*$/, ''), confidence: onDomain ? 76 : 54 };
  // 3) weaker: a staff name sits next to the address in the page text.
  const byAdj = matchPersonAdjacency(local, rec.near, staffNames);
  if (byAdj) return { ...rec, bucket: 'person', person: byAdj, role_hint: null, confidence: onDomain ? 68 : 50 };
  // 4) unmatched: personal webmail or an unknown same-domain mailbox — preserved, not dropped
  return { ...rec, bucket: 'unassigned', person: null, role_hint: isPersonalEmail(rec.email) ? 'personal webmail' : (onDomain ? 'church domain, unattributed' : null), confidence: 32 };
}

/** Build the full classified email map for a church. */
export function buildEmailMap(findings: SourceFinding[], staffNames: string[], officialDomain: string): ClassifiedEmail[] {
  return collectEmails(findings).map((r) => classifyEmail(r, staffNames, officialDomain));
}
