import { z } from 'zod';
import type { SourceFinding } from '../research/dossier.js';
import type { ResearchConflict } from '../types.js';

export const LIFECYCLE_VALUES = [
  'plant', 'growing', 'established', 'relaunch_revitalization', 'plateaued',
  'declining', 'merged', 'closed', 'unknown',
] as const;

const APP_STATUS_VALUES = ['active', 'planned', 'none_found', 'unknown'] as const;

// ── tolerant coercion (real Claude output is not perfectly typed) ────────────
function coerceNum(v: unknown, def: number | null): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : def;
  if (typeof v === 'string') {
    const t = v.trim().toLowerCase();
    if (!t) return def;
    if (/very\s*low/.test(t)) return 20;
    if (/\blow\b/.test(t)) return 35;
    if (/medium|moderate|mid/.test(t)) return 55;
    if (/\bhigh\b/.test(t)) return 80;
    const n = parseFloat(t.replace(/[^0-9.\-]/g, ''));
    if (Number.isFinite(n)) return n;
  }
  return def;
}
function str(v: unknown, def = ''): string {
  return typeof v === 'string' ? v : v == null ? def : String(v);
}
function strOrNull(v: unknown): string | null {
  return v == null || v === '' ? null : String(v);
}
function arrStr(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => str(x)).filter(Boolean) : [];
}
/** Map a free-text lifecycle to the enum (Claude often returns a synonym). */
function coerceLifecycle(v: unknown): string {
  const t = str(v).toLowerCase().trim();
  if ((LIFECYCLE_VALUES as readonly string[]).includes(t)) return t;
  if (/relaunch|revitaliz|replant|refresh|reset|rebirth|renew/.test(t)) return 'relaunch_revitalization';
  if (/church\s*plant|\bplant(ed|ing)?\b|launching|new church|startup/.test(t)) return 'plant';
  if (/plateau|stagnant|\bflat\b|steady|stable/.test(t)) return 'plateaued';
  if (/declin|dying|shrink|aging|waning/.test(t)) return 'declining';
  if (/grow|expanding|momentum|thriving/.test(t)) return 'growing';
  if (/establish|legacy|institution|mature|long-?standing/.test(t)) return 'established';
  if (/merg/.test(t)) return 'merged';
  if (/clos|defunct|dissolved|shut/.test(t)) return 'closed';
  return 'unknown';
}
function fieldVal(v: unknown): string | number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') return v;
  if (v == null) return null;
  return String(v);
}
function normField(x: unknown): { field_name: string; value: string | number | null; confidence: number; evidence: string; access_level?: string } | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  const fn = str(o.field_name ?? o.field ?? o.name).trim();
  const value = fieldVal(o.value);
  if (!fn && value == null) return null; // drop empty entries
  return {
    field_name: fn || 'unknown',
    value,
    confidence: coerceNum(o.confidence, 0) ?? 0,
    evidence: str(o.evidence ?? o.evidence_text),
    access_level: typeof o.access_level === 'string' ? o.access_level : undefined,
  };
}

