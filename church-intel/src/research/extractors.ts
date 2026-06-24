import { roleFromTitle, stripHonorific, isPersonName } from './staffCards.js';
import { isChurchCenterUrl } from './digitalSignals.js';
import type { SourceFinding } from './dossier.js';
import type { EvidenceAccessLevel } from '../types.js';

export interface Fact {
  value: string | number | boolean;
  confidence: number;
  evidence: string;
  source_url: string;
  access_level: EvidenceAccessLevel;
}
export type Facts = Record<string, Fact>;

const CURRENT_YEAR = new Date().getFullYear();
const NAME = `([A-Z][a-z]+(?:\\s+[A-Z]\\.?)?\\s+[A-Z][a-z]+)`;
const PHONE = /\(?\b\d{3}\)?[ .\-]\d{3}[ .\-]\d{4}\b/;
const NUMWORD: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

function num(token: string): number | null {
  const t = token.toLowerCase();
  if (t in NUMWORD) return NUMWORD[t];
  const n = parseInt(t, 10);
  return Number.isFinite(n) ? n : null;
}

// ── individual extractors (return {value, confidence, ev} or null) ──────────
function foundedYear(text: string): { year: number; confidence: number; ev: string } | null {
  const explicit = text.match(/\b(?:began|founded|established|planted|started|est\.?|since)\s+(?:in\s+)?((?:18|19|20)\d{2})\b/i);
  if (explicit) {
    const y = parseInt(explicit[1], 10);
    if (y > 1800 && y <= CURRENT_YEAR) return { year: y, confidence: 70, ev: explicit[0] };
  }
  // anniversary: "celebrated 40 years" + a nearby year → founded = year - N
  const anniv = text.match(/celebrat\w*\s+(\d{1,3})\s+years/i) || text.match(/(\d{1,3})(?:th|st|nd|rd)?\s+anniversary/i);
  const yearM = text.match(/\bin\s+((?:19|20)\d{2})\b/i) || text.match(/\b((?:19|20)\d{2})\b/);
  if (anniv && yearM) {
    const n = parseInt(anniv[1], 10);
    const y = parseInt(yearM[1], 10) - n;
    if (n > 1 && n < 200 && y > 1800 && y <= CURRENT_YEAR) return { year: y, confidence: 64, ev: `${anniv[0]} (${yearM[0]})` };
  }
  return null;
}

function campus(text: string): { count: number | null; multi: boolean | null; confidence: number; ev: string } | null {
  const explicit = text.match(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:campuses|locations|sites)\b/i);
  if (explicit) {
    const c = num(explicit[1]);
    if (c != null) return { count: c, multi: c > 1, confidence: 65, ev: explicit[0] };
  }
  if (/\b(?:one|single)\s+(?:location|campus|site)\b/i.test(text)) return { count: 1, multi: false, confidence: 55, ev: 'single location' };
  if (/\bmulti-?site\b|\ball (?:our )?(?:campuses|locations)\b|\bother locations\b|\bcampus pastor\b/i.test(text)) return { count: null, multi: true, confidence: 55, ev: 'multisite language' };
  return null;
}

function staffCount(text: string): { count: number; confidence: number; ev: string } | null {
  const m = text.match(/\bteam of\s+(\d+)\b/i) || text.match(/\b(\d+)\s+(?:full-?time\s+)?(?:staff|team members|employees)\b/i);
  if (m) {
    const n = parseInt(m[1], 10);
    if (n > 0 && n < 2000) return { count: n, confidence: 58, ev: m[0] };
  }
  return null;
}

/**
 * Deterministically detect a PUBLICLY STATED (reported) attendance number, so the
 * dossier can distinguish a reported fact from an inferred estimate. Conservative
 * patterns that require explicit attendance language (never a stray number).
 */
