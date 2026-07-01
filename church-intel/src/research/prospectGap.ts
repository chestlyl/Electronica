/**
 * Prospect-Gap guard — a "do-not-research existing churches" filter that runs
 * BEFORE any dossier is built, so we never spend Claude/dossier budget on a
 * church we're already connected to.
 *
 * Given a list of EXISTING connected churches (from a workbook, JSON, CSV, or
 * the live repository), this builds an exclusion index keyed on:
 *   - website domain          (exact)
 *   - normalized name + geo    (exact name, same city/state)
 *   - phone                    (exact, last-10-digits)
 *   - known alias              (curated name aliases)
 *   - fuzzy name + geo         (high name similarity, same city/state)
 *
 * `ExistingIndex.match()` returns one of:
 *   - { decision:'exclude' } — a confident match → drop before dossiering
 *   - { decision:'review'  } — an ambiguous match → surface for a human, don't
 *                              spend budget yet
 *   - null                   — net-new, proceed to dossier
 *
 * The matcher is pure + dependency-injected (unit-tested offline). The workbook
 * reader is a best-effort harvest of church identities from the "Connected
 * Churches" workbooks, which are AGGREGATE (denomination/state rollups) — so the
 * live repository roster is the authoritative existing set; the workbook adds
 * whatever concrete church/website identities it carries.
 */
import { readFileSync } from 'node:fs';
import * as xlsx from 'xlsx';
import { normName, domainOf } from './prospect.js';
import type { ProspectBoard, ExclusionRecord } from './prospect.js';

export interface ExistingChurch {
  name: string;
  website: string | null;
  city: string | null;
  state: string | null;   // 2-letter code, upper-cased
  phone: string | null;   // last-10-digits, digits only
  aliases: string[];
  denomination: string | null;
  source: string | null;  // where it came from (sheet / roster / file)
}

export type MatchReason = 'domain' | 'name+geo' | 'phone' | 'alias' | 'fuzzy+geo' | 'name-nogeo' | 'fuzzy';
export interface ExclusionOutcome {
  decision: 'exclude' | 'review';
  reason: MatchReason;
  confidence: number;      // 0..1
  existing: ExistingChurch;
  detail: string;          // human-readable why
}

/** Candidate side of a match — the minimum a prospect candidate must expose. */
export interface GapCandidate {
  name: string;
  city?: string | null;
  state?: string | null;
  website?: string | null;
  phone?: string | null;
}

// ── normalization helpers ─────────────────────────────────────────────────────
const US_STATE_CODE: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO',
  connecticut: 'CT', delaware: 'DE', 'district of columbia': 'DC', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY',
  louisiana: 'LA', maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN',
  mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH',
  'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND',
  ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT', virginia: 'VA',
  washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
};
const STATE_CODES = new Set(Object.values(US_STATE_CODE));

/** Coerce a state cell ("Ohio" | "OH" | "oh") to a 2-letter code, or null. */
export function stateCode(v: string | null | undefined): string | null {
  const s = (v ?? '').trim();
  if (!s) return null;
  const up = s.toUpperCase();
  if (up.length === 2 && STATE_CODES.has(up)) return up;
  return US_STATE_CODE[s.toLowerCase()] ?? null;
}

/** Last-10-digits phone key ("(409) 892-8475" → "4098928475"), or null. */
export function phoneKey(v: string | null | undefined): string | null {
  const digits = (v ?? '').replace(/\D/g, '');
  const ten = digits.length > 10 && digits.startsWith('1') ? digits.slice(1) : digits;
  return ten.length === 10 ? ten : null;
}

const cityKey = (v: string | null | undefined): string =>
  (v ?? '').toLowerCase().replace(/[^a-z0-9]/g, '').trim();

// ── name similarity (token Jaccard ⋃ character-bigram Dice) ────────────────────
function tokens(name: string): Set<string> {
  return new Set(normName(name).split(/\s+/).filter(Boolean));
}
function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}
function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  const clean = s.replace(/\s+/g, ' ');
  for (let i = 0; i < clean.length - 1; i++) {
    const g = clean.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}
