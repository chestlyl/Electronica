import type { ImportRecord } from '../types.js';

/** Target field -> list of accepted header synonyms (lowercased, trimmed). */
const SYNONYMS: Record<string, string[]> = {
  rowid: ['s.no', 'sno', 's no', 'id', 'row', 'row id', '#'],
  name: ['organization name', 'church name', 'name', 'org name'],
  parent: ['parent organization name', 'parent organization', 'parent', 'district', 'region', 'network'],
  address1: ['address 1', 'address1', 'address', 'street', 'street address'],
  address2: ['address 2', 'address2', 'suite', 'unit'],
  city: ['city'],
  state: ['state', 'province', 'st'],
  zip: ['postal code', 'zip', 'zip code', 'zipcode', 'postcode'],
  country: ['country'],
  phone: ['phone number', 'phone', 'telephone', 'tel'],
  email: ['email', 'e-mail', 'email address'],
  website: ['website', 'url', 'web', 'web site', 'site'],
  urlname: ['url name', 'urlname', 'alt name', 'alternate name'],
  language: ['language', 'languages', 'primary language'],
};

export type ColumnMap = Record<string, number>;

/** Detect column indices from the header row. Unmatched headers are ignored. */
export function detectColumns(headers: unknown[]): ColumnMap {
  const norm = headers.map((h) => String(h ?? '').trim().toLowerCase());
  const map: ColumnMap = {};
  for (const [field, syns] of Object.entries(SYNONYMS)) {
    // exact match first, then "contains"
    let idx = norm.findIndex((h) => syns.includes(h));
    if (idx === -1) idx = norm.findIndex((h) => h && syns.some((s) => h === s));
    if (idx === -1) idx = norm.findIndex((h) => h && syns.some((s) => h.includes(s)));
    if (idx !== -1) map[field] = idx;
  }
  return map;
}

function cell(row: unknown[], idx: number | undefined): string | null {
  if (idx === undefined) return null;
  const v = row[idx];
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

/** True if a value doesn't look like a real church name (data-quality issue). */
function looksLikeBadName(name: string | null): boolean {
  if (!name) return true;
  // Excel time/number coercion artifacts, e.g. "1:08:00" or pure numbers.
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(name)) return true;
  if (/^\d+(\.\d+)?$/.test(name)) return true;
  return false;
}

export interface MappedRow {
  record: ImportRecord;
  warnings: string[];
}

export function mapRow(row: unknown[], map: ColumnMap, fallbackIndex: number): MappedRow {
  const warnings: string[] = [];

  const sno = cell(row, map.rowid);
  const original_row_id = `row-${sno ?? fallbackIndex}`;

  let name = cell(row, map.name);
  if (looksLikeBadName(name)) {
    warnings.push(`suspect name value "${name}" — needs manual review`);
  }

  const addr = [cell(row, map.address1), cell(row, map.address2)].filter(Boolean).join(', ') || null;

  const parent = cell(row, map.parent);
  const urlname = cell(row, map.urlname);
  const noteParts: string[] = [];
  if (parent) noteParts.push(`Seed parent org: ${parent}`);
  if (urlname) noteParts.push(`Seed alt name: ${urlname}`);
  if (warnings.length) noteParts.push(`Import warnings: ${warnings.join('; ')}`);

  const record: ImportRecord = {
    original_row_id,
    name,
    address: addr,
    city: cell(row, map.city),
    state: cell(row, map.state),
    zip: cell(row, map.zip),
    country: cell(row, map.country) ?? 'United States',
    phone_original: cell(row, map.phone),
    email_original: cell(row, map.email),
    website_original: cell(row, map.website),
    language: cell(row, map.language)?.replace(/^\s*,?\s*/, '') ?? null,
    // Parent org is a strong seed hint but unverified — kept as a starting value.
    network_affiliation: parent,
    notes: noteParts.length ? noteParts.join(' | ') : null,
  };

  return { record, warnings };
}
