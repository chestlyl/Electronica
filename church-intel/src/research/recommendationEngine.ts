import { capForAccess } from './dossier.js';
import { DIMENSIONS, type Dimension } from './strategicSignals.js';
import type { Interpretation, NormalizedEvidence } from './evidenceModel.js';
import type { StrategicScores } from './strategicScoring.js';
import type { SizeRelativeProfile } from './sizeRelative.js';
import type { PlatformHit } from './techStack.js';
import type { StrategicSignal } from './strategicSignals.js';
import type { EvidenceAccessLevel } from '../types.js';

/**
 * Strategic Recommendation Engine (Phase 2) — turns church intelligence into an
 * engagement strategy. DETERMINISTIC and REPRODUCIBLE: no Claude, no guessing.
 *
 * Rule 1 — consumes ONLY interpretation-layer outputs (interpretation, normalized
 *          evidence, strategic signals, technology stack, the five rubric scores).
 *          The input type cannot reference raw findings / snippets / crawler data.
 * Rule 2 — every emitted recommendation cites evidence_refs (never empty).
 * Rule 3 — deterministic rule table; same input ⇒ same output, always.
 */

// ── Deliverable 1: schema ─────────────────────────────────────────────────────
export type EngagementPriority = 'high' | 'medium' | 'low';
export type OpportunityLevel = 'low' | 'moderate' | 'high';

export interface EvidenceRef {
  id: string;                                   // stable id (score name, signal id, tech id, leadership/interp field)
  kind: 'score' | 'signal' | 'technology' | 'leadership' | 'interpretation' | 'coverage';
  detail: string;
}

export interface Recommendation<T> {
  value: T;
  evidence_refs: EvidenceRef[];                 // INVARIANT: never empty for an emitted recommendation
  reason: string;
  confidence: number;                           // evidence-driven, capped by access level
}

export interface DimensionAnalysis {
  level: OpportunityLevel;
  findings: string[];
  evidence_refs: EvidenceRef[];
}

export interface RecommendationDimensions {
  digital_opportunity: DimensionAnalysis;
  leadership_opportunity: DimensionAnalysis;
  growth_opportunity: DimensionAnalysis;
  partnership_readiness: DimensionAnalysis;
}

export interface RecommendationEngineResult {
  engagement_fit: Recommendation<number>;            // 0..100 composite (growth-weighted, capacity-gated)
  engagement_priority: Recommendation<EngagementPriority>;
  recommended_first_conversation: Recommendation<string>;
  recommended_entry_point: Recommendation<string>;
  likely_pain_points: Recommendation<string[]>;
  likely_growth_constraints: Recommendation<string[]>;
  recommended_product_fit: Recommendation<string[]>;
  partnership_probability: Recommendation<number>;   // 0..100
  confidence: number;                                 // overall engine confidence
  evidence_refs: EvidenceRef[];                       // union of all cited evidence
  dimensions: RecommendationDimensions;
}

// ── Rule 1 input: interpretation-derived ONLY (no raw findings) ───────────────
export interface RecommendationInput {
  interpretation: Interpretation;
  normalized: NormalizedEvidence;
  scores: StrategicScores;
  strategicSignals: StrategicSignal[];
  dimensionCounts: Record<Dimension, number>;
  technologyStack: PlatformHit[];
  /** Capability-vs-size lens (additive, report-only). Optional for back-compat. */
  sizeRelative?: SizeRelativeProfile;
  accessLevel: EvidenceAccessLevel;
}

// ── derived context (pure function of the allowed inputs) ─────────────────────
interface Ctx {
  dm: number; go: number; oc: number; ct: number;
  awa: number | null;                // attendance (for the mega sweet-spot)
  tech: Set<string>;                 // PlatformHit categories present
  sigCount: (cat: string) => number;
  hasSig: (cat: string) => boolean;
  lifecycle: string;
  archetype: string;
  leadPastors: string[];
  hasExec: boolean; hasDiscipleship: boolean; hasOps: boolean; hasMarketing: boolean; hasComms: boolean; leaderCount: number;
  hasEmail: boolean; hasPhone: boolean;
  knownVerified: boolean;
  accessLevel: EvidenceAccessLevel;
  cap: number;
  breadth: number;                   // non-empty normalized tables
  sizeRelative?: SizeRelativeProfile;
  I: Interpretation;
  scores: StrategicScores;
}