function dice(a: string, b: string): number {
  const ga = bigrams(a), gb = bigrams(b);
  if (!ga.size || !gb.size) return 0;
  let inter = 0;
  for (const [g, n] of ga) { const o = gb.get(g); if (o) inter += Math.min(n, o); }
  const total = [...ga.values()].reduce((x, y) => x + y, 0) + [...gb.values()].reduce((x, y) => x + y, 0);
  return (2 * inter) / total;
}
/** Blended name similarity in 0..1 on the normalized names. */
export function nameSimilarity(a: string, b: string): number {
  const na = normName(a), nb = normName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  return Math.max(jaccard(tokens(a), tokens(b)), dice(na, nb));
}

// ── geo relationship between a candidate and an existing church ────────────────
type GeoRel = 'state-conflict' | 'full' | 'state-only' | 'city-conflict' | 'partial' | 'none';
function geoRel(cand: GapCandidate, ex: ExistingChurch): GeoRel {
  const cs = stateCode(cand.state), es = ex.state;
  if (cs && es) {
    if (cs !== es) return 'state-conflict';
    const cc = cityKey(cand.city), ec = cityKey(ex.city);
    if (cc && ec) return cc === ec ? 'full' : 'city-conflict';
    return 'state-only';
  }
  if (!cs && !es && !cityKey(cand.city) && !cityKey(ex.city)) return 'none';
  return 'partial';
}

// ── curated aliases (canonical normName → alias display names) ─────────────────
// Extend as needed; every alias is matched by normalized name.
// Keyed by a RAW alnum key (lowercase, letters+digits only) so it is NOT eroded
// by stop-word stripping ("Life.Church" → "lifechurch", not "life").
const ALIAS_TABLE: Record<string, string[]> = {
  lifechurch: ['LifeChurch.tv', 'Life Church'],
  elevationchurch: ['Elevation Church eChurch'],
  crosspointchurch: ['Cross Point Community Church'],
  thebelongingco: ['The Belonging Company', 'Belonging Co'],
};
const aliasKeyRaw = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]/g, '');
/** Alias display names curated for a given church name (by its raw alnum key). */
export function aliasesFor(name: string): string[] {
  return ALIAS_TABLE[aliasKeyRaw(name)] ?? [];
}

// ── the index ─────────────────────────────────────────────────────────────────
export class ExistingIndex {
  private readonly list: ExistingChurch[];
  private readonly byDomain = new Map<string, ExistingChurch>();
  private readonly byPhone = new Map<string, ExistingChurch>();
  private readonly byName = new Map<string, ExistingChurch[]>();
  private readonly byAlias = new Map<string, ExistingChurch>();

  constructor(existing: ExistingChurch[]) {
    this.list = existing;
    for (const e of existing) {
      const dom = domainOf(e.website);
      if (dom) this.byDomain.set(dom, e);
      const ph = phoneKey(e.phone);
      if (ph) this.byPhone.set(ph, e);
      const nk = normName(e.name);
      if (nk) { const a = this.byName.get(nk) ?? []; a.push(e); this.byName.set(nk, a); }
      for (const al of [...e.aliases, ...aliasesFor(e.name)]) {
        const ak = normName(al);
        if (ak && ak !== nk) this.byAlias.set(ak, e);
      }
    }
  }

  get size(): number { return this.list.length; }

