import { readFileSync } from 'node:fs';
import { capForAccess } from './dossier.js';
import type { DossierBuild, ResearchTarget } from './researchAgent.js';

/** A value + its confidence from one of the three calibration sources. */
export interface Cell {
  value: string | number | boolean | null;
  confidence: number | null;
}
export type FieldMap = Record<string, Cell>;

type FieldType = 'string' | 'enum' | 'bool' | 'number';
// `meta` fields are pipeline facts (not snippet-derived church claims), so they
// are exempt from the evidence-access confidence cap.
interface FieldSpec { key: string; label: string; type: FieldType; tol?: number; meta?: boolean }

/** Canonical calibration vocabulary shared by tool / Claude / ground-truth. */
export const FIELDS: FieldSpec[] = [
  { key: 'church_name', label: 'Church name', type: 'string' },
  { key: 'city', label: 'City', type: 'string' },
  { key: 'state', label: 'State', type: 'string' },
  { key: 'lead_pastor', label: 'Lead pastor', type: 'string' },
  { key: 'lead_pastor_role', label: 'Lead pastor role', type: 'string' },
  { key: 'executive_pastor', label: 'Executive pastor', type: 'string' },
  { key: 'operations_leader', label: 'Operations leader', type: 'string' },
  { key: 'communications_leader', label: 'Communications leader', type: 'string' },
  { key: 'office_email', label: 'Office email', type: 'string' },
  { key: 'office_phone', label: 'Office phone', type: 'string' },
  { key: 'denomination', label: 'Denomination', type: 'string' },
  { key: 'multi_site', label: 'Multi-site?', type: 'bool' },
  { key: 'campus_count', label: 'Campus count', type: 'number', tol: 0 },
  { key: 'lifecycle_stage', label: 'Lifecycle stage', type: 'enum' },
  { key: 'founded_year', label: 'Founded year', type: 'number', tol: 0.01 },
  { key: 'years_active', label: 'Years active', type: 'number', tol: 0.06 },
  { key: 'avg_weekly_attendance', label: 'Avg weekly attendance', type: 'number', tol: 0.35 },
  { key: 'online_attendance_estimate', label: 'Online attendance', type: 'number', tol: 0.45 },
  { key: 'staff_count', label: 'Staff count', type: 'number', tol: 0.4 },
  { key: 'annual_budget', label: 'Annual budget', type: 'number', tol: 0.5 },
  { key: 'church_app_status', label: 'App status', type: 'enum' },
  { key: 'app_provider', label: 'App provider', type: 'string' },
  { key: 'livestream_present', label: 'Livestream present', type: 'bool' },
  { key: 'youtube_present', label: 'YouTube present', type: 'bool' },
  { key: 'instagram_present', label: 'Instagram present', type: 'bool' },
  { key: 'facebook_present', label: 'Facebook present', type: 'bool' },
  { key: 'instagram_followers', label: 'Instagram followers', type: 'number', tol: 0.2 },
  { key: 'facebook_followers', label: 'Facebook followers', type: 'number', tol: 0.2 },
  { key: 'online_giving_present', label: 'Online giving present', type: 'bool' },
  { key: 'change_readiness_score', label: 'Change readiness', type: 'number', tol: 0.25 },
  { key: 'digital_maturity_score', label: 'Digital maturity', type: 'number', tol: 0.25 },
  { key: 'growth_orientation_score', label: 'Growth orientation', type: 'number', tol: 0.25 },
  { key: 'staff_depth_score', label: 'Staff depth', type: 'number', tol: 0.25 },
  { key: 'evidence_access_level', label: 'Evidence access level', type: 'string', meta: true },
  { key: 'identity_contamination_flag', label: 'Contamination flag', type: 'bool', meta: true },
];