/** Normalize a raw (possibly malformed) Claude object into the expected shape. */
function normalizeSynthesisRaw(input: unknown): unknown {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const lifecycle = coerceLifecycle(o.lifecycle_stage);
  const appStatus = (APP_STATUS_VALUES as readonly string[]).includes(str(o.church_app_status)) ? o.church_app_status : 'unknown';
  return {
    identity_summary: str(o.identity_summary),
    digital_summary: str(o.digital_summary),
    staff_summary: str(o.staff_summary),
    growth_summary: str(o.growth_summary),
    lifecycle_summary: str(o.lifecycle_summary),
    research_summary: str(o.research_summary),
    lifecycle_stage: lifecycle,
    growth_orientation_score: coerceNum(o.growth_orientation_score, null),
    digital_maturity_score: coerceNum(o.digital_maturity_score, null),
    change_readiness_score: coerceNum(o.change_readiness_score, null),
    staff_depth_score: coerceNum(o.staff_depth_score, null),
    church_app_status: appStatus,
    app_provider: strOrNull(o.app_provider),
    lead_pastor: strOrNull(o.lead_pastor),
    denomination: strOrNull(o.denomination),
    online_attendance_estimate: coerceNum(o.online_attendance_estimate, null),
    online_attendance_confidence: coerceNum(o.online_attendance_confidence, 0) ?? 0,
    attendance_estimate: coerceNum(o.attendance_estimate, null),
    attendance_min: coerceNum(o.attendance_min, null),
    attendance_max: coerceNum(o.attendance_max, null),
    attendance_confidence: coerceNum(o.attendance_confidence, 0) ?? 0,
    staff_count: coerceNum(o.staff_count, null),
    staff_count_confidence: coerceNum(o.staff_count_confidence, 0) ?? 0,
    campus_count: coerceNum(o.campus_count, null),
    campus_count_confidence: coerceNum(o.campus_count_confidence, 0) ?? 0,
    fields: Array.isArray(o.fields) ? o.fields.map(normField).filter((f): f is NonNullable<typeof f> => f !== null) : [],
    known: arrStr(o.known),
    uncertain: arrStr(o.uncertain),
  };
}

const synthField = z.object({
  field_name: z.string(),
  value: z.union([z.string(), z.number(), z.null()]),
  confidence: z.number(),
  evidence: z.string(),
  access_level: z.string().optional(),
});

const dossierSynthesisInner = z.object({
  identity_summary: z.string(),
  digital_summary: z.string(),
  staff_summary: z.string(),
  growth_summary: z.string(),
  lifecycle_summary: z.string(),
  research_summary: z.string(),
  lifecycle_stage: z.enum(LIFECYCLE_VALUES),
  growth_orientation_score: z.number().nullable(),
  digital_maturity_score: z.number().nullable(),
  change_readiness_score: z.number().nullable(),
  staff_depth_score: z.number().nullable(),
  church_app_status: z.enum(APP_STATUS_VALUES),
  app_provider: z.string().nullable(),
  lead_pastor: z.string().nullable(),
  denomination: z.string().nullable(),
  online_attendance_estimate: z.number().nullable(),
  online_attendance_confidence: z.number(),
  attendance_estimate: z.number().nullable(),
  attendance_min: z.number().nullable(),
  attendance_max: z.number().nullable(),
  attendance_confidence: z.number(),
  staff_count: z.number().nullable(),
  staff_count_confidence: z.number(),
  campus_count: z.number().nullable(),
  campus_count_confidence: z.number(),
  fields: z.array(synthField),
  known: z.array(z.string()),
  uncertain: z.array(z.string()),
});

/** Tolerant schema: normalizes malformed Claude output before validation. */
export const dossierSynthesisSchema = z.preprocess(normalizeSynthesisRaw, dossierSynthesisInner);
export type DossierSynthesis = z.infer<typeof dossierSynthesisInner>;

export function renderFindings(findings: SourceFinding[], maxChars = 8000): string {
  const lines: string[] = [];
  for (const f of findings) {
    const body = (f.fetched ? f.text : f.snippet) ?? '';
    // Staff/leadership pages carry the names+titles the synthesis needs; give them
    // more room (1500 vs 400 chars) so pastor names past the first 400 aren't cut.
    const bodyLimit = f.sourceType === 'staff_page' ? 1500 : 400;
    lines.push(
      `- [${f.sourceType} | access=${f.accessLevel} | fetched=${f.fetched} | rel=${f.reliability}] ${f.url}` +
        (f.title ? `\n   title: ${f.title}` : '') +
        (body ? `\n   text: ${body.slice(0, bodyLimit)}` : '') +
        (f.fields.length ? `\n   extracted: ${f.fields.map((x) => `${x.field_name}=${x.value}`).join('; ')}` : ''),
    );
  }
  return lines.join('\n').slice(0, maxChars);
}