  /** Decide whether a candidate matches an existing church. null → net-new. */
  match(cand: GapCandidate): ExclusionOutcome | null {
    const dom = domainOf(cand.website);
    const ph = phoneKey(cand.phone);
    const nk = normName(cand.name);

    // 1) exact domain — the strongest, geo-independent signal.
    if (dom && this.byDomain.has(dom)) {
      const e = this.byDomain.get(dom)!;
      return { decision: 'exclude', reason: 'domain', confidence: 1, existing: e, detail: `same website domain ${dom}` };
    }
    // 2) exact phone.
    if (ph && this.byPhone.has(ph)) {
      const e = this.byPhone.get(ph)!;
      return { decision: 'exclude', reason: 'phone', confidence: 0.97, existing: e, detail: `same phone ${ph}` };
    }
    // 3) known alias (name equals a curated alias of an existing church).
    if (nk && this.byAlias.has(nk)) {
      const e = this.byAlias.get(nk)!;
      const g = geoRel(cand, e);
      if (g === 'state-conflict') { /* different state → not the same church */ }
      else return { decision: 'exclude', reason: 'alias', confidence: 0.95, existing: e, detail: `matches known alias of "${e.name}"` };
    }
    // 4) exact normalized name.
    if (nk && this.byName.has(nk)) {
      for (const e of this.byName.get(nk)!) {
        const g = geoRel(cand, e);
        if (g === 'state-conflict') continue;                          // same name, different state → different church
        if (g === 'full' || g === 'state-only')
          return { decision: 'exclude', reason: 'name+geo', confidence: g === 'full' ? 0.96 : 0.9, existing: e, detail: `exact name + ${g === 'full' ? 'same city/state' : 'same state'}` };
        // name matches but geo can't be confirmed (or differs by city) → review.
        return { decision: 'review', reason: 'name-nogeo', confidence: 0.7, existing: e, detail: `exact name but ${g === 'city-conflict' ? 'different city' : 'geo unconfirmed'}` };
      }
    }
    // 5) fuzzy name — only meaningful with geo agreement.
    let best: ExclusionOutcome | null = null;
    for (const e of this.list) {
      const s = nameSimilarity(cand.name, e.name);
      if (s < 0.68) continue;
      const g = geoRel(cand, e);
      if (g === 'state-conflict') continue;
      // Geo-aware exclude threshold: looser when city+state both agree ('full'),
      // stricter when only the state agrees ('state-only').
      const excludeAt = g === 'full' ? 0.8 : g === 'state-only' ? 0.87 : Infinity;
      if (s >= excludeAt) {
        const out: ExclusionOutcome = { decision: 'exclude', reason: 'fuzzy+geo', confidence: Number((0.7 + 0.2 * s).toFixed(2)), existing: e, detail: `name ${(s * 100) | 0}% similar + ${g === 'full' ? 'same city/state' : 'same state'}` };
        if (!best || out.confidence > best.confidence) best = out;
      } else {
        const out: ExclusionOutcome = { decision: 'review', reason: 'fuzzy', confidence: Number((0.5 + 0.15 * s).toFixed(2)), existing: e, detail: `name ${(s * 100) | 0}% similar to "${e.name}"${g === 'partial' || g === 'none' ? ' (geo unconfirmed)' : ''}` };
        if (!best || (best.decision !== 'exclude' && out.confidence > best.confidence)) best = out;
      }
    }
    return best;
  }
}

