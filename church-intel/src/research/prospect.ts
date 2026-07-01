import type { ResearchTarget, DossierBuild } from './researchAgent.js';

/**
 * Area Prospecting — turn the agent from a known-church LOOKUP into a market
 * PROSPECTOR: given a metro/region, enumerate the churches there (including ones
 * NOT in our roster), dedupe, tag known-vs-unknown against the Supabase roster,
 * run the full dossier+scoring pipeline on each, and rank by Engagement Fit.
 *
 * This module is the deterministic, dependency-injected core: enumeration
 * providers (Google Places, directories, …), the known-roster lookup, and the
 * dossier builder are all injected, so the orchestration is unit-testable
 * offline (no network, no Supabase, no Places key).
 */

export interface AreaQuery {
  metro: string;                 // e.g. "Greater Akron"
  state?: string | null;
  denomination?: string | null;  // optional filter
  limit?: number;                // max churches to fully dossier (cost bound)
}

export interface ChurchCandidate {
  name: string;
  city: string | null;
  state: string | null;
  website: string | null;        // may be null — the dossier pipeline resolves it
  address?: string | null;
  phone?: string | null;         // some enumerators carry a phone (used by the gap guard)
  sources: string[];             // which enumeration providers surfaced it
}

/** A pluggable enumeration source (Google Places, a directory, Outreach/Hartford…). */
export interface ProspectProvider {
  name: string;
  enumerate(area: AreaQuery): Promise<ChurchCandidate[]>;
}

/** Minimal known-church shape for dedup (from store.listChurches). */
export interface KnownChurch {
  name: string | null;
  website: string | null;
  city?: string | null;
  state?: string | null;
}

export interface ProspectEntry {
  name: string;
  city: string | null;
  state: string | null;
  website: string | null;
  known: boolean;                // already in the roster?
  sources: string[];
  fit: number;                   // Engagement Fit 0..100
  priority: string;              // high | medium | low
  entry_point: string;          // recommended senior owner
  archetype: string;
  attendance: number | null;
  scores: { digital_maturity: number; growth_orientation: number; organizational_capacity: number; contactability: number };
  access_level: string;
}

/** A candidate diverted before dossiering because it matched an existing church. */
export interface ExclusionRecord {
  name: string;
  city: string | null;
  state: string | null;
  website: string | null;
  reason: string;                // domain | name+geo | phone | alias | fuzzy+geo | …
  confidence: number;            // 0..1
  matched: string;               // the existing church it matched
  matched_source: string | null; // where the existing church came from
  detail: string;                // human-readable why
}

export interface ProspectBoard {
  area: AreaQuery;
  status: 'ok' | 'insufficient_candidates';
  note?: string;                 // why, when status != ok
  total_found: number;           // distinct candidates enumerated
  rejected: number;              // candidates hard-rejected by the quality gate
  excluded: ExclusionRecord[];   // matched an existing church → NOT dossiered
  ambiguous: ExclusionRecord[];  // fuzzy/uncertain match → needs review, NOT dossiered
  known_count: number;
  unknown_count: number;
  dossiered: number;             // how many we fully scored (bounded by limit)
  entries: ProspectEntry[];      // ranked by fit, desc
}

/** Verdict from an existing-church guard: exclude (confident) | review (ambiguous) | null (net-new). */
export interface ExcludeVerdict {
  decision: 'exclude' | 'review';
  reason: string;
  confidence: number;
  matched: string;
  matched_source?: string | null;
  detail: string;
}

export interface ProspectDeps {
  enumerators: ProspectProvider[];
  knownRoster: () => Promise<KnownChurch[]>;
  buildDossier: (target: ResearchTarget) => Promise<DossierBuild>;
  limit?: number;                // default cost bound when AreaQuery.limit absent
  onProgress?: (msg: string) => void;
  // Optional "do-not-research existing churches" guard. Runs AFTER the quality
  // gate and BEFORE any dossier is built, so excluded/ambiguous churches never
  // consume dossier budget.
  excludeExisting?: (c: ChurchCandidate) => ExcludeVerdict | null;
}