// ── value parsing / comparison ──────────────────────────────────────────────
function toNum(v: unknown): number | null {
  if (typeof v === 'number') return v;
  if (v == null) return null;
  const s = String(v).replace(/,/g, '');
  const m = s.match(/(-?\d+(?:\.\d+)?)\s*([kKmM])?/);
  if (!m) return null;
  let n = parseFloat(m[1]);
  if (/[kK]/.test(m[2] ?? '')) n *= 1_000;
  if (/[mM]/.test(m[2] ?? '')) n *= 1_000_000;
  return n;
}
function toBool(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v;
  if (v == null) return null;
  const s = String(v).trim().toLowerCase();
  if (['true', 'yes', 'y', '1'].includes(s)) return true;
  if (['false', 'no', 'n', '0'].includes(s)) return false;
  return null;
}
function norm(v: unknown): string {
  return String(v ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function valuesEqual(spec: FieldSpec, a: unknown, b: unknown): boolean {
  switch (spec.type) {
    case 'number': {
      const na = toNum(a), nb = toNum(b);
      if (na == null || nb == null) return false;
      const tol = spec.tol ?? 0.2;
      return Math.abs(na - nb) <= Math.max(Math.abs(nb), 1) * tol;
    }
    case 'bool': {
      const ba = toBool(a), bb = toBool(b);
      return ba != null && ba === bb;
    }
    case 'enum':
      return norm(a) === norm(b) && norm(a) !== '';
    default: {
      const na = norm(a), nb = norm(b);
      if (!na || !nb) return false;
      return na === nb || (na.length > 2 && nb.length > 2 && (na.includes(nb) || nb.includes(na)));
    }
  }
}

const isEmpty = (v: unknown) => v === null || v === undefined || v === '';

export type FieldStatus = 'correct' | 'wrong' | 'missing' | 'unverified';

export interface FieldComparison {
  key: string;
  label: string;
  tool: Cell;
  claude: Cell;
  truth: Cell;
  status: FieldStatus;       // tool vs ground truth
  overconfident: boolean;    // wrong but confident
  underconfident: boolean;   // correct but low confidence
  cappedAtCeiling: boolean;  // correct and pinned at the access cap
  capCostVsClaude: boolean;  // correct, but capped well below Claude's confidence
  closerToTruth: 'tool' | 'claude' | 'tie' | 'na';
}

export interface CalibrationReport {
  comparisons: FieldComparison[];
  accessLevel: string;
  cap: number;
  capViolations: string[];
  correct: string[];
  wrong: string[];
  overconfident: string[];
  underconfident: string[];
  missing: string[];
  cappedButCorrect: string[];
  capCost: string[];
  toolCloser: string[];
  claudeCloser: string[];
  conflicts: { field: string; a: string; b: string; recommended: string; confidence: number | null }[];
  hasGroundTruth: boolean;
}

function distance(spec: FieldSpec, v: unknown, truth: unknown): number {
  if (isEmpty(v)) return Number.POSITIVE_INFINITY;
  if (spec.type === 'number') {
    const a = toNum(v), b = toNum(truth);
    if (a == null || b == null) return Number.POSITIVE_INFINITY;
    return Math.abs(a - b) / Math.max(Math.abs(b), 1);
  }
  return valuesEqual(spec, v, truth) ? 0 : 1;
}

const cell = (m: FieldMap, k: string): Cell => m[k] ?? { value: null, confidence: null };

export function compareCalibration(tool: FieldMap, claude: FieldMap, truth: FieldMap, accessLevel: string): CalibrationReport {
  const cap = capForAccess(accessLevel as any);
  const r: CalibrationReport = {
    comparisons: [], accessLevel, cap, capViolations: [],
    correct: [], wrong: [], overconfident: [], underconfident: [], missing: [],
    cappedButCorrect: [], capCost: [], toolCloser: [], claudeCloser: [],
    conflicts: [], hasGroundTruth: Object.values(truth).some((c) => !isEmpty(c?.value)),
  };

  for (const spec of FIELDS) {
    const t = cell(tool, spec.key), c = cell(claude, spec.key), g = cell(truth, spec.key);
    if (!spec.meta && t.confidence != null && t.confidence > cap) r.capViolations.push(`${spec.key} (${t.confidence} > ${cap})`);

    let status: FieldStatus;
    if (isEmpty(g.value)) status = 'unverified';
    else if (isEmpty(t.value)) status = 'missing';
    else status = valuesEqual(spec, t.value, g.value) ? 'correct' : 'wrong';

    const tc = t.confidence ?? 0;
    const overconfident = status === 'wrong' && tc >= 60;
    const underconfident = status === 'correct' && tc < 50;
    const cappedAtCeiling = !spec.meta && status === 'correct' && t.confidence != null && t.confidence >= cap - 1;
    const capCostVsClaude = !spec.meta && status === 'correct' && c.confidence != null && t.confidence != null && c.confidence - t.confidence >= 15;

    let closerToTruth: FieldComparison['closerToTruth'] = 'na';
    if (status !== 'unverified') {
      const dt = distance(spec, t.value, g.value), dc = distance(spec, c.value, g.value);
      closerToTruth = dt < dc ? 'tool' : dc < dt ? 'claude' : Number.isFinite(dt) ? 'tie' : 'na';
    }

    r.comparisons.push({ key: spec.key, label: spec.label, tool: t, claude: c, truth: g, status, overconfident, underconfident, cappedAtCeiling, capCostVsClaude, closerToTruth });
    if (status === 'correct') r.correct.push(spec.key);
    if (status === 'wrong') r.wrong.push(spec.key);
    if (status === 'missing') r.missing.push(spec.key);
    if (overconfident) r.overconfident.push(spec.key);
    if (underconfident) r.underconfident.push(spec.key);
    if (cappedAtCeiling) r.cappedButCorrect.push(spec.key);
    if (capCostVsClaude) r.capCost.push(spec.key);
    if (closerToTruth === 'tool') r.toolCloser.push(spec.key);
    if (closerToTruth === 'claude') r.claudeCloser.push(spec.key);
  }
  return r;
}

/** Extract the canonical tool field map from a dossier build. */
export function toolFieldsFromBuild(target: ResearchTarget, build: DossierBuild): FieldMap {
  const s = build.synthesis;
  const st = build.strategic;
  const I = build.interpretation; // single source of truth for conclusions
  const cap = capForAccess(build.accessLevel);
  const fe = Object.fromEntries(build.fieldEstimates.map((f) => [f.field_name, f]));
  const present = new Set(build.findings.map((f) => f.sourceType));
  const extracted = (name: string): string | number | null =>
    (build.findings.flatMap((f) => f.fields).find((x) => x.field_name === name)?.value as string | number | undefined) ?? null;
  const roleConflict = build.conflicts.find((c) => c.field_name === 'lead_pastor_role');
  const capc = (n: number | null | undefined) => (n == null ? cap : Math.min(n, cap));
  const fact = (k: string): Cell => (build.facts[k] ? { value: build.facts[k].value, confidence: capc(build.facts[k].confidence) } : { value: null, confidence: null });
  const factOr = (k: string, value: string | number | null, conf: number): Cell =>
    build.facts[k] ? fact(k) : { value, confidence: value == null ? null : capc(conf) };

  return {
    church_name: { value: target.name, confidence: capc(build.identity.identity_confidence || 60) },
    city: { value: target.city, confidence: capc(60) },
    state: { value: target.state, confidence: capc(60) },
    // Lead pastor is an INTERPRETATION conclusion (Layer 4), not a raw fact — the
    // calibration field map surfaces the same value report + enrich consume.
    lead_pastor: { value: build.interpretation.lead_pastors.value[0] ?? null, confidence: capc(build.interpretation.lead_pastors.confidence || fe.lead_pastor?.confidence) },
    lead_pastor_role: { value: roleConflict?.recommended_value ?? null, confidence: roleConflict?.confidence ?? null },
    // Contacts + roles are INTERPRETATION conclusions (single source of truth).
    executive_pastor: { value: build.interpretation.executive_pastor.value, confidence: capc(build.interpretation.executive_pastor.confidence) },
    operations_leader: { value: build.interpretation.operations_leader.value, confidence: capc(build.interpretation.operations_leader.confidence) },
    communications_leader: { value: build.interpretation.communications_leader.value, confidence: capc(build.interpretation.communications_leader.confidence) },
    office_email: { value: build.interpretation.office_email.value, confidence: capc(build.interpretation.office_email.confidence) },
    office_phone: { value: build.interpretation.office_phone.value, confidence: capc(build.interpretation.office_phone.confidence) },
    denomination: { value: I.denomination.value, confidence: capc(I.denomination.confidence || 65) },
    multi_site: fact('multi_site'),
    campus_count: fact('campus_count'),
    lifecycle_stage: { value: I.lifecycle_stage.value, confidence: capc(I.lifecycle_stage.confidence) },
    founded_year: fact('founded_year'),
    years_active: fact('years_active'),
    avg_weekly_attendance: { value: I.attendance_estimate.value, confidence: I.attendance_estimate.value == null ? null : capc(I.attendance_estimate.confidence) },
    online_attendance_estimate: { value: s.online_attendance_estimate, confidence: st.online_attendance_confidence ?? null },
    staff_count: { value: build.interpretation.staff_count.value, confidence: capc(build.interpretation.staff_count.confidence) },
    annual_budget: { value: null, confidence: null },
    church_app_status: factOr('app_status', s.church_app_status, 60),
    app_provider: factOr('app_provider', s.app_provider, 40),
    livestream_present: { value: present.has('youtube') || /livestream|live/i.test(s.digital_summary), confidence: capc(65) },
    youtube_present: { value: present.has('youtube'), confidence: capc(65) },
    instagram_present: { value: present.has('instagram'), confidence: capc(65) },
    facebook_present: { value: present.has('facebook'), confidence: capc(65) },
    instagram_followers: { value: extracted('instagram_followers'), confidence: capc(60) },
    facebook_followers: { value: extracted('facebook_followers'), confidence: capc(60) },
    online_giving_present: fact('online_giving_present'),
    // Score VALUES are unchanged (from synthesis); CONFIDENCE is coverage-aware.
    // Score VALUES + confidence are INTERPRETATION conclusions (single producer).
    change_readiness_score: { value: I.change_readiness_score.value, confidence: capc(I.change_readiness_score.confidence) },
    digital_maturity_score: { value: I.digital_maturity_score.value, confidence: capc(I.digital_maturity_score.confidence) },
    growth_orientation_score: { value: I.growth_orientation_score.value, confidence: capc(I.growth_orientation_score.confidence) },
    staff_depth_score: { value: I.staff_depth_score.value, confidence: capc(I.staff_depth_score.confidence) },
    evidence_access_level: { value: build.accessLevel, confidence: 90 },
    identity_contamination_flag: { value: st.identity_contamination_flag ?? false, confidence: 80 },
  };
}

export function loadFieldMap(path: string): FieldMap {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, any>;
  const out: FieldMap = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k.startsWith('_')) continue;
    if (v && typeof v === 'object' && 'value' in v) out[k] = { value: v.value ?? null, confidence: v.confidence ?? null };
    else out[k] = { value: v ?? null, confidence: null };
  }
  return out;
}