function buildCtx(input: RecommendationInput): Ctx {
  const { interpretation: I, normalized: N, scores, strategicSignals, technologyStack, accessLevel, sizeRelative } = input;
  const sigCat = (cat: string) => strategicSignals.filter((s) => s.category === cat);
  const tech = new Set(technologyStack.map((t) => t.category));
  const breadth = (Object.values(N) as { length: number }[]).filter((t) => t.length > 0).length;
  return {
    dm: scores.digital_maturity.score, go: scores.growth_orientation.score,
    oc: scores.organizational_capacity.score, ct: scores.contactability.score,
    awa: I.attendance_estimate.value,
    tech,
    sigCount: (cat) => sigCat(cat).length,
    hasSig: (cat) => sigCat(cat).length > 0,
    lifecycle: I.lifecycle_stage.value, archetype: I.archetype.value,
    leadPastors: I.lead_pastors.value,
    hasExec: !!I.executive_pastor.value, hasDiscipleship: !!I.discipleship_pastor.value,
    hasOps: !!I.operations_leader.value, hasMarketing: !!I.marketing_director.value, hasComms: !!I.communications_leader.value,
    leaderCount: N.leaders.length,
    hasEmail: !!I.office_email.value, hasPhone: !!I.office_phone.value,
    knownVerified: I.known_church_verified,
    accessLevel, cap: capForAccess(accessLevel), breadth, sizeRelative, I, scores,
  };
}

// ── evidence-ref builders (stable ids, traceable to the frozen layers) ────────
const evScore = (c: Ctx, dim: Dimension): EvidenceRef => ({ id: `${dim}_score`, kind: 'score', detail: `${dim} ${c.scores[dim].score} (${c.scores[dim].band})` });
const evSignal = (c: Ctx, cat: string): EvidenceRef => ({ id: `${cat}_signal`, kind: 'signal', detail: `${cat} signal ×${c.sigCount(cat)}` });
const evTech = (c: Ctx, cat: string): EvidenceRef => ({ id: `tech_${cat}`, kind: 'technology', detail: `${cat} platform present` });
const evLead = (field: string, detail: string): EvidenceRef => ({ id: field, kind: 'leadership', detail });
const evInterp = (id: string, detail: string): EvidenceRef => ({ id, kind: 'interpretation', detail });
const evSize = (c: Ctx): EvidenceRef => ({ id: 'size_relative', kind: 'interpretation', detail: c.sizeRelative ? c.sizeRelative.summary : 'size-relative not assessed' });

// ── Deliverable 3: deterministic rule table (≥20) ─────────────────────────────
type RuleTarget = 'first_conversation' | 'entry_point' | 'pain_point' | 'growth_constraint' | 'product_fit' | 'suppress_digital';
interface RuleOutput { target: RuleTarget; value: string; priority?: number; evidence: EvidenceRef[]; }
interface Rule { id: string; when: (c: Ctx) => boolean; emit: (c: Ctx) => RuleOutput[]; }

