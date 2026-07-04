/**
 * Manual import/export of the churches table. Pure serialize/parse so it is
 * unit-testable offline; the CLI wires these to Supabase.
 *
 * Import is SAFE + idempotent: it upserts a curated set of human-editable fields
 * keyed on original_row_id (generated from name+state when absent). Columns not
 * present in the source are left untouched — scores/evidence are never clobbered
 * unless you explicitly provide them.
 */

// Curated, human-editable columns for round-tripping (not the whole row).
export const CHURCH_TEXT_COLS = [
  "original_row_id", "name", "city", "state", "zip",
  "website_verified", "email_verified", "phone_verified",
  "lead_pastor", "denomination", "network_affiliation", "language",
  "active_status", "notes",
] as const;
export const CHURCH_NUM_COLS = ["attendance_estimate", "mmc_fit_score"] as const;
export const CHURCH_IO_COLS: string[] = [...CHURCH_TEXT_COLS, ...CHURCH_NUM_COLS];

const NUM_SET = new Set<string>(CHURCH_NUM_COLS);

export type ChurchIORow = Record<string, string | number | null>;

// ── CSV ──────────────────────────────────────────────────────────────────────
function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
/** Serialize rows to CSV over the given columns (header row included). */
export function toCsv(rows: Record<string, unknown>[], cols: string[] = CHURCH_IO_COLS): string {
  const lines = [cols.join(",")];
  for (const r of rows) lines.push(cols.map((c) => csvCell(r[c])).join(","));
  return lines.join("\n") + "\n";
}
/** Parse a CSV (quoted fields, doubled quotes) into header-keyed records. */
export function parseCsv(content: string): Record<string, string>[] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let q = false;
  const push = () => { cur.push(field); field = ""; };
  const endRow = () => { push(); rows.push(cur); cur = []; };
  const text = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") push();
    else if (ch === "\n") endRow();
    else field += ch;
  }
  if (field.length || cur.length) endRow();
  const nonEmpty = rows.filter((r) => r.some((c) => c.trim() !== ""));
  if (!nonEmpty.length) return [];
  const header = nonEmpty[0].map((h) => h.trim());
  return nonEmpty.slice(1).map((cells) => {
    const rec: Record<string, string> = {};
    header.forEach((h, i) => { rec[h] = (cells[i] ?? "").trim(); });
    return rec;
  });
}

// ── import normalization ─────────────────────────────────────────────────────
const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
/** Stable original_row_id from name+state when the source omits one. */
export function makeRowId(name: string, state: string | null | undefined): string {
  return `imp-${slug(name)}${state ? `-${slug(state)}` : ""}`;
}

/** Normalize one source record → a churches upsert payload (only provided keys). */
export function toChurchUpsert(rec: Record<string, unknown>): ChurchIORow | null {
  const name = String(rec.name ?? rec.church ?? "").trim();
  const row: ChurchIORow = {};
  for (const col of CHURCH_IO_COLS) {
    if (!(col in rec)) continue;
    const raw = rec[col];
    if (raw == null || String(raw).trim() === "") continue;
    if (NUM_SET.has(col)) {
      const n = Number(String(raw).replace(/[,%$]/g, ""));
      if (Number.isFinite(n)) row[col] = n;
    } else {
      row[col] = String(raw).trim();
    }
  }
  if (!row.original_row_id) {
    if (!name) return null; // need a name to synthesize an id
    row.original_row_id = makeRowId(name, (rec.state as string) ?? null);
  }
  if (name && !row.name) row.name = name;
  return row;
}

/** Parse an import file (JSON array/object or CSV) → church upsert payloads. */
export function parseChurchesImport(content: string, filename = ""): ChurchIORow[] {
  const trimmed = content.trim();
  let records: Record<string, unknown>[];
  if (filename.endsWith(".json") || trimmed.startsWith("[") || trimmed.startsWith("{")) {
    const data = JSON.parse(trimmed);
    records = Array.isArray(data) ? data : (data.churches ?? []);
  } else {
    records = parseCsv(content);
  }
  return records.map(toChurchUpsert).filter((r): r is ChurchIORow => r !== null);
}