export function reportedAttendance(text: string): { value: number; confidence: number; ev: string } | null {
  const pats = [
    /\b(?:average|avg\.?|weekly|weekend|sunday)\s+attendance\s*(?:of|is|:|=|—|–|at)?\s*(?:about|around|approximately|roughly|~)?\s*([\d,]{2,7})\b/i,
    /\b(?:attendance|congregation|worshipers?|attendees?)\s+of\s+(?:about|around|approximately|roughly|~)?\s*([\d,]{2,7})\b/i,
    /\b([\d,]{2,7})\s+(?:people|members|attendees|worshipers?)\s+(?:attend|gather|worship|each|every)\b/i,
    /\b(?:we (?:average|run)|averaging|running|draws?|sees?)\s+(?:about|around|approximately|roughly|~)?\s*([\d,]{2,7})\b\s*(?:people|in attendance|on sundays?|each weekend|weekly|every week)/i,
  ];
  for (const re of pats) {
    const m = text.match(re);
    if (m) {
      const n = parseInt(m[1].replace(/,/g, ''), 10);
      if (n >= 10 && n <= 100000) return { value: n, confidence: 85, ev: m[0].replace(/\s+/g, ' ').slice(0, 90) };
    }
  }
  return null;
}

function giving(text: string, url: string): { confidence: number; ev: string; provider: string | null } | null {
  const hay = `${text} ${url}`.toLowerCase();
  const present = /\b(give online|online giving|give now|donate|giving|ways to give)\b/.test(hay) || /\/give|\/giving|\/donate/.test(url);
  if (!present) return null;
  const provider =
    /pushpay/.test(hay) ? 'Pushpay'
    : /tithe\.?ly|tithely/.test(hay) ? 'Tithe.ly'
    : /subsplash/.test(hay) ? 'Subsplash'
    : /givelify/.test(hay) ? 'Givelify'
    : /easytithe/.test(hay) ? 'EasyTithe'
    : /planning\s?center|churchcenter/.test(hay) ? 'Planning Center Giving'
    : null;
  return { confidence: 60, ev: 'online giving referenced', provider };
}

function appInfo(text: string, url: string): { status: string; provider: string | null; confidence: number; ev: string } | null {
  const hay = `${text} ${url}`.toLowerCase();
  const storeLink = /apps\.apple\.com|play\.google\.com\/store\/apps/.test(hay);
  const appWord = /\b(our|the)\s+(mobile\s+)?app\b|download our app/.test(hay);
  if (storeLink || appWord) {
    const provider =
      /subsplash|thechurchapp/.test(hay) ? 'Subsplash'
      : /churchcenter|planning\s?center/.test(hay) ? 'Church Center'
      : /tithe\.?ly/.test(hay) ? 'Tithe.ly'
      : /pushpay/.test(hay) ? 'Pushpay' : null;
    return { status: 'active', provider, confidence: storeLink ? 70 : 55, ev: 'app reference' };
  }
  if (/\bno (?:mobile )?app\b/.test(hay)) return { status: 'none_found', provider: null, confidence: 55, ev: 'no app stated' };
  return null;
}

function findRole(text: string, roleSource: string): { name: string; ev: string } | null {
  const patterns = [
    new RegExp(`${NAME}\\s+(?:is\\s+(?:the|our)\\s+|serves as\\s+(?:the|our)\\s+)?${roleSource}`, 'i'),
    new RegExp(`${roleSource}[\\s:,\\-–|]+${NAME}`, 'i'),
    new RegExp(`${NAME}[\\s,\\-–|]+(?:${roleSource})`, 'i'),
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return { name: m[1].trim(), ev: m[0].slice(0, 80) };
  }
  return null;
}

// Free/personal webmail providers. An address on one of these is an INDIVIDUAL's
// personal inbox (e.g. an elder's gmail scraped from a mailto), NOT the church's
// organizational address — recording it as office_email is both wrong and a
// privacy problem. Allowed only when the local part is clearly a role mailbox
// (e.g. gracechurchoffice@gmail.com), which small churches do legitimately use.
const FREE_MAIL = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'rocketmail.com', 'hotmail.com',
  'outlook.com', 'live.com', 'msn.com', 'aol.com', 'icloud.com', 'me.com', 'mac.com',
  'comcast.net', 'sbcglobal.net', 'att.net', 'verizon.net', 'cox.net', 'bellsouth.net',
  'proton.me', 'protonmail.com', 'gmx.com', 'mail.com', 'zoho.com',
]);
const ROLE_MAILBOX = /^(info|connect|hello|office|contact|admin|church|welcome|hi|team|reception|frontdesk|general|secretary)\b/i;
export function emailDomain(e: string): string { return e.split('@')[1]?.toLowerCase() ?? ''; }
/** True for a personal free-webmail address that is NOT a role mailbox. */
export function isPersonalEmail(e: string): boolean {
  return FREE_MAIL.has(emailDomain(e)) && !ROLE_MAILBOX.test(e);
}