export const RULES: Rule[] = [
  // —— first_conversation (priority-ranked) ——
  { id: 'R1_digital_systems', when: (c) => c.dm < 40 && c.ct > 60,
    emit: (c) => [{ target: 'first_conversation', value: 'Digital Systems', priority: 60, evidence: [evScore(c, 'digital_maturity'), evScore(c, 'contactability')] }] },
  { id: 'R2_leadership_pipeline_residency', when: (c) => c.go > 70 && c.hasSig('internship_residency'),
    emit: (c) => [{ target: 'first_conversation', value: 'Leadership Pipeline', priority: 80, evidence: [evScore(c, 'growth_orientation'), evSignal(c, 'internship_residency')] }] },
  { id: 'R3_leadership_pipeline_hiring', when: (c) => c.go > 70 && c.hasSig('jobs_hiring'),
    emit: (c) => [{ target: 'first_conversation', value: 'Leadership Pipeline / Staffing', priority: 75, evidence: [evScore(c, 'growth_orientation'), evSignal(c, 'jobs_hiring')] }] },
  { id: 'R4_leadership_development', when: (c) => c.oc < 45 && c.leaderCount <= 1,
    emit: (c) => [{ target: 'first_conversation', value: 'Leadership Development', priority: 70, evidence: [evScore(c, 'organizational_capacity'), evInterp('staff_depth_score', `staff depth ${c.oc}`)] }] },
  { id: 'R5_network_alignment', when: (c) => c.go > 65 && c.hasSig('network_affiliation'),
    emit: (c) => [{ target: 'first_conversation', value: 'Network / Movement Alignment', priority: 64, evidence: [evScore(c, 'growth_orientation'), evSignal(c, 'network_affiliation')] }] },
  { id: 'R6_revitalization', when: (c) => c.lifecycle === 'plateaued' || c.lifecycle === 'declining',
    emit: (c) => [{ target: 'first_conversation', value: 'Revitalization Strategy', priority: 72, evidence: [evInterp('lifecycle', `lifecycle ${c.lifecycle}`)] }] },
  { id: 'R7_multiplication', when: (c) => /plant|growing|relaunch/.test(c.lifecycle) && c.go > 60,
    emit: (c) => [{ target: 'first_conversation', value: 'Multiplication / Expansion', priority: 68, evidence: [evInterp('lifecycle', `lifecycle ${c.lifecycle}`), evScore(c, 'growth_orientation')] }] },
  { id: 'R8_digital_scaling', when: (c) => c.dm >= 70 && c.go >= 60,
    emit: (c) => [{ target: 'first_conversation', value: 'Digital Discipleship Scaling', priority: 55, evidence: [evScore(c, 'digital_maturity'), evScore(c, 'growth_orientation')] }] },
  { id: 'R9_nextgen', when: (c) => c.hasSig('school_academy'),
    emit: (c) => [{ target: 'first_conversation', value: 'Family / NextGen Ministry Systems', priority: 50, evidence: [evSignal(c, 'school_academy')] }] },
  { id: 'R10_establish_contact', when: (c) => c.ct < 40,
    emit: (c) => [{ target: 'first_conversation', value: 'Establish Contact Pathways', priority: 40, evidence: [evScore(c, 'contactability')] }] },

  // —— entry_point — senior-owner priority order: Lead > Exec > Ops > Comms ——
  // A comms-heavy lift must be OWNED by senior leadership, so the lead pastor is
  // the preferred entry and comms is the weakest (it should not drive the initiative).
  { id: 'R11_entry_lead', when: (c) => c.leadPastors.length > 0,
    emit: (c) => [{ target: 'entry_point', value: 'Lead Pastor', priority: 90, evidence: [evLead('lead_pastors', `lead: ${c.leadPastors.join('; ')}`)] }] },
  { id: 'R12_entry_exec', when: (c) => c.hasExec,
    emit: (c) => [{ target: 'entry_point', value: 'Executive Pastor', priority: 78, evidence: [evLead('executive_pastor', `exec: ${c.I.executive_pastor.value}`)] }] },
  { id: 'R12b_entry_discipleship', when: (c) => c.hasDiscipleship,
    emit: (c) => [{ target: 'entry_point', value: 'Discipleship Pastor', priority: 66, evidence: [evLead('discipleship_pastor', `discipleship: ${c.I.discipleship_pastor.value}`)] }] },
  { id: 'R13_entry_ops', when: (c) => c.hasOps,
    emit: (c) => [{ target: 'entry_point', value: 'Operations Leader', priority: 55, evidence: [evLead('operations_leader', `ops: ${c.I.operations_leader.value}`)] }] },
  { id: 'R13b_entry_marketing', when: (c) => c.hasMarketing,
    emit: (c) => [{ target: 'entry_point', value: 'Marketing / Digital Director', priority: 45, evidence: [evLead('marketing_director', `marketing: ${c.I.marketing_director.value}`)] }] },
  { id: 'R14_entry_comms', when: (c) => c.hasComms,
    emit: (c) => [{ target: 'entry_point', value: 'Communications Leader (support, not driver)', priority: 35, evidence: [evLead('communications_leader', `comms: ${c.I.communications_leader.value}`)] }] },
  { id: 'R15_entry_office', when: (c) => c.leadPastors.length === 0 && !c.hasExec && !c.hasOps && !c.hasComms && (c.hasEmail || c.hasPhone),
    emit: (c) => [{ target: 'entry_point', value: 'General Office Contact', priority: 30, evidence: [c.hasEmail ? evInterp('office_email', 'office email') : evInterp('office_phone', 'office phone')] }] },

  // —— pain_points ——
  { id: 'R16_pain_pipeline', when: (c) => c.oc < 45,
    emit: (c) => [{ target: 'pain_point', value: 'leadership pipeline', evidence: [evScore(c, 'organizational_capacity'), evInterp('staff_depth_score', `staff depth ${c.oc}`)] }] },
  { id: 'R17_pain_volunteer', when: (c) => c.oc < 50 && !c.hasSig('groups'),
    emit: (c) => [{ target: 'pain_point', value: 'volunteer systems', evidence: [evScore(c, 'organizational_capacity'), { id: 'groups_absent', kind: 'signal', detail: 'no groups signal' }] }] },
  { id: 'R18_pain_digital_infra', when: (c) => c.dm < 40,
    emit: (c) => [{ target: 'pain_point', value: 'digital infrastructure', evidence: [evScore(c, 'digital_maturity')] }] },
  { id: 'R19_pain_contact', when: (c) => c.ct < 40,
    emit: (c) => [{ target: 'pain_point', value: 'external contactability', evidence: [evScore(c, 'contactability')] }] },
  { id: 'R20_pain_stagnation', when: (c) => c.lifecycle === 'plateaued' || c.lifecycle === 'declining',
    emit: (c) => [{ target: 'pain_point', value: 'growth stagnation', evidence: [evInterp('lifecycle', `lifecycle ${c.lifecycle}`)] }] },

  // —— growth_constraints ——
  { id: 'R21_constraint_leaderdev', when: (c) => c.oc < 50,
    emit: (c) => [{ target: 'growth_constraint', value: 'leadership development', evidence: [evScore(c, 'organizational_capacity')] }] },
  { id: 'R22_constraint_volunteer', when: (c) => !c.hasSig('groups'),
    emit: (c) => [{ target: 'growth_constraint', value: 'volunteer / assimilation systems', evidence: [{ id: 'groups_absent', kind: 'signal', detail: 'no groups signal' }] }] },
  { id: 'R23_constraint_pipeline_gap', when: (c) => c.go > 65 && c.oc < 50,
    emit: (c) => [{ target: 'growth_constraint', value: 'leadership pipeline behind growth ambition', evidence: [evScore(c, 'growth_orientation'), evScore(c, 'organizational_capacity')] }] },
  { id: 'R24_constraint_data', when: (c) => !c.tech.has('ChMS'),
    emit: (c) => [{ target: 'growth_constraint', value: 'operational / data systems', evidence: [{ id: 'tech_ChMS_absent', kind: 'technology', detail: 'no ChMS platform' }] }] },

  // —— product_fit ——
  { id: 'R25_fit_digital', when: (c) => c.dm < 50,
    emit: (c) => [{ target: 'product_fit', value: 'Digital Systems Consulting', evidence: [evScore(c, 'digital_maturity')] }] },
  { id: 'R26_fit_leaderdev', when: (c) => c.hasSig('internship_residency') || c.oc < 50,
    emit: (c) => [{ target: 'product_fit', value: 'Leadership Development Program', evidence: c.hasSig('internship_residency') ? [evSignal(c, 'internship_residency')] : [evScore(c, 'organizational_capacity')] }] },
  { id: 'R27_fit_revitalization', when: (c) => c.lifecycle === 'plateaued' || c.lifecycle === 'declining',
    emit: (c) => [{ target: 'product_fit', value: 'Revitalization Cohort', evidence: [evInterp('lifecycle', `lifecycle ${c.lifecycle}`)] }] },
  { id: 'R28_fit_multiplication', when: (c) => c.go > 65 && /plant|growing|relaunch/.test(c.lifecycle),
    emit: (c) => [{ target: 'product_fit', value: 'Multiplication Lab', evidence: [evScore(c, 'growth_orientation'), evInterp('lifecycle', `lifecycle ${c.lifecycle}`)] }] },
  { id: 'R29_fit_nextgen', when: (c) => c.hasSig('school_academy'),
    emit: (c) => [{ target: 'product_fit', value: 'NextGen / Family Ministry Systems', evidence: [evSignal(c, 'school_academy')] }] },
  // —— size-relative: large church, thin digital capability ⇒ modernization at scale ——
  { id: 'R31_fit_modernization_at_scale', when: (c) => !!c.sizeRelative?.modernization_opportunity,
    emit: (c) => [{ target: 'product_fit', value: 'Digital Modernization (at scale)', evidence: [evSize(c), evScore(c, 'digital_maturity')] }] },

  // —— suppression: mature digital ⇒ do NOT pitch digital transformation ——
  { id: 'R30_digital_mature_suppression', when: (c) => c.tech.has('ChMS') && c.hasSig('forms_workflows') && c.hasSig('groups'),
    emit: (c) => [{ target: 'suppress_digital', value: 'digital systems likely mature', evidence: [evTech(c, 'ChMS'), evSignal(c, 'forms_workflows'), evSignal(c, 'groups')] }] },
];

