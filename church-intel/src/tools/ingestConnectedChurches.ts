/**
 * Ingest the two "Connected Churches" intelligence workbooks into clean,
 * structured reference data the platform can use for prospecting + strategy.
 *
 * These workbooks are AGGREGATE intelligence (denomination- and state-level
 * rollups) — they contain NO individual-church rows. What they DO contain, and
 * what this tool extracts:
 *
 *   1. denominations.json          — denomination/movement master (affiliation,
 *                                     website, HQ, # churches/pastors/members…)
 *   2. denomination_state_stats.json — per (denomination × state) headline
 *                                     density (lead pastors, staff, churches;
 *                                     mega counts for the mega workbook)
 *   3. attendance_bands.json       — attendance-band distributions (calibration)
 *   4. network_contacts.json       — NAMED denominational/network leaders &
 *                                     regional governance (title, org, address,
 *                                     phone, email, website) — warm network entry
 *   5. prospect_priority.json      — denominations × states ranked by density
 *
 * Pure extraction. Invents nothing; every record carries its source workbook +
 * sheet. Run: `npm run ingest:reference`.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import * as xlsx from 'xlsx';

type Row = (string | number | null)[];
const SRC = 'data/sources';
const OUT = 'data/reference';

const CC = join(SRC, 'connected_churches.xlsx');
const MC = join(SRC, 'mega_church_dashboard.xlsx');

const US_STATES = new Set([
  'Alabama','Alaska','Arizona','Arkansas','California','Colorado','Connecticut','Delaware','District of Columbia',
  'Florida','Georgia','Hawaii','Idaho','Illinois','Indiana','Iowa','Kansas','Kentucky','Louisiana','Maine','Maryland',
  'Massachusetts','Michigan','Minnesota','Mississippi','Missouri','Montana','Nebraska','Nevada','New Hampshire',
  'New Jersey','New Mexico','New York','North Carolina','North Dakota','Ohio','Oklahoma','Oregon','Pennsylvania',
  'Rhode Island','South Carolina','South Dakota','Tennessee','Texas','Utah','Vermont','Virginia','Washington',
  'West Virginia','Wisconsin','Wyoming','Canada',
]);

const norm = (v: unknown): string => String(v ?? '').replace(/\s+/g, ' ').trim();
const low = (v: unknown): string => norm(v).toLowerCase();
function toNum(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/[,$%]/g, ''));
  return Number.isFinite(n) ? n : null;
}
function sheetRows(path: string, sheet: string): Row[] {
  const wb = xlsx.read(readFileSync(path), { type: 'buffer' });
  return xlsx.utils.sheet_to_json<Row>(wb.Sheets[sheet], { header: 1, blankrows: false, defval: null });
}
function sheetNames(path: string): string[] {
  return xlsx.read(readFileSync(path), { type: 'buffer', bookSheets: true }).SheetNames;
}

/** Clean a sheet's denomination label from its title cell ("ALL Assembly of God Churches" → "Assembly of God"). */
function denomLabel(rows: Row[]): string {
  const title = norm(rows[0]?.[1] ?? rows[1]?.[1] ?? rows[0]?.[0]);
  return title
    .replace(/^all\s+/i, '')
    .replace(/\bchurches?\b/gi, '')
    .replace(/\bsummary\b/gi, '')
    .replace(/\bcontacts?\b/gi, '')
    .replace(/&/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || title;
}

// ── 1. Denomination master (ALL Denominations) ───────────────────────────────
/** Split a trailing adherents suffix ("Southern Baptist Convention – 13.7 million"). */
function splitAdherents(name: string): { name: string; size_note: string | null } {
  const m = name.match(/^(.*?)\s*[—–-]\s*([\d.][\d.,]*\s*(?:million|billion|thousand))\b.*$/i);
  return m ? { name: m[1].trim(), size_note: m[2].trim() } : { name: name.trim(), size_note: null };
}

interface Denomination {
  movement_family: string | null;
  affiliation_bio: string | null;
  denomination: string;
  size_note: string | null;
  website: string | null;
  hq_location: string | null;
  regional_offices: number | null;
  regional_offices_label: string | null;
  churches: number | null;
  pastors: number | null;
  membership: number | null;
  universities: number | null;
  source: string | null;
  notes: string | null;
}
function parseDenominationMaster(rows: Row[]): Denomination[] {
  // Leaf header is the row containing "Denomination" + "Website".
  let h = -1;
  for (let i = 0; i < Math.min(rows.length, 8); i++) {
    const flat = rows[i].map(low);
    if (flat.includes('denomination') && flat.includes('website')) { h = i; break; }
  }
  if (h < 0) return [];
  const out: Denomination[] = [];
  for (let i = h + 1; i < rows.length; i++) {
    const r = rows[i];
    const rawDenom = norm(r[2]);
    if (!rawDenom) continue;
    const { name: denomination, size_note } = splitAdherents(rawDenom);
    out.push({
      movement_family: splitAdherents(norm(r[0])).name || null,
      affiliation_bio: norm(r[1]) || null,
      denomination,
      size_note,
      website: norm(r[3]) || null,
      hq_location: norm(r[6]) || null,
      regional_offices: toNum(r[10]),
      regional_offices_label: norm(r[11]) || null,
      churches: toNum(r[13]),
      pastors: toNum(r[14]),
      membership: toNum(r[15]),
      universities: toNum(r[18]),
      source: norm(r[16]) || null,
      notes: norm(r[20]) || null,
    });
  }
  return out;
}

// ── 2. Denomination × state density ──────────────────────────────────────────
interface StateStat {
  scope: 'denomination' | 'mega';
  denomination: string | null;
  state: string;
  young_lead_pastors: number | null;
  young_staff: number | null;
  total_staff: number | null;
  total_churches: number | null;
  mega_churches: number | null;
  source_sheet: string;
}
/** Find the leaf header row that has "state" and a "lead pastor(s)" column. */
function findStateHeader(rows: Row[]): number {
  for (let i = 0; i < Math.min(rows.length, 12); i++) {
    const flat = rows[i].map(low);
    if (flat.includes('state') && flat.some((c) => c.startsWith('lead pastor'))) return i;
  }
  return -1;
}
function parseStateStats(rows: Row[], denomination: string | null, scope: StateStat['scope'], sheet: string): StateStat[] {
  const h = findStateHeader(rows);
  if (h < 0) return [];
  const flat = rows[h].map(low);
  const stateCol = flat.indexOf('state');
  const leadCol = flat.findIndex((c) => c.startsWith('lead pastor'));
  // Columns are: lead pastors | young staff | total staff | total churches,
  // anchored on the lead-pastor column (normalizes the SBC "State Association" shift).
  const out: StateStat[] = [];
  for (let i = h + 1; i < rows.length; i++) {
    const r = rows[i];
    const state = norm(r[stateCol]);
    if (!US_STATES.has(state)) continue;
    const stat: StateStat = {
      scope, denomination, state,
      young_lead_pastors: toNum(r[leadCol]),
      young_staff: toNum(r[leadCol + 1]),
      total_staff: toNum(r[leadCol + 2]),
      total_churches: toNum(r[leadCol + 3]),
      mega_churches: scope === 'mega' ? toNum(r[leadCol + 3]) : null,
      source_sheet: sheet,
    };
    out.push(stat);
  }
  return out;
}

// ── 3. Attendance-band distributions ─────────────────────────────────────────
interface AttendanceBand {
  denomination: string;
  band: string;
  churches: number | null;
  church_pct: number | null;
  attendance: number | null;
  attendance_pct: number | null;
  source_sheet: string;
}
function parseAttendanceBands(rows: Row[], denomination: string, sheet: string): AttendanceBand[] {
  // Header row has "attendance" and "churches" and "%".
  let h = -1;
  for (let i = 0; i < Math.min(rows.length, 8); i++) {
    const flat = rows[i].map(low);
    if (flat.includes('attendance') && flat.includes('churches') && flat.includes('%')) { h = i; break; }
  }
  if (h < 0) return [];
  const out: AttendanceBand[] = [];
  for (let i = h + 1; i < rows.length; i++) {
    const r = rows[i];
    const band = norm(r[1]);
    // Stop at the totals/blank region.
    if (!band || /^total/i.test(band)) { if (/^total/i.test(band)) continue; else if (out.length) break; else continue; }
    const churches = toNum(r[2]);
    if (churches == null && toNum(r[5]) == null) continue;
    out.push({
      denomination, band,
      churches, church_pct: toNum(r[3]),
      attendance: toNum(r[5]), attendance_pct: toNum(r[6]),
      source_sheet: sheet,
    });
  }
  return out;
}

// ── 4. Named network contacts (denomination leadership + regional governance) ─
interface NetworkContact {
  denomination: string;
  level: string;            // hq_leadership | regional_governance | contact
  name: string;
  title: string | null;
  org: string | null;       // office / district / field
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  source_sheet: string;
}
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const BAD_CONTACT_NAME = /^(contacts?|regional governance|tbd|n\/?a|none|vacant|unknown|lead team|districts?|name|state|total)$/i;
/** A real person name (filters section headers, "TBD", and sentence blobs). */
function isContactPerson(n: string): boolean {
  if (!n || n.length < 3 || n.length > 45) return false;
  if (/[0-9@]/.test(n)) return false;
  if (BAD_CONTACT_NAME.test(n.trim())) return false;
  if (!/\s/.test(n) && n === n.toUpperCase()) return false;          // single all-caps token = section noise
  if (/\b(across|located|different|presbytery|council|network|convention)\b/i.test(n)) return false; // org/blob, not a person
  return true;
}
function pickEmail(r: Row, idxs: number[]): string | null {
  for (const i of idxs) { const v = norm(r[i]); if (EMAIL_RE.test(v)) return v.match(EMAIL_RE)![0].toLowerCase(); }
  // fall back: scan the whole row
  for (const c of r) { const v = norm(c); if (EMAIL_RE.test(v)) return v.match(EMAIL_RE)![0].toLowerCase(); }
  return null;
}
function parseNetworkContacts(rows: Row[], denomination: string, sheet: string): NetworkContact[] {
  const out: NetworkContact[] = [];
  let level = 'contact';
  // Header rows we recognize: contain "name" near the front AND at least one of
  // city/district/address AND an email/phone column.
  const headerCols = (r: Row) => {
    const flat = r.map(low);
    const has = (name: string) => flat.findIndex((c) => c === name || c.startsWith(name));
    const hasCityish = flat.includes('city') || flat.includes('district') || flat.includes('address');
    const hasContact = flat.some((c) => c.startsWith('email')) || flat.some((c) => c.startsWith('phone'));
    const nameCol = flat.findIndex((c) => c === 'name' || c === 'first');
    if (nameCol < 0 || !hasCityish || !hasContact) return null;
    return {
      nameCol,
      title: Math.max(has('position'), has('title')),
      org: Math.max(has('office'), has('district'), has('field')),
      address: has('address'), city: has('city'), state: has('state'), zip: has('zip'),
      phone: flat.findIndex((c) => c.startsWith('phone')),
      website: has('website'),
      emailIdxs: flat.map((c, i) => (c.startsWith('email') ? i : -1)).filter((i) => i >= 0),
    };
  };
  for (let i = 0; i < rows.length; i++) {
    const sectionTag = low(rows[i].find((c) => norm(c)) ?? '');
    if (/sr leadership|lead team|national/i.test(sectionTag)) level = 'hq_leadership';
    else if (/regional governance|districts?|regional/i.test(sectionTag)) level = 'regional_governance';
    const cols = headerCols(rows[i]);
    if (!cols) continue;
    // Read people rows beneath this header until a blank-name / new header.
    for (let j = i + 1; j < rows.length; j++) {
      const r = rows[j];
      if (headerCols(r)) { i = j - 1; break; }
      const first = norm(r[cols.nameCol]);
      const last = norm(r[cols.nameCol + 1]);
      const name = [first, last].filter(Boolean).join(' ').trim();
      if (!isContactPerson(name)) continue;
      const get = (idx: number) => (idx >= 0 ? (norm(r[idx]) || null) : null);
      const state = get(cols.state);
      const contact: Omit<NetworkContact, 'source_sheet'> = {
        denomination, level, name,
        title: get(cols.title), org: get(cols.org), address: get(cols.address),
        city: get(cols.city), state: state && US_STATES.has(state) ? state : (state || null), zip: get(cols.zip),
        phone: get(cols.phone), email: pickEmail(r, cols.emailIdxs), website: get(cols.website),
      };
      // Keep only rows that carry a real contact signal (email/phone/title/address).
      if (contact.email || contact.phone || contact.title || contact.address) out.push({ ...contact, source_sheet: sheet });
    }
  }
  return out;
}

// ── orchestration ────────────────────────────────────────────────────────────
function main(): void {
  mkdirSync(OUT, { recursive: true });

  const denominations: Denomination[] = [];
  const stateStats: StateStat[] = [];
  const bands: AttendanceBand[] = [];
  const contacts: NetworkContact[] = [];

  // Connected Churches workbook.
  for (const sheet of sheetNames(CC)) {
    const rows = sheetRows(CC, sheet);
    if (/^all denominations$/i.test(sheet)) { denominations.push(...parseDenominationMaster(rows)); continue; }
    const label = denomLabel(rows);
    if (findStateHeader(rows) >= 0) stateStats.push(...parseStateStats(rows, label, 'denomination', `CC:${sheet}`));
    bands.push(...parseAttendanceBands(rows, label, `CC:${sheet}`));
    contacts.push(...parseNetworkContacts(rows, label, `CC:${sheet}`));
  }

  // Mega Church Dashboard — state-by-state mega/multisite density (cross-denomination).
  for (const sheet of sheetNames(MC)) {
    const rows = sheetRows(MC, sheet);
    if (findStateHeader(rows) >= 0) stateStats.push(...parseStateStats(rows, null, 'mega', `MC:${sheet}`));
  }

  // Dedupe contacts by (denomination, name, email).
  const seenC = new Set<string>();
  const dedupContacts = contacts.filter((c) => {
    const k = `${c.denomination}|${c.name}|${c.email ?? ''}`.toLowerCase();
    if (seenC.has(k)) return false; seenC.add(k); return true;
  });

  // 5. Prospecting priority.
  //   - by_denomination: the strategic TAM view (all 233 from the master).
  //   - deep_denominations: the 4 with full state-level field-team density.
  //   - by_state_mega: where the mega/multisite density actually is.
  const denomTotals = new Map<string, { denomination: string; field_churches: number; field_staff: number; states: number }>();
  for (const s of stateStats) {
    if (!s.denomination) continue;
    const e = denomTotals.get(s.denomination) ?? { denomination: s.denomination, field_churches: 0, field_staff: 0, states: 0 };
    e.field_churches += s.total_churches ?? 0;
    e.field_staff += s.total_staff ?? 0;
    if (s.total_churches) e.states += 1;
    denomTotals.set(s.denomination, e);
  }
  const megaByState = new Map<string, number>();
  for (const s of stateStats) if (s.scope === 'mega') megaByState.set(s.state, s.mega_churches ?? 0);
  const prospectPriority = {
    by_denomination: denominations
      .filter((d) => d.churches)
      .map((d) => ({ denomination: d.denomination, movement_family: d.movement_family, churches: d.churches, membership: d.membership, website: d.website }))
      .sort((a, b) => (b.churches ?? 0) - (a.churches ?? 0)),
    deep_denominations: [...denomTotals.values()].sort((a, b) => b.field_churches - a.field_churches),
    by_state_mega: [...megaByState.entries()].map(([state, mega_churches]) => ({ state, mega_churches })).sort((a, b) => b.mega_churches - a.mega_churches),
  };

  const write = (name: string, data: unknown) => writeFileSync(join(OUT, name), JSON.stringify(data, null, 2));
  write('denominations.json', denominations);
  write('denomination_state_stats.json', stateStats);
  write('attendance_bands.json', bands);
  write('network_contacts.json', dedupContacts);
  write('prospect_priority.json', prospectPriority);

  // Summary.
  const withEmail = dedupContacts.filter((c) => c.email).length;
  const summary = [
    `# Extraction summary — Connected Churches workbooks`,
    ``,
    `Source: data/sources/connected_churches.xlsx + data/sources/mega_church_dashboard.xlsx`,
    `Generated by \`npm run ingest:reference\`. Aggregate intelligence — NO individual-church rows exist in either file.`,
    ``,
    `| artifact | rows |`,
    `|---|---|`,
    `| denominations.json | ${denominations.length} |`,
    `| denomination_state_stats.json | ${stateStats.length} (${stateStats.filter((s) => s.scope === 'mega').length} mega) |`,
    `| attendance_bands.json | ${bands.length} |`,
    `| network_contacts.json | ${dedupContacts.length} (${withEmail} with email) |`,
    ``,
    `## Top denominations by church count (strategic TAM)`,
    ...prospectPriority.by_denomination.slice(0, 12).map((d) => `- ${d.denomination}: ${(d.churches ?? 0).toLocaleString()} churches${d.membership ? ` · ${d.membership.toLocaleString()} members` : ''}`),
    ``,
    `## Top states by mega/multisite density`,
    ...prospectPriority.by_state_mega.slice(0, 12).map((s) => `- ${s.state}: ${s.mega_churches} mega/multisite`),
    ``,
  ].join('\n');
  writeFileSync(join(OUT, 'EXTRACTION_SUMMARY.md'), summary);

  console.log(summary);
  console.log(`\nWrote 5 JSON artifacts + EXTRACTION_SUMMARY.md to ${OUT}/`);
}

main();