// ── reading existing churches from a workbook / JSON / CSV ─────────────────────
type Row = (string | number | null)[];
const norm = (v: unknown): string => String(v ?? '').replace(/\s+/g, ' ').trim();
const URL_RE = /^(https?:\/\/)?(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+/i;
const CHURCHY = /\b(church|chapel|tabernacle|cathedral|fellowship|assembly|ministries|ministry|worship|congregation|parish|vineyard|chapel|sanctuary|temple)\b/i;
// A generic denomination / section label (NOT a specific church to exclude).
const GENERIC_LABEL = /^(all\s+)?(assembly of god|foursquare|southern baptist|eco|vineyard|arc|covenant|ev free|open bible|nazarene|christian missionary alliance|sbc)\b.*(churches|summary|contacts?)?$/i;
const SECTIONISH = /^(name|state|city|district|contacts?|regional governance|districts?|total|summary|lead team|sr leadership|national)$/i;

/** Scan a workbook and harvest concrete church/website identities (best-effort). */
export function readExistingFromWorkbook(path: string): ExistingChurch[] {
  const wb = xlsx.read(readFileSync(path), { type: 'buffer' });
  const out: ExistingChurch[] = [];
  const seen = new Set<string>();
  for (const sheet of wb.SheetNames) {
    const rows = xlsx.utils.sheet_to_json<Row>(wb.Sheets[sheet], { header: 1, blankrows: false, defval: null });
    const denom = sheet.replace(/\s*(summary|churches|contacts?|network)\s*/gi, ' ').replace(/\s+/g, ' ').trim() || null;
    for (const r of rows) {
      const cells = r.map(norm);
      // website — first URL/domain-looking cell.
      const site = cells.find((c) => URL_RE.test(c)) ?? null;
      const dom = domainOf(site);
      // phone — first 10-digit phone cell.
      const phoneCell = cells.find((c) => phoneKey(c)) ?? null;
      // state — first US state cell.
      let st: string | null = null;
      for (const c of cells) { const s = stateCode(c); if (s) { st = s; break; } }
      // name — the first CHURCH-LIKE cell that isn't a generic denomination label
      // or a section header. Precision over recall: the workbook is aggregate, so
      // we only harvest cells that actually read like a church/organization name
      // (the repository roster is the authoritative congregation-level set).
      const name = cells.find((c) =>
        c.length >= 4 && c.length <= 70 && !URL_RE.test(c) && !phoneKey(c) &&
        !SECTIONISH.test(c) && !GENERIC_LABEL.test(c) && !/[–—]|\d{3,}/.test(c) &&
        CHURCHY.test(c)
      );
      if (!name) continue;
      // Require a concrete identity key: a website domain, a state, or a phone.
      const hasIdentity = !!dom || !!st || !!phoneKey(phoneCell);
      if (!hasIdentity) continue;
      const key = `${normName(name)}|${st ?? ''}|${dom}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        name, website: site, city: null, state: st,
        phone: phoneKey(phoneCell), aliases: aliasesFor(name),
        denomination: denom, source: sheet,
      });
    }
  }
  return out;
}

/** Map a plain {name,url,city,state,phone} record (JSON/CSV/roster) to ExistingChurch. */
export function toExistingChurch(o: { name: string | null; website?: string | null; url?: string | null; city?: string | null; state?: string | null; phone?: string | null }, source: string): ExistingChurch {
  const name = norm(o.name);
  return {
    name, website: o.website ?? o.url ?? null, city: o.city ?? null, state: stateCode(o.state),
    phone: phoneKey(o.phone), aliases: aliasesFor(name), denomination: null, source,
  };
}

/** Read existing churches from a .xlsx workbook, or a .json/.csv church list. */
export function readExistingChurches(path: string): ExistingChurch[] {
  if (/\.xlsx?$/i.test(path)) return readExistingFromWorkbook(path);
  // JSON or CSV — reuse the batch parser's shape, then coerce.
  const content = readFileSync(path, 'utf8');
  const trimmed = content.trim();
  if (path.endsWith('.json') || trimmed.startsWith('[') || trimmed.startsWith('{')) {
    const data = JSON.parse(trimmed);
    const arr = Array.isArray(data) ? data : (data.churches ?? []);
    return arr.map((o: Record<string, unknown>) => toExistingChurch({
      name: String(o.name ?? o.church ?? ''), url: (o.url ?? o.website ?? null) as string | null,
      city: (o.city ?? null) as string | null, state: (o.state ?? null) as string | null, phone: (o.phone ?? null) as string | null,
    }, path)).filter((c: ExistingChurch) => c.name);
  }
  // CSV
  const lines = trimmed.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const split = (line: string): string[] => {
    const cells: string[] = []; let cur = ''; let q = false;
    for (const ch of line) { if (ch === '"') q = !q; else if (ch === ',' && !q) { cells.push(cur); cur = ''; } else cur += ch; }
    cells.push(cur); return cells.map((c) => c.replace(/^"|"$/g, '').trim());
  };
  const header = split(lines[0]).map((h) => h.toLowerCase());
  const idx = (names: string[]) => header.findIndex((h) => names.includes(h));
  const ni = idx(['name', 'church', 'church name', 'church_name']);
  const ui = idx(['url', 'website', 'site', 'web']);
  const ci = idx(['city', 'town']);
  const si = idx(['state', 'st']);
  const pi = idx(['phone', 'tel', 'telephone']);
  const out: ExistingChurch[] = [];
  for (const line of lines.slice(1)) {
    const cells = split(line);
    const name = (ni >= 0 ? cells[ni] : cells[0]) ?? '';
    if (!name) continue;
    out.push(toExistingChurch({
      name, url: ui >= 0 ? cells[ui] : null, city: ci >= 0 ? cells[ci] : null,
      state: si >= 0 ? cells[si] : null, phone: pi >= 0 ? cells[pi] : null,
    }, path));
  }
  return out;
}

// ── combined multi-metro gap report ───────────────────────────────────────────
export interface GapBoard { metro: string; board: ProspectBoard; }
export interface GapMeta { existingCount: number; rosterCount: number; indexSize: number; state?: string | null; source: string; }

/** Dedupe exclusion records across metros by normalized name + state + domain. */
function dedupeExclusions(records: ExclusionRecord[]): ExclusionRecord[] {
  const seen = new Set<string>();
  const out: ExclusionRecord[] = [];
  for (const r of records) {
    const k = `${normName(r.name)}|${(r.state ?? '').toUpperCase()}|${domainOf(r.website)}`;
    if (seen.has(k)) continue; seen.add(k); out.push(r);
  }
  return out;
}

/** Render one combined markdown report across all metros (net-new + appendices). */
export function renderGapReport(boards: GapBoard[], meta: GapMeta): string {
  const L: string[] = [];
  const metros = boards.map((b) => b.metro).join(', ');
  L.push(`# Prospect Gap — new churches only${meta.state ? ` · ${meta.state}` : ''}`);
  L.push('');
  L.push(`_Metros: ${metros}_`);

  const totalFound = boards.reduce((n, b) => n + b.board.total_found, 0);
  const totalRejected = boards.reduce((n, b) => n + b.board.rejected, 0);
  const allExcluded = dedupeExclusions(boards.flatMap((b) => b.board.excluded));
  const allAmbiguous = dedupeExclusions(boards.flatMap((b) => b.board.ambiguous));
  const totalScored = boards.reduce((n, b) => n + b.board.dossiered, 0);
  const totalNew = boards.reduce((n, b) => n + b.board.entries.filter((e) => !e.known).length, 0);

  L.push('');
  L.push(`> **Existing-church guard:** ${meta.indexSize} existing churches loaded ` +
    `(${meta.existingCount} from \`${meta.source}\`${meta.rosterCount ? ` + ${meta.rosterCount} from the repository` : ''}). ` +
    `**${allExcluded.length} candidates matched an existing church and ${allAmbiguous.length} were ambiguous — none consumed dossier budget.**`);
  L.push('');
  L.push(`| metric | value |`);
  L.push(`|---|---|`);
  L.push(`| candidates enumerated | ${totalFound} |`);
  L.push(`| rejected (quality gate) | ${totalRejected} |`);
  L.push(`| matched existing (excluded) | ${allExcluded.length} |`);
  L.push(`| ambiguous (needs review) | ${allAmbiguous.length} |`);
  L.push(`| **net-new dossiered** | **${totalScored}** (${totalNew} confirmed new) |`);

  // Net-new prospects across all metros, ranked by fit.
  L.push('');
  L.push('## New prospects (net-new only)');
  const rows = boards.flatMap((b) => b.board.entries.map((e) => ({ metro: b.metro, e })));
  rows.sort((a, z) => z.e.fit - a.e.fit || (Number(a.e.known) - Number(z.e.known)));
  if (!rows.length) L.push('_No net-new prospects surfaced._');
  else {
    L.push('| # | church | metro | known? | fit | priority | entry point | archetype | AWA | site |');
    L.push('|---|---|---|---|---|---|---|---|---|---|');
    rows.forEach(({ metro, e }, i) => {
      const loc = [e.city, e.state].filter(Boolean).join(', ');
      L.push(`| ${i + 1} | ${e.name}${loc ? ` (${loc})` : ''} | ${metro} | ${e.known ? 'known' : '**NEW**'} | **${e.fit}** | ${e.priority} | ${e.entry_point} | ${e.archetype} | ${e.attendance ?? '—'} | ${e.website ?? '—'} |`);
    });
  }

  // Appendices.
  L.push('');
  L.push(...renderExclusionAppendixLocal('Matched Existing / Excluded', allExcluded,
    'matched an existing connected church — skipped before any dossier spend'));
  L.push('');
  L.push(...renderExclusionAppendixLocal('Ambiguous — needs review', allAmbiguous,
    'fuzzy/uncertain match to an existing church — confirm before researching (not yet dossiered)'));

  // Note the insufficient-candidate metros, if any.
  const insufficient = boards.filter((b) => b.board.status === 'insufficient_candidates');
  if (insufficient.length) {
    L.push('');
    L.push('## Metros with insufficient candidates');
    for (const b of insufficient) L.push(`- **${b.metro}** — ${b.board.note ?? 'no usable candidates'}`);
  }
  return L.join('\n');
}

// Local copy of the appendix renderer (keeps prospectGap self-contained for the
// combined report; identical shape to prospect.renderExclusionAppendix).
function renderExclusionAppendixLocal(title: string, records: ExclusionRecord[], blurb: string): string[] {
  const L: string[] = [`## ${title}`];
  if (!records.length) { L.push('_None._'); return L; }
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