function officeEmail(text: string): { value: string; confidence: number; ev: string } | null {
  const emails = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g);
  if (!emails) return null;
  // 1) role mailbox on an organizational domain (info@church.org) — best.
  const orgRole = emails.find((e) => ROLE_MAILBOX.test(e) && !FREE_MAIL.has(emailDomain(e)));
  if (orgRole) return { value: orgRole, confidence: 65, ev: orgRole };
  // 2) any organizational-domain address (church-controlled, even if a person's).
  const org = emails.find((e) => !FREE_MAIL.has(emailDomain(e)));
  if (org) return { value: org, confidence: 50, ev: org };
  // 3) a role mailbox on free webmail (small church's own gmail) — acceptable, low.
  const roleFree = emails.find((e) => ROLE_MAILBOX.test(e));
  if (roleFree) return { value: roleFree, confidence: 40, ev: roleFree };
  // 4) only personal individual webmail present → do NOT record it as office email.
  return null;
}

/** Structured finding.field names → fact keys folded in as fallback candidates. */
const STRUCTURED_FACT_MAP: Record<string, string> = {
  email: 'office_email',
  phone: 'office_phone',
  lead_pastor: 'lead_pastor',
  executive_pastor: 'executive_pastor',
  discipleship_pastor: 'discipleship_pastor',
  operations_leader: 'operations_leader',
  marketing_director: 'marketing_director',
  communications_leader: 'communications_leader',
  staff_count: 'staff_count',
};

const ROLE_RE: { field: string; source: string }[] = [
  { field: 'lead_pastor', source: `(?:lead|senior)\\s+pastor` },
  { field: 'executive_pastor', source: `executive\\s+(?:pastor|director)` },
  { field: 'discipleship_pastor', source: `(?:discipleship|next\\s*steps)\\s+(?:pastor|director|minister|lead)` },
  { field: 'operations_leader', source: `(?:director of operations|operations\\s+(?:director|pastor|manager|lead))` },
  { field: 'marketing_director', source: `(?:marketing|digital)\\s+(?:director|pastor|lead|manager|coordinator|strategist)` },
  { field: 'communications_leader', source: `(?:communications|comms|creative|media)\\s+(?:director|pastor|lead|manager|coordinator)` },
];

/**
 * Deterministic extraction over the gathered evidence. Each fact records the
 * source URL + access level so the dossier caps its confidence accordingly.
 * The best (reliability × confidence) value per field wins. Emails are only
 * recorded if they literally appear in the text (never invented).
 */