// ── confidence (Deliverable 4): evidence-driven, NOT score value ──────────────
function recConfidence(c: Ctx, evidence: EvidenceRef[]): number {
  const base = 25 + Math.min(45, evidence.length * 12) + Math.min(20, c.breadth * 3) + accessBonus(c.accessLevel);
  return Math.min(c.cap, base);
}
function accessBonus(level: EvidenceAccessLevel): number {
  return level === 'live_official_site' || level === 'staff_profile' || level === 'user_provided_ground_truth' ? 10
    : level === 'third_party_directory' || level === 'job_posting' || level === 'social_profile' ? 5 : 0;
}
const dedupeEvidence = (refs: EvidenceRef[]): EvidenceRef[] => {
  const seen = new Set<string>(); const out: EvidenceRef[] = [];
  for (const r of refs) if (!seen.has(r.id)) { seen.add(r.id); out.push(r); }
  return out;
};

// ── Deliverable 2: dimension analyses ─────────────────────────────────────────
function levelFrom(score: number): OpportunityLevel { return score >= 70 ? 'high' : score >= 45 ? 'moderate' : 'low'; }

function digitalOpportunity(c: Ctx): DimensionAnalysis {
  const ev: EvidenceRef[] = [evScore(c, 'digital_maturity')];
  const findings: string[] = [];
  const mature = c.tech.has('ChMS') && c.hasSig('forms_workflows') && c.hasSig('groups');
  if (mature) { findings.push('digital systems mature — optimize, do not transform'); ev.push(evTech(c, 'ChMS'), evSignal(c, 'forms_workflows'), evSignal(c, 'groups')); }
  else if (c.dm < 50) { findings.push('modernization opportunity'); }
  // opportunity = inverse of maturity (low maturity ⇒ high opportunity), unless mature
  const level: OpportunityLevel = mature ? 'low' : levelFrom(100 - c.dm);
  return { level, findings, evidence_refs: dedupeEvidence(ev) };
}
function leadershipOpportunity(c: Ctx): DimensionAnalysis {
  const ev: EvidenceRef[] = [evScore(c, 'organizational_capacity'), evInterp('staff_depth_score', `staff depth ${c.oc}`)];
  const findings: string[] = [];
  if (c.oc < 50) findings.push('leadership development need');
  if (c.leaderCount <= 1) { findings.push('succession need'); ev.push(evInterp('lead_pastors', `${c.leadPastors.length} named leader(s)`)); }
  if (!c.hasSig('groups')) { findings.push('volunteer development need'); ev.push({ id: 'groups_absent', kind: 'signal', detail: 'no groups signal' }); }
  if (/plateaued|declining/.test(c.lifecycle)) { findings.push('renewal need'); ev.push(evInterp('lifecycle', `lifecycle ${c.lifecycle}`)); }
  return { level: levelFrom(100 - c.oc), findings, evidence_refs: dedupeEvidence(ev) };
}
function growthOpportunity(c: Ctx): DimensionAnalysis {
  const ev: EvidenceRef[] = [evScore(c, 'growth_orientation'), evInterp('lifecycle', `lifecycle ${c.lifecycle}`)];
  const findings: string[] = [];
  if (c.go >= 60 && /plant|growing|relaunch/.test(c.lifecycle)) findings.push('expansion potential');
  if (c.hasSig('internship_residency') || c.hasSig('jobs_hiring')) { findings.push('multiplication potential'); ev.push(c.hasSig('internship_residency') ? evSignal(c, 'internship_residency') : evSignal(c, 'jobs_hiring')); }
  return { level: levelFrom(c.go), findings, evidence_refs: dedupeEvidence(ev) };
}
function partnershipReadiness(c: Ctx): DimensionAnalysis {
  const ev: EvidenceRef[] = [evScore(c, 'contactability'), evScore(c, 'growth_orientation')];
  const findings: string[] = [];
  if (c.leadPastors.length || c.hasExec) { findings.push('decision-maker identified'); ev.push(c.hasExec ? evLead('executive_pastor', 'exec identified') : evLead('lead_pastors', 'lead pastor identified')); }
  if (c.knownVerified) { findings.push('official site verified'); ev.push(evInterp('known_church_verified', 'known church verified')); }
  const readinessScore = Math.round(0.55 * c.ct + 0.45 * c.go);
  return { level: levelFrom(readinessScore), findings, evidence_refs: dedupeEvidence(ev) };
}