// ── normalization for dedup / known-matching ─────────────────────────────────
const STOPWORDS = /\b(the|a|an|of|at|for|church|chapel|ministries|ministry|fellowship|community|worship|center|centre|assembly|cathedral|tabernacle|house|city)\b/g;
export function normName(name: string | null | undefined): string {
  const cleaned = (name ?? '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const stripped = cleaned.replace(STOPWORDS, ' ').replace(/\s+/g, ' ').trim();
  // Fall back to the full cleaned name when stripping leaves nothing — otherwise
  // all-stopword names ("Church of the City", "City Church") collapse to "" and
  // get wrongly merged into a single candidate.
  return stripped || cleaned;
}
export function domainOf(url: string | null | undefined): string {
  if (!url) return '';
  try {
    const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, '').toLowerCase();
  } catch { return ''; }
}

// ── candidate quality gate (runs BEFORE any dossier is built) ─────────────────
const STATE_NAMES: Record<string, string> = {
  TN: 'tennessee', CA: 'california', OH: 'ohio', TX: 'texas', FL: 'florida', GA: 'georgia',
  AZ: 'arizona', OK: 'oklahoma', NC: 'north carolina', SC: 'south carolina', NY: 'new york',
};
// A pure placeholder / generic name with no church-specific identity.
const GENERIC_PLACEHOLDER = new Set([
  'your church', 'the church', 'a church', 'our church', 'my church', 'this church',
  'new church', 'local church', 'a local church', 'church', 'churches', 'find a church',
  'home', 'welcome', 'about us', 'contact us', 'city church network',
]);
// Directory / aggregator / SEO artifacts.
const AGGREGATOR = /\b(network|directory|listings?|guide|near\s*me|find\s+a\s+church|churches\s+near|best\s+churches|top\s+\d+|yellow\s*pages|reviews?)\b/i;
// A street address ("305 Church St, Nashville, TN 37201").
const STREETISH = /^\s*\d{1,6}\s+\S|\b\d{1,6}\s+[A-Za-z][\w .'-]*\b(st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|ln|lane|hwy|highway|pkwy|parkway|ct|court|way|pike|pl|place|cir|circle|ste|suite|unit|#)\b|,\s*[A-Z]{2}\s*\d{5}/i;
// Directory/aggregator hosts (a candidate whose only "site" is one of these is not a church).
const DIRECTORY_HOST = /(^|\.)(yelp|yellowpages|faithstreet|churchfinder|churchangel|usachurches|tripadvisor|mapquest|manta|chamberofcommerce|foursquare|niche|wikipedia|city-data|loopnet|zillow|apartments|ourchurch|google|bing|facebook|instagram|youtube)\./i;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const GENERIC_TOKENS = new Set(['church', 'churches', 'chapel', 'the', 'of', 'a', 'an', 'in', 'at', 'for', 'and', 'to', 'our']);

/** Why a candidate should be hard-rejected before we ever build a dossier — or null if it passes. */
export function candidateRejectReason(c: ChurchCandidate, area: AreaQuery): string | null {
  const name = (c.name ?? '').trim();
  if (!name || name.length < 3) return 'empty/too-short name';
  if (STREETISH.test(name)) return 'street address';
  const lower = name.toLowerCase();
  if (GENERIC_PLACEHOLDER.has(lower)) return 'generic placeholder';
  if (AGGREGATOR.test(name)) return 'directory/aggregator artifact';
  if (c.website && DIRECTORY_HOST.test(domainOf(c.website) + '.')) return 'directory host as website';
  // "Church in/at/near/of <metro|state>" — a geographic locator, not a church name.
  const geo = [
    (area.metro ?? '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').trim(),
    (area.state ?? '').toLowerCase(),
    STATE_NAMES[(area.state ?? '').toUpperCase()] ?? '',
  ].filter(Boolean);
  for (const g of geo) {
    if (new RegExp(`\\bchurch(es)?\\s+(in|at|near|of|serving|for)\\s+${escapeRe(g)}\\b`, 'i').test(lower)) return 'city-keyword construction';
  }
  // No church-specific identity: strip generic words + geo tokens; nothing distinctive left.
  const geoTokens = new Set(geo.flatMap((g) => g.split(/\s+/)));
  const distinctive = lower.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((t) => t && !GENERIC_TOKENS.has(t) && !geoTokens.has(t));
  if (!distinctive.length) return 'no church-specific identity';
  return null;
}

/** Merge candidates that are the same church (same normalized name OR same domain). */
export function dedupeCandidates(cands: ChurchCandidate[]): ChurchCandidate[] {
  const out: ChurchCandidate[] = [];
  const byKey = new Map<string, ChurchCandidate>();
  for (const c of cands) {
    const dom = domainOf(c.website);
    const nkey = normName(c.name) + '|' + (c.state ?? '').toLowerCase();
    // find an existing entry by domain or by name+state
    const existing = (dom && byKey.get('d:' + dom)) || byKey.get('n:' + nkey);
    if (existing) {
      existing.website = existing.website ?? c.website;
      existing.city = existing.city ?? c.city;
      existing.state = existing.state ?? c.state;
      existing.address = existing.address ?? c.address;
      for (const s of c.sources) if (!existing.sources.includes(s)) existing.sources.push(s);
      if (dom) byKey.set('d:' + dom, existing);
      byKey.set('n:' + normName(existing.name) + '|' + (existing.state ?? '').toLowerCase(), existing);
      continue;
    }
    const fresh: ChurchCandidate = { ...c, sources: [...c.sources] };
    out.push(fresh);
    if (dom) byKey.set('d:' + dom, fresh);
    byKey.set('n:' + nkey, fresh);
  }
  return out;
}

/** Is this candidate already in the known roster? (domain match, or name+state.) */
export function isKnown(c: ChurchCandidate, known: KnownChurch[]): boolean {
  const dom = domainOf(c.website);
  const nn = normName(c.name);
  return known.some((k) => {
    const kd = domainOf(k.website);
    if (dom && kd && dom === kd) return true;
    if (nn && normName(k.name) === nn) {
      // if both have a state, require it to match; otherwise name match is enough
      if (c.state && k.state) return c.state.toLowerCase() === k.state.toLowerCase();
      return true;
    }
    return false;
  });
}

function toTarget(c: ChurchCandidate): ResearchTarget {
  return { name: c.name, city: c.city, state: c.state, originalWebsite: c.website, alternateName: null, mode: 'market_discovery' };
}

function toEntry(c: ChurchCandidate, known: boolean, b: DossierBuild): ProspectEntry {
  const s = b.strategicScores;
  return {
    name: c.name, city: c.city, state: c.state,
    website: b.officialSite ?? c.website, known, sources: c.sources,
    fit: b.recommendations?.engagement_fit.value ?? 0,
    priority: b.recommendations?.engagement_priority.value ?? 'low',
    entry_point: b.recommendations?.recommended_entry_point.value ?? '—',
    archetype: b.interpretation.archetype.value,
    attendance: b.interpretation.attendance_estimate.value,
    scores: {
      digital_maturity: s.digital_maturity.score, growth_orientation: s.growth_orientation.score,
      organizational_capacity: s.organizational_capacity.score, contactability: s.contactability.score,
    },
    access_level: b.accessLevel,
  };
}

/**
 * Enumerate → dedupe → tag known/unknown → dossier (bounded) → rank by fit.
 * Unknown churches are prioritized into the dossier budget (the whole point is to
 * surface prospects we don't already have).
 */
export async function prospectArea(area: AreaQuery, deps: ProspectDeps): Promise<ProspectBoard> {
  const log = deps.onProgress ?? (() => {});
  // 1) enumerate from every provider (failures isolated)
  const raw: ChurchCandidate[] = [];
  for (const p of deps.enumerators) {
    try { const r = await p.enumerate(area); raw.push(...r); log(`${p.name}: ${r.length} candidates`); }
    catch (e) { log(`${p.name}: failed (${(e as Error).message})`); }
  }
  // 2) dedupe
  const deduped = dedupeCandidates(raw);
  // 3) QUALITY GATE — hard-reject junk BEFORE spending any tokens on dossiers.
  const debug = process.env.PROSPECT_DEBUG === '1';
  const quality: ChurchCandidate[] = [];
  let rejected = 0;
  for (const c of deduped) {
    const reason = candidateRejectReason(c, area);
    if (reason) { rejected++; if (debug) log(`reject "${c.name}" — ${reason}`); }
    else quality.push(c);
  }
  log(`${deduped.length} distinct · ${quality.length} passed quality gate · ${rejected} rejected`);

  // 4) FAIL CLOSED — Google Places is the trusted primary source. If it produced
  // no usable candidate, refuse to build dossiers on search_directory-only junk.
  const PRIMARY = 'google_places';
  const hasPrimary = deps.enumerators.some((p) => p.name === PRIMARY);
  const primaryAccepted = quality.filter((c) => c.sources.includes(PRIMARY)).length;
  if (hasPrimary && primaryAccepted === 0) {
    const note = `Google Places returned no usable candidates — failing closed rather than dossiering ${quality.length} search-directory-only candidate(s).`;
    log(`INSUFFICIENT QUALITY CANDIDATES: ${note}`);
    return { area, status: 'insufficient_candidates', note, total_found: deduped.length, rejected, excluded: [], ambiguous: [], known_count: 0, unknown_count: 0, dossiered: 0, entries: [] };
  }

  // 4.5) EXISTING-CHURCH GUARD — divert churches we're already connected to
  // BEFORE spending any dossier budget on them. Confident matches → excluded;
  // fuzzy/uncertain matches → ambiguous (needs review). Neither is dossiered.
  const excluded: ExclusionRecord[] = [];
  const ambiguous: ExclusionRecord[] = [];
  let eligible = quality;
  if (deps.excludeExisting) {
    eligible = [];
    for (const c of quality) {
      const v = deps.excludeExisting(c);
      if (!v) { eligible.push(c); continue; }
      const rec: ExclusionRecord = {
        name: c.name, city: c.city, state: c.state, website: c.website,
        reason: v.reason, confidence: v.confidence, matched: v.matched,
        matched_source: v.matched_source ?? null, detail: v.detail,
      };
      if (v.decision === 'exclude') { excluded.push(rec); log(`exclude existing: ${c.name} — ${v.reason} (${v.detail})`); }
      else { ambiguous.push(rec); log(`ambiguous (review): ${c.name} — ${v.detail}`); }
    }
    log(`${excluded.length} matched existing (excluded) · ${ambiguous.length} ambiguous (review) · ${eligible.length} net-new eligible — no dossier budget spent on the ${excluded.length + ambiguous.length} skipped`);
  }

  // 5) tag known vs unknown (on the net-new survivors only)
  const known = await deps.knownRoster();
  const tagged = eligible.map((c) => ({ c, known: isKnown(c, known) }));
  const knownCount = tagged.filter((t) => t.known).length;
  log(`${eligible.length} candidates · ${eligible.length - knownCount} unknown · ${knownCount} known`);
  // 6) prioritize unknowns into the cost budget, then dossier each
  const ordered = [...tagged.filter((t) => !t.known), ...tagged.filter((t) => t.known)];
  const limit = area.limit ?? deps.limit ?? 25;
  const slice = ordered.slice(0, limit);
  const entries: ProspectEntry[] = [];
  for (const { c, known: isK } of slice) {
    try { const b = await deps.buildDossier(toTarget(c)); entries.push(toEntry(c, isK, b)); log(`dossier: ${c.name} → fit ${entries[entries.length - 1].fit}`); }
    catch (e) { log(`dossier failed: ${c.name} (${(e as Error).message})`); }
  }
  // 7) rank by Engagement Fit (desc); unknowns break ties first (they're the goal)
  entries.sort((a, z) => z.fit - a.fit || (Number(a.known) - Number(z.known)));
  return { area, status: 'ok', total_found: deduped.length, rejected, excluded, ambiguous, known_count: knownCount, unknown_count: eligible.length - knownCount, dossiered: entries.length, entries };
}

/** Markdown prospecting board (ranked by Engagement Fit; unknowns flagged). */
export function renderProspectBoard(board: ProspectBoard): string {
  const L: string[] = [];
  const a = board.area;
  L.push(`# Area Prospecting — ${a.metro}${a.state ? `, ${a.state}` : ''}${a.denomination ? ` · ${a.denomination}` : ''}`);
  if (board.status === 'insufficient_candidates') {
    L.push('');
    L.push(`> ⚠️ **Insufficient quality candidates.** ${board.note ?? ''}`);
    L.push(`> _${board.total_found} enumerated · ${board.rejected} rejected by the quality gate · 0 dossiered (failed closed)._`);
    return L.join('\n');
  }
  const skipped = board.excluded.length + board.ambiguous.length;
  L.push(`_${board.total_found} found · ${board.rejected} rejected (quality gate) · ${board.excluded.length} matched existing · ${board.ambiguous.length} ambiguous · ${board.unknown_count} unknown / ${board.known_count} known · ${board.dossiered} scored${skipped ? ` · ${skipped} skipped before any dossier spend` : ''} · ranked by Engagement Fit_`);
  L.push('');
  L.push('## New prospects');
  if (!board.entries.length) L.push('_No net-new prospects surfaced._');
  else {
    L.push('| # | church | known? | fit | priority | entry point | archetype | AWA | dig | grw | cap | con | site |');
    L.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
    board.entries.forEach((e, i) => {
      const loc = [e.city, e.state].filter(Boolean).join(', ');
      L.push(`| ${i + 1} | ${e.name}${loc ? ` (${loc})` : ''} | ${e.known ? 'known' : '**NEW**'} | **${e.fit}** | ${e.priority} | ${e.entry_point} | ${e.archetype} | ${e.attendance ?? '—'} | ${e.scores.digital_maturity} | ${e.scores.growth_orientation} | ${e.scores.organizational_capacity} | ${e.scores.contactability} | ${e.website ?? '—'} |`);
    });
    L.push('');
    L.push(`_dig=digital_maturity grw=growth_orientation cap=organizational_capacity con=contactability_`);
  }
  L.push('');
  L.push(...renderExclusionAppendix('Matched Existing / Excluded', board.excluded, 'matched an existing connected church — skipped before any dossier spend'));
  L.push('');
  L.push(...renderExclusionAppendix('Ambiguous — needs review', board.ambiguous, 'fuzzy/uncertain match to an existing church — confirm before researching (not yet dossiered)'));
  return L.join('\n');
}

/** A "why was this filtered" appendix table (Matched Existing / Ambiguous). */
export function renderExclusionAppendix(title: string, records: ExclusionRecord[], blurb: string): string[] {
  const L: string[] = [`## ${title}`];
  if (!records.length) { L.push(`_None._`); return L; }
  L.push(`_${records.length} — ${blurb}._`);
  L.push('');
  L.push('| candidate | matched existing | reason | conf | why |');
  L.push('|---|---|---|---|---|');
  for (const r of [...records].sort((a, z) => z.confidence - a.confidence)) {
    const loc = [r.city, r.state].filter(Boolean).join(', ');
    const src = r.matched_source ? ` _(${r.matched_source})_` : '';
    L.push(`| ${r.name}${loc ? ` (${loc})` : ''}${r.website ? ` · ${r.website}` : ''} | ${r.matched}${src} | ${r.reason} | ${Math.round(r.confidence * 100)}% | ${r.detail} |`);
  }
  return L;
}