export function extractFacts(findings: SourceFinding[]): Facts {
  const best: Record<string, { fact: Fact; score: number }> = {};
  const consider = (f: SourceFinding, field: string, value: Fact['value'] | null, confidence: number, evidence: string) => {
    if (value === null || value === undefined || value === '') return;
    const score = f.reliability * confidence;
    if (!best[field] || score > best[field].score) {
      best[field] = { fact: { value, confidence, evidence: evidence.slice(0, 160), source_url: f.url, access_level: f.accessLevel }, score };
    }
  };

  for (const f of findings) {
    const text = `${f.title ?? ''} ${(f.fetched ? f.text : f.snippet) ?? ''}`.replace(/\s+/g, ' ').trim();
    if (!text) continue;

    const fy = foundedYear(text);
    if (fy) { consider(f, 'founded_year', fy.year, fy.confidence, fy.ev); consider(f, 'years_active', CURRENT_YEAR - fy.year, fy.confidence, fy.ev); }

    const cp = campus(text);
    if (cp) { if (cp.count != null) consider(f, 'campus_count', cp.count, cp.confidence, cp.ev); if (cp.multi != null) consider(f, 'multi_site', cp.multi, cp.confidence, cp.ev); }

    const sc = staffCount(text);
    if (sc) consider(f, 'staff_count', sc.count, sc.confidence, sc.ev);

    // Reported (publicly stated) attendance — kept distinct from inferred estimates.
    const ra = reportedAttendance(text);
    if (ra) consider(f, 'reported_attendance', ra.value, ra.confidence, ra.ev);

    const gv = giving(text, f.url);
    if (gv) { consider(f, 'online_giving_present', true, gv.confidence, gv.ev); if (gv.provider) consider(f, 'giving_provider', gv.provider, 55, gv.ev); }

    const ap = appInfo(text, f.url);
    if (ap) { consider(f, 'app_status', ap.status, ap.confidence, ap.ev); if (ap.provider) consider(f, 'app_provider', ap.provider, ap.confidence, ap.ev); }

    for (const { field, source } of ROLE_RE) {
      const r = findRole(text, source);
      if (r) consider(f, field, r.name, 55, r.ev);
    }
    const em = officeEmail(text);
    if (em) consider(f, 'office_email', em.value, em.confidence, em.ev);
    const ph = text.match(PHONE);
    if (ph) consider(f, 'office_phone', ph[0], 55, text.slice(0, 120));

    // Fallback: fold the crawler's STRUCTURED fields (mailto/tel links and
    // rendered staff cards) into the corresponding facts. Many sites expose
    // contacts only as mailto:/tel: hrefs, and staff names/titles only in the
    // JS-rendered DOM, so the literal values never appear in the plain text.
    // consider() keeps the best reliability × confidence, so a higher-confidence
    // text-derived fact is never overwritten, and the finding's source_url /
    // access_level / confidence are preserved.
    for (const field of f.fields) {
      if (field.value == null || field.value === '') continue;
      const target = STRUCTURED_FACT_MAP[field.field_name];
      if (!target) continue;
      const value = target === 'staff_count' ? Number(field.value) : String(field.value);
      if (target === 'staff_count' && !Number.isFinite(value as number)) continue;
      // Never let a mailto: to an individual's personal webmail become the church
      // office email (the leaders-page elders' gmail problem).
      if (target === 'office_email' && isPersonalEmail(String(value))) continue;
      consider(f, target, value, field.confidence, field.evidence_text || String(field.value));
    }

    // Church Center URL → structured Planning Center / Church Center platform facts.
    // (Supporting platform evidence; never identity ownership — see digitalSignals.)
    if (isChurchCenterUrl(f.url)) {
      const t = `${f.title ?? ''} ${(f.fetched ? f.text : f.snippet) ?? ''} ${f.url}`;
      consider(f, 'app_status', 'active', 80, 'Church Center (Planning Center) instance');
      consider(f, 'app_provider', 'Church Center / Planning Center', 80, f.url);
      consider(f, 'church_management_platform', 'Planning Center', 80, `Church Center URL: ${f.url}`);
      if (/\bgive\b/i.test(t)) consider(f, 'online_giving_present', true, 70, 'Church Center Give');
      if (/\bgroups?\b/i.test(t)) consider(f, 'groups_platform_present', true, 70, 'Church Center Groups');
      if (/\bcalendar\b/i.test(t)) consider(f, 'calendar_platform_present', true, 70, 'Church Center Calendar');
    }
  }

  const out: Facts = {};
  for (const [k, v] of Object.entries(best)) out[k] = v.fact;
  return out;
}

/**
 * TEMPORARY INSTRUMENTATION (no behavior change). Per-finding trace showing what
 * the extractFacts regexes see vs. what the crawler captured into finding.fields.
 * Used by buildDossier when DOSSIER_DEBUG is set; safe to delete.
 */
export function debugExtractionTrace(findings: SourceFinding[]): string[] {
  const lines: string[] = [];
  for (const f of findings) {
    const text = `${f.title ?? ''} ${(f.fetched ? f.text : f.snippet) ?? ''}`.replace(/\s+/g, ' ').trim();
    const lp = findRole(text, ROLE_RE[0].source);
    const titleHit = /\b(lead|senior|associate|executive|founding)\s+pastor\b/i.test(text);
    const em = officeEmail(text);
    const ph = text.match(PHONE);
    const structuredEmail = f.fields.filter((x) => x.field_name === 'email').map((x) => x.value);
    const structuredPhone = f.fields.filter((x) => x.field_name === 'phone').map((x) => x.value);
    lines.push(`  • [${f.fetched ? 'FETCH' : 'snip '}] ${f.sourceType} ${f.url}`);
    lines.push(`      textLen=${text.length}`);
    lines.push(`      regex-over-text: lead_pastor=${lp ? JSON.stringify(lp.name) : '—'} pastorTitle=${titleHit ? 'Y' : 'N'} email=${em ? em.value : '—'} phone=${ph ? ph[0] : '—'}`);
    lines.push(`      finding.fields: [${f.fields.map((x) => x.field_name).join(', ') || 'none'}]  mailto-field=${structuredEmail.join('|') || '—'}  tel-field=${structuredPhone.join('|') || '—'}`);
  }
  return lines;
}