export const dossierSynthesisPrompt = {
  system: `You are a church research analyst building a DOSSIER from MULTIPLE public
source types (official site, search snippets, social, staff pages, job postings,
directories, news, vendor references). Triangulate evidence the way a careful
human analyst would.

RULES:
- Establish "this is THE site for THIS church" — never confuse a same-named church
  in another city, and never treat a vendor/contractor or news page as the church.
- Avoid false PRECISION, not estimates. For SIZE (attendance, staff_count,
  campus_count) ALWAYS give a best estimate when any indirect signal exists
  (service count, building, social following, "a church in <city>"): a BROAD
  attendance_min/max range with Low/Very-Low confidence. Use null ONLY when there
  is genuinely zero signal. Most churches are single-campus → campus_count = 1
  unless there is explicit multi-site language.
- If the official website was NOT fetched (no access_level=live_official_site
  finding), say so and keep confidence modest — the platform will additionally CAP
  it. Vendor/news evidence is supporting only.
- lifecycle_stage MUST be exactly one of: plant, growing, established,
  relaunch_revitalization, plateaued, declining, merged, closed, unknown. A church
  that recently relaunched/rebranded/replanted (e.g. a long-standing church that
  "relaunched" or "revitalized") = relaunch_revitalization — do NOT return unknown
  when the narrative clearly indicates a stage.
- Score the strategic scores from real signals (relaunch/rebrand → change_readiness;
  hiring/new ministries → growth & staff_depth; app/livestream/giving/social → digital maturity).
- For every field in "fields", attach the evidence and the source access_level.`,
  user(opts: {
    name: string; city: string | null; state: string | null;
    officialSite: string | null; officialCrawled: boolean; renderedDomUsed?: boolean;
    findings: SourceFinding[]; conflicts: ResearchConflict[]; contamination: string[];
    facts?: Record<string, { value: string | number | boolean; confidence: number; source_url: string }>;
  }): string {
    const factLines = opts.facts && Object.keys(opts.facts).length
      ? Object.entries(opts.facts).map(([k, v]) => `- ${k} = ${v.value} (conf ${v.confidence}, ${v.source_url})`).join('\n')
      : '- none';
    return `CHURCH: ${opts.name}
LOCATION: ${[opts.city, opts.state].filter(Boolean).join(', ') || 'unknown'}
OFFICIAL SITE (identity): ${opts.officialSite ?? 'NOT CONFIDENTLY IDENTIFIED'}
OFFICIAL SITE DOM FETCHED: ${opts.officialCrawled ? (opts.renderedDomUsed ? 'yes (rendered with a headless browser — full DOM available)' : 'yes (plain fetch)') : 'NO — only indexed snippets/third-party sources available; cap confidence'}

CONFLICTS DETECTED (preserve, do not resolve silently):
${opts.conflicts.length ? opts.conflicts.map((c) => `- ${c.field_name}: "${c.value_a}" (${c.source_a}) vs "${c.value_b}" (${c.source_b})`).join('\n') : '- none'}

CONTAMINATION FLAGS:
${opts.contamination.length ? opts.contamination.map((c) => `- ${c}`).join('\n') : '- none'}

DETERMINISTIC EXTRACTIONS (regex over the evidence — confirm or override these):
${factLines}

EVIDENCE (${opts.findings.length} findings):
${renderFindings(opts.findings)}

Return a JSON dossier with the schema fields: identity_summary, digital_summary,
staff_summary, growth_summary, lifecycle_summary, research_summary, lifecycle_stage,
growth_orientation_score, digital_maturity_score, change_readiness_score,
staff_depth_score, church_app_status, app_provider, lead_pastor, denomination,
online_attendance_estimate, online_attendance_confidence, attendance_estimate,
attendance_min, attendance_max, attendance_confidence, staff_count,
staff_count_confidence, campus_count, campus_count_confidence, fields[], known[], uncertain[].`;
  },
  schema: dossierSynthesisSchema,
};