// ── engine ────────────────────────────────────────────────────────────────────
export function runRecommendationEngine(input: RecommendationInput): RecommendationEngineResult {
  const c = buildCtx(input);

  // 1) fire deterministic rules
  const outputs: RuleOutput[] = [];
  for (const rule of RULES) if (rule.when(c)) outputs.push(...rule.emit(c));
  const byTarget = (t: RuleTarget) => outputs.filter((o) => o.target === t);
  const suppressDigital = byTarget('suppress_digital');
  const digitalMature = suppressDigital.length > 0;

  // 2) pick highest-priority single recommendations (stable on ties by rule order)
  const pickTop = (t: RuleTarget): RuleOutput | null => {
    const cands = byTarget(t).filter((o) => !(digitalMature && t === 'first_conversation' && o.value === 'Digital Systems'));
    if (!cands.length) return null;
    return cands.reduce((best, o) => ((o.priority ?? 0) > (best.priority ?? 0) ? o : best));
  };

  // 3) accumulate list recommendations (dedupe by value, union evidence)
  const accumulate = (t: RuleTarget, drop: (v: string) => boolean = () => false): { values: string[]; evidence: EvidenceRef[] } => {
    const map = new Map<string, EvidenceRef[]>();
    for (const o of byTarget(t)) {
      if (drop(o.value)) continue;
      map.set(o.value, dedupeEvidence([...(map.get(o.value) ?? []), ...o.evidence]));
    }
    return { values: [...map.keys()], evidence: dedupeEvidence([...map.values()].flat()) };
  };

  const firstConv = pickTop('first_conversation');
  const entry = pickTop('entry_point');
  const painPoints = accumulate('pain_point');
  const constraints = accumulate('growth_constraint');
  // suppression: drop digital-transformation product fits when digital is mature
  const productFit = accumulate('product_fit', (v) => digitalMature && v === 'Digital Systems Consulting');
  if (digitalMature) productFit.values.push('Optimize existing platform (not transformation)');

  // 4) dimensions
  const dimensions: RecommendationDimensions = {
    digital_opportunity: digitalOpportunity(c),
    leadership_opportunity: leadershipOpportunity(c),
    growth_opportunity: growthOpportunity(c),
    partnership_readiness: partnershipReadiness(c),
  };

  // 5) ENGAGEMENT FIT — growth-weighted composite. Growth is the master signal;
  // capacity is the lift-gate (can they carry the product?); contactability is the
  // execution gate (can we reach the right owner?). Mega is the best fit; giga gets
  // the most benefit but is a heavier lift.
  const leadershipCompleteness = (c.leadPastors.length ? 1 : 0) + (c.hasExec ? 1 : 0) + (c.hasDiscipleship ? 1 : 0) + (c.hasOps ? 1 : 0) + (c.hasMarketing ? 1 : 0) + (c.hasComms ? 1 : 0);
  const fitCore = 0.45 * c.go + 0.30 * c.oc + 0.25 * c.ct;
  const megaSweet = c.awa != null && c.awa >= 2000 && c.awa < 10000;
  const giga = c.awa != null && c.awa >= 10000;
  const fit = Math.max(0, Math.min(100, Math.round(fitCore + (megaSweet ? 8 : giga ? 4 : 0))));
  const fitEvidence = dedupeEvidence([evScore(c, 'growth_orientation'), evScore(c, 'organizational_capacity'), evScore(c, 'contactability'),
    ...(megaSweet || giga ? [evInterp('attendance_estimate', `AWA ~${c.awa} (${megaSweet ? 'mega sweet-spot' : 'giga — most benefit, heavier lift'})`)] : [])]);

  const partnershipProb = Math.max(0, Math.min(100, Math.round(0.4 * c.ct + 0.3 * c.go + 5 * leadershipCompleteness + (c.knownVerified ? 10 : 0))));
  const ppEvidence = dedupeEvidence([evScore(c, 'contactability'), evScore(c, 'growth_orientation'),
    ...(c.leadPastors.length ? [evLead('lead_pastors', `${c.leadPastors.length} lead(s)`)] : []),
    ...(c.knownVerified ? [evInterp('known_church_verified', 'verified')] : [])]);

  // priority = engagement fit gated by reachability of a senior owner.
  const reachable = c.ct >= 45 && leadershipCompleteness >= 1;
  let priority: EngagementPriority = (fit >= 62 && reachable && c.knownVerified) ? 'high'
    : (fit >= 45 && reachable) ? 'medium' : 'low';
  // Capability-vs-size: a large church under-developed for its size (thin digital
  // capability at scale) is a high-value modernization target — bump one notch.
  const modernization = !!c.sizeRelative?.modernization_opportunity && leadershipCompleteness >= 1;
  if (modernization) priority = priority === 'low' ? 'medium' : 'high';
  const fitRef: EvidenceRef = { id: 'engagement_fit', kind: 'score', detail: `fit ${fit}` };
  const priorityEvidence = dedupeEvidence([fitRef, evScore(c, 'contactability'),
    ...(leadershipCompleteness ? [evLead('lead_pastors', 'leadership identified')] : []),
    ...(modernization ? [evSize(c)] : []),
    ...(c.knownVerified ? [evInterp('known_church_verified', 'verified')] : [])]);

  // 6) fallback evidence so NO recommendation is ever evidence-less (Rule 2)
  const dominantDim = DIMENSIONS.reduce((a, b) => (c.scores[b].score > c.scores[a].score ? b : a));
  const fc = firstConv ?? { value: `Strengthen ${dominantDim.replace(/_/g, ' ')}`, evidence: [evScore(c, dominantDim)] };
  const ep = entry ?? { value: 'No contact pathway identified', evidence: [evInterp('contactability_score', `contactability ${c.ct}`)] };
  const ensure = (refs: EvidenceRef[], fallback: EvidenceRef): EvidenceRef[] => (refs.length ? refs : [fallback]);

  const rec = <T,>(value: T, evidence: EvidenceRef[], reason: string): Recommendation<T> =>
    ({ value, evidence_refs: dedupeEvidence(evidence), reason, confidence: recConfidence(c, evidence) });

  const result: RecommendationEngineResult = {
    engagement_fit: rec(fit, fitEvidence, `0.45·growth(${c.go}) + 0.30·capacity(${c.oc}) + 0.25·contactability(${c.ct})${megaSweet ? ' + mega sweet-spot' : giga ? ' + giga' : ''}`),
    engagement_priority: rec(priority, priorityEvidence, `fit ${fit}, reachable=${reachable}, verified=${c.knownVerified}${modernization ? ', +modernization-at-scale' : ''}`),
    recommended_first_conversation: rec(fc.value, ensure(fc.evidence, evScore(c, dominantDim)), firstConv ? `top-priority rule among ${byTarget('first_conversation').length} candidates` : 'no rule fired — dominant dimension fallback'),
    recommended_entry_point: rec(ep.value, ensure(ep.evidence, evInterp('contactability_score', `contactability ${c.ct}`)), entry ? 'highest-ranked identified role' : 'no leadership role identified'),
    likely_pain_points: rec(painPoints.values, ensure(painPoints.evidence, evScore(c, 'organizational_capacity')), `${painPoints.values.length} pain point rule(s) fired`),
    likely_growth_constraints: rec(constraints.values, ensure(constraints.evidence, evScore(c, 'growth_orientation')), `${constraints.values.length} constraint rule(s) fired`),
    recommended_product_fit: rec(productFit.values, ensure(productFit.evidence, evScore(c, dominantDim)), digitalMature ? 'digital mature → optimization, not transformation' : `${productFit.values.length} product-fit rule(s) fired`),
    partnership_probability: rec(partnershipProb, ppEvidence, `0.4·contactability + 0.3·growth + leadership + verified`),
    confidence: 0,
    evidence_refs: [],
    dimensions,
  };

  // overall evidence union + overall confidence (evidence/breadth/access — NOT score value)
  const allEvidence = dedupeEvidence([
    ...result.engagement_fit.evidence_refs, ...result.engagement_priority.evidence_refs, ...result.recommended_first_conversation.evidence_refs,
    ...result.recommended_entry_point.evidence_refs, ...result.likely_pain_points.evidence_refs,
    ...result.likely_growth_constraints.evidence_refs, ...result.recommended_product_fit.evidence_refs,
    ...result.partnership_probability.evidence_refs,
    ...dimensions.digital_opportunity.evidence_refs, ...dimensions.leadership_opportunity.evidence_refs,
    ...dimensions.growth_opportunity.evidence_refs, ...dimensions.partnership_readiness.evidence_refs,
  ]);
  result.evidence_refs = allEvidence;
  result.confidence = Math.min(c.cap, 20 + Math.min(45, allEvidence.length * 4) + Math.min(20, c.breadth * 3) + accessBonus(c.accessLevel));
  return result;
}

/** Compact one-line summary for the dossier markdown. */
export function recommendationSummary(r: RecommendationEngineResult): string {
  return `fit ${r.engagement_fit.value}/100 · priority ${r.engagement_priority.value} · first conversation: ${r.recommended_first_conversation.value} · entry: ${r.recommended_entry_point.value} · partnership ${r.partnership_probability.value}% (conf ${Math.round(r.confidence)})`;
}