// ── leadership evidence aggregation ──────────────────────────────────────────
/**
 * A single leader candidate, with full provenance. Unlike the single-valued
 * `lead_pastor` fact, this preserves EVERY pastor/leader found across staff pages
 * and snippets, supporting co-lead pastors and multiple lead pastors.
 */
export interface LeaderCandidate {
  name: string;
  title: string;
  role: string;       // lead_pastor | executive_pastor | operations_leader | communications_leader | pastor | leader
  isLead: boolean;    // lead / senior / co-lead / co-pastor (a senior leader of the church)
  sourceUrl: string;
  confidence: number;
  evidence: string;
}

// Titles that denote a (co-)lead pastor of the church.
const LEAD_TITLE_RE = /\b(?:co[\s-]?lead|lead|senior)\s+pastors?\b|\bco[\s-]?pastors?\b/i;
const PASTOR_TITLE_TXT = '((?:co[ -]?)?(?:lead|senior|associate|executive|founding)\\s+pastors?|co[ -]?pastors?)';

/** Find "Name — Lead Pastor" / "Lead Pastor: Name" style mentions (all matches). */
function findLeadersInText(text: string): { name: string; title: string }[] {
  const out: { name: string; title: string }[] = [];
  // Separator is a comma/dash/pipe/colon or " is/serves as " — a SPACED dash only,
  // so an intra-word hyphen (e.g. the "-" in "Co-Lead") is never split off a name.
  const nameThenTitle = new RegExp(`${NAME}\\s*(?:[—–,|:]|\\s-\\s|\\s+(?:is|are|serves?\\s+as)\\s+(?:the|our|a|co-?)?\\s*)\\s*${PASTOR_TITLE_TXT}`, 'gi');
  const titleThenName = new RegExp(`${PASTOR_TITLE_TXT}[\\s:—–|]+${NAME}`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = nameThenTitle.exec(text)) !== null) out.push({ name: m[1].trim(), title: m[2].trim() });
  while ((m = titleThenName.exec(text)) !== null) out.push({ name: m[2].trim(), title: m[1].trim() });
  return out;
}

/**
 * Aggregate ALL pastor/leader candidates across the dossier (staff cards first,
 * then text mentions), deduped by person. Does NOT let the first match win —
 * returns every leader, with co-lead/lead pastors flagged. Leads sorted first.
 */
