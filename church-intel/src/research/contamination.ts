import { hostOf } from './emailMap.js';
import type { DiscoveryResult } from './discovery.js';
import type { NormalizedEvidence, Interpretation } from './evidenceModel.js';

/**
 * Contamination ENFORCEMENT.
 *
 * Discovery already DETECTS same-name churches in a different city/state
 * (candidates with `cityStatus === 'conflict'`). Historically that produced only
 * advisory text flags, so the contaminated evidence still flowed into leader /
 * contact / email extraction and surfaced in the dossier.
 *
 * This module turns that detection into enforcement: it builds the set of
 * contaminated SOURCES (hosts/urls) and removes any relationship evidence that
 * came from them — so contaminated contacts never appear in Leadership Access,
 * Contact Intelligence, or Outreach Intelligence.
 *
 * Enforcement runs AFTER scoring + recommendations are computed, so score values
 * and recommendation logic are unchanged — only the displayed/persisted
 * relationship evidence (names, emails, phones) is cleaned.
 */
export interface ContaminationSources {
  hosts: Set<string>;
  urls: Set<string>;
  flags: string[];        // human-readable, same strings the dossier already showed
}

/** Same-name church in a DIFFERENT city/state = a contaminated source. */
export function computeContaminationSources(identity: DiscoveryResult): ContaminationSources {
  const hosts = new Set<string>();
  const urls = new Set<string>();
  const flags: string[] = [];
  for (const c of identity.candidates ?? []) {
    if (c.nameFull && c.cityStatus === 'conflict' && (c.kind === 'official_church' || c.source === 'search')) {
      const h = (c.host || hostOf(c.url)).toLowerCase();
      if (h) hosts.add(h);
      if (c.url) urls.add(c.url);
      flags.push(`Same-name church at ${c.host} appears to be in a different city/state (${c.url}) — not this church; do not attribute its facts here.`);
    }
  }
  return { hosts, urls, flags: [...new Set(flags)] };
}

export function isContaminatedUrl(url: string | null | undefined, sources: ContaminationSources): boolean {
  if (!url) return false;
  if (sources.urls.has(url)) return true;
  const h = hostOf(url);
  return !!h && sources.hosts.has(h);
}

const digits = (s: string): string => s.replace(/\D/g, '');

/**
 * Remove contaminated relationship evidence (mutates `normalized` + the
 * display-bearing `interpretation` conclusions). Score objects are NOT touched —
 * they were already computed from the full evidence before this runs.
 *
 * Returns the count of removed rows (for instrumentation).
 */
export function enforceContamination(
  normalized: NormalizedEvidence,
  interpretation: Interpretation,
  sources: ContaminationSources,
): { removed: number } {
  if (!sources.hosts.size && !sources.urls.size) return { removed: 0 };
  const bad = (url: string) => isContaminatedUrl(url, sources);
  let removed = 0;
  const clean = <T extends { source_url: string }>(rows: T[]): T[] => {
    const kept = rows.filter((r) => !bad(r.source_url));
    removed += rows.length - kept.length;
    return kept;
  };
  normalized.leaders = clean(normalized.leaders);
  normalized.staff_roster = clean(normalized.staff_roster);
  normalized.email_map = clean(normalized.email_map);
  normalized.contacts = clean(normalized.contacts);
  normalized.locations = clean(normalized.locations);

  // Scrub any conclusion whose supporting evidence was just removed, so the
  // single-value contact fields don't keep pointing at a wrong-church value.
  const names = new Set(normalized.leaders.map((l) => l.value.toLowerCase()));
  const emails = new Set([
    ...normalized.email_map.map((e) => e.value.toLowerCase()),
    ...normalized.contacts.filter((c) => c.category === 'email').map((c) => c.value.toLowerCase()),
  ]);
  const phones = new Set(normalized.contacts.filter((c) => c.category === 'phone').map((c) => digits(c.value)));

  const lp = interpretation.lead_pastors;
  lp.value = (lp.value ?? []).filter((n) => names.has(n.toLowerCase()));

  const scrubPerson = (c: { value: string | null; evidence_ids: string[]; reason: string }) => {
    if (c.value && !names.has(c.value.toLowerCase())) { c.value = null; c.evidence_ids = []; c.reason = `${c.reason} (contaminated source removed)`.trim(); }
  };
  scrubPerson(interpretation.executive_pastor);
  scrubPerson(interpretation.discipleship_pastor);
  scrubPerson(interpretation.operations_leader);
  scrubPerson(interpretation.marketing_director);
  scrubPerson(interpretation.communications_leader);

  const oe = interpretation.office_email;
  if (oe.value && !emails.has(oe.value.toLowerCase())) { oe.value = null; oe.evidence_ids = []; oe.reason = `${oe.reason} (contaminated source removed)`.trim(); }
  const op = interpretation.office_phone;
  if (op.value && !phones.has(digits(op.value))) { op.value = null; op.evidence_ids = []; op.reason = `${op.reason} (contaminated source removed)`.trim(); }

  return { removed };
}
