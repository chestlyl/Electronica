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

export interface ProspectBoard {
  area: AreaQuery;
  total_found: number;           // distinct candidates enumerated
  known_count: number;
  unknown_count: number;
  dossiered: number;             // how many we fully scored (bounded by limit)
  entries: ProspectEntry[];      // ranked by fit, desc
}

export interface ProspectDeps {
  enumerators: ProspectProvider[];
  knownRoster: () => Promise<KnownChurch[]>;
  buildDossier: (target: ResearchTarget) => Promise<DossierBuild>;
  limit?: number;                // default cost bound when AreaQuery.limit absent
  onProgress?: (msg: string) => void;
}

// ── normalization for dedup / known-matching ─────────────────────────────────
const STOPWORDS = /\b(the|a|an|of|at|for|church|chapel|ministries|ministry|fellowship|community|worship|center|centre|assembly|cathedral|tabernacle|house|city)\b/g;
export function normName(name: string | null | undefined): string {
  return (name ?? '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9\s]/g, ' ').replace(STOPWORDS, ' ').replace(/\s+/g, ' ').trim();
}
export function domainOf(url: string | null | undefined): string {
  if (!url) return '';
  try {
    const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, '').toLowerCase();
  } catch { return ''; }
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
  // 3) tag known vs unknown
  const known = await deps.knownRoster();
  const tagged = deduped.map((c) => ({ c, known: isKnown(c, known) }));
  const knownCount = tagged.filter((t) => t.known).length;
  log(`${deduped.length} distinct churches · ${deduped.length - knownCount} unknown · ${knownCount} known`);
  // 4) prioritize unknowns into the cost budget, then dossier each
  const ordered = [...tagged.filter((t) => !t.known), ...tagged.filter((t) => t.known)];
  const limit = area.limit ?? deps.limit ?? 25;
  const slice = ordered.slice(0, limit);
  const entries: ProspectEntry[] = [];
  for (const { c, known: isK } of slice) {
    try { const b = await deps.buildDossier(toTarget(c)); entries.push(toEntry(c, isK, b)); log(`dossier: ${c.name} → fit ${entries[entries.length - 1].fit}`); }
    catch (e) { log(`dossier failed: ${c.name} (${(e as Error).message})`); }
  }
  // 5) rank by Engagement Fit (desc); unknowns break ties first (they're the goal)
  entries.sort((a, z) => z.fit - a.fit || (Number(a.known) - Number(z.known)));
  return { area, total_found: deduped.length, known_count: knownCount, unknown_count: deduped.length - knownCount, dossiered: entries.length, entries };
}

/** Markdown prospecting board (ranked by Engagement Fit; unknowns flagged). */
export function renderProspectBoard(board: ProspectBoard): string {
  const L: string[] = [];
  const a = board.area;
  L.push(`# Area Prospecting — ${a.metro}${a.state ? `, ${a.state}` : ''}${a.denomination ? ` · ${a.denomination}` : ''}`);
  L.push(`_${board.total_found} churches found · ${board.unknown_count} unknown / ${board.known_count} known · ${board.dossiered} scored · ranked by Engagement Fit_`);
  L.push('');
  L.push('| # | church | known? | fit | priority | entry point | archetype | AWA | dig | grw | cap | con | site |');
  L.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  board.entries.forEach((e, i) => {
    const loc = [e.city, e.state].filter(Boolean).join(', ');
    L.push(`| ${i + 1} | ${e.name}${loc ? ` (${loc})` : ''} | ${e.known ? 'known' : '**NEW**'} | **${e.fit}** | ${e.priority} | ${e.entry_point} | ${e.archetype} | ${e.attendance ?? '—'} | ${e.scores.digital_maturity} | ${e.scores.growth_orientation} | ${e.scores.organizational_capacity} | ${e.scores.contactability} | ${e.website ?? '—'} |`);
  });
  L.push('');
  L.push(`_dig=digital_maturity grw=growth_orientation cap=organizational_capacity con=contactability_`);
  return L.join('\n');
}