// Capitalized stop-words that signal a prose fragment, not a person ("of Our",
// "and leads"). Used to reject text-extracted "names".
const NAME_STOPWORDS = new Set(['of', 'and', 'the', 'our', 'a', 'an', 'in', 'on', 'at', 'to', 'for', 'with', 'as', 'is', 'are', 'his', 'her', 'their', 'we', 'us', 'you', 'by', 'from']);
function escapeRe(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/**
 * Resolve a text-extracted name to a real person. Drops prose fragments; maps a
 * lone given name to a full name already known from staff cards (the roster).
 */
function resolvePerson(rawName: string, roster: Map<string, string>): string | null {
  const name = stripHonorific(rawName).replace(/\s+/g, ' ').trim();
  const toks = name.split(' ').filter(Boolean);
  if (!toks.length || toks.some((t) => NAME_STOPWORDS.has(t.toLowerCase()))) return null;
  if (toks.length >= 2) return name;                       // a plausible full name
  return roster.get(toks[0].toLowerCase()) ?? null;        // given-only → roster full name
}

const LEAD_TITLE_GROUP = '(co[\\s-]?lead\\s+pastors?|co[\\s-]?pastors?|lead\\s+pastors?|senior\\s+pastors?)';

// Reject non-person "names" the staff-card parser sometimes captures (nav buttons
// like "Contact Bethany", the church's own name, or a service-times blurb).
const NON_PERSON_FIRST = /^(contact|connect|visit|give|giving|welcome|meet|join|our|plan|new|home|about|learn|the|sunday|saturday|service|staff|team|leadership)\b/i;
const NON_PERSON_CONTAINS = /\b(church|communities|community|ministries|ministry|gatherings?|worship|fellowship|campus|baptist|chapel)\b/i;
function isLikelyPersonName(name: string): boolean {
  if (/[0-9@]/.test(name) || /\b(a\.?m\.?|p\.?m\.?)\b/i.test(name)) return false;   // times / emails / numbers
  if (NON_PERSON_FIRST.test(name) || NON_PERSON_CONTAINS.test(name)) return false;   // nav text / org name
  if (/^(read|learn|see|click|more|details)\b/i.test(name) || !isPersonName(name)) return false; // nav buttons / ministry labels
  return true;
}

export function aggregateLeadership(findings: SourceFinding[]): LeaderCandidate[] {
  const byName = new Map<string, LeaderCandidate>();
  const consider = (rawName: string, title: string, sourceUrl: string, baseConf: number, evidence: string) => {
    const name = stripHonorific(rawName).replace(/\s+/g, ' ').trim();
    if (name.length < 3 || !isLikelyPersonName(name)) return;
    const isLead = LEAD_TITLE_RE.test(title);
    const role = roleFromTitle(title)?.field ?? (/pastor/i.test(title) ? 'pastor' : 'leader');
    const conf = isLead ? Math.max(baseConf, 70) : baseConf;
    const key = name.toLowerCase();
    const ex = byName.get(key);
    if (!ex) {
      byName.set(key, { name, title: title.trim(), role, isLead, sourceUrl, confidence: conf, evidence });
    } else {
      const wasLead = LEAD_TITLE_RE.test(ex.title);
      ex.isLead = ex.isLead || isLead;
      // Prefer higher-confidence evidence, but always surface a lead/co title.
      if (conf > ex.confidence || (isLead && !wasLead)) {
        ex.confidence = Math.max(ex.confidence, conf);
        ex.title = title.trim(); ex.role = role; ex.sourceUrl = sourceUrl; ex.evidence = evidence;
      }
    }
  };

  // PHASE 1 — staff cards (authoritative; paired names already expanded to 2).
  for (const f of findings) {
    const rel = f.reliability ?? 0.5;
    for (const card of f.staffCards ?? []) {
      consider(card.name, card.title, f.url, Math.round(rel * 80), `Staff card: ${card.name} — ${card.title}`);
    }
  }
  // Roster of known people (given name → full name) from the cards.
  const roster = new Map<string, string>();
  for (const l of byName.values()) {
    const first = l.name.split(' ')[0].toLowerCase();
    if (first.length >= 2 && !roster.has(first)) roster.set(first, l.name);
  }

  // PHASE 2 — prose evidence (ALWAYS runs, even when cards exist), merged in.
  for (const f of findings) {
    const rel = f.reliability ?? 0.5;
    const text = `${f.title ?? ''} ${(f.fetched ? f.text : f.snippet) ?? ''}`.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    // (a) full-name "Name — Title" mentions, sanitized + roster-resolved.
    for (const lc of findLeadersInText(text)) {
      const person = resolvePerson(lc.name, roster);
      if (person) consider(person, lc.title, f.url, Math.round(rel * 70), lc.title);
    }
    // (b) given-name BIO mentions for KNOWN roster people (e.g. "Jennifer serves
    // ... as Co-Pastor"). Requires a bio connective (is/as/serves as) between the
    // name and the title, so a collapsed staff-card adjacency ("Jennifer Zirkle
    // Lead Pastor") is NOT mis-attributed. Bounded to the roster → no garbage.
    for (const [given, full] of roster) {
      // Bio verb must IMMEDIATELY follow the given name ("Jennifer serves…",
      // "Dan is…"); a staff-card adjacency ("Jennifer Zirkle Lead Pastor") has a
      // surname (not a verb) next, so it won't bridge into the next person's bio.
      const re = new RegExp(`\\b${escapeRe(given)}\\s+(?:is|are|was|serves?|serving|served|leads?|leading|also|currently|now|has|have|joined|became|stepped)\\b[\\s\\S]{0,50}?\\b${LEAD_TITLE_GROUP}\\b`, 'i');
      const m = text.match(re);
      if (m) consider(full, m[1], f.url, Math.round(rel * 68), m[0].slice(0, 160));
    }
  }
  return [...byName.values()].sort((a, b) => (Number(b.isLead) - Number(a.isLead)) || (b.confidence - a.confidence));
}

/** The (co-)lead pastors among aggregated leaders. */
export function leadPastors(leaders: LeaderCandidate[]): LeaderCandidate[] {
  return leaders.filter((l) => l.isLead);
}
