import { capForAccess } from './dossier.js';
import { DIMENSIONS, type Dimension } from './strategicSignals.js';
import type { Interpretation, NormalizedEvidence, NormalizedRow } from './evidenceModel.js';
import type { CoverageRow } from './coverage.js';
import type { EvidenceAccessLevel } from '../types.js';

/**
 * Strategic Scoring v1 — REPORT-ONLY, deterministic, rubric-based.
 *
 * Produces a 0–100 score for each of the five strategic dimensions from ONLY:
 *   - interpretation conclusions
 *   - normalized evidence (leaders, contacts, technology_stack, external_signals…)
 *   - strategic signals (the external_signals table)
 *   - technology stack
 *   - coverage data
 *
 * It does NOT touch discovery, crawling, identity, normalization, or interpretation,
 * and it is NOT written to Supabase. Every score traces back to the evidence rows
 * it consumed; whenever strategic signals exist for a dimension, that dimension
 * can never report zero evidence.
 *
 * Bands: 0–25 weak · 26–50 emerging · 51–75 capable · 76–100 strong.
 */

export type Band = 'weak' | 'emerging' | 'capable' | 'strong';

/**
 * A single explainable factor. `points` is signed: positive factors are APPLIED
 * to the score; negative factors are evidence-backed GAP candidates with a
 * recommended deduction (points < 0) that is NOT applied to the current score
 * (calibration baseline stays stable until the negative weights are confirmed).
 */
export interface ScoreFactor {
  id: string;
  label: string;
  points: number;            // + applied / − recommended-but-not-applied
  applied: boolean;
  evidence_refs: string[];   // normalized row ids (positives) / inspected source (negatives)
  detail: string;
  /** Coverage gate: was the category this factor depends on actually investigated?
   *  A negative factor for an UN-investigated category is "not investigated", not a
   *  verified absence — it informs confidence, never a score deduction. */
  investigated: boolean;
}

export interface ScoredDimension {
  dimension: Dimension;
  score: number;            // 0–100 (sum of APPLIED positive factors, clamped)
  band: Band;
  confidence: number;       // capped by best evidence access level
  rawConfidence: number;    // uncapped (evidence-volume driven)
  capped: boolean;
  capReason?: string;
  positive_factors: ScoreFactor[];
  negative_factors: ScoreFactor[];        // VERIFIED-absent gaps (category investigated) — score-eligible candidates
  not_investigated: ScoreFactor[];        // category never crawled — confidence-only, NOT a score gap
  top_factors: ScoreFactor[];             // applied factors sorted by contribution (which drove the score)
  evidenceConsumed: string[]; // back-compat (derived from positive_factors)
  evidenceMissing: string[];  // back-compat (derived from negative_factors)
  reason: string;
}

export type StrategicScores = Record<Dimension, ScoredDimension>;

export interface ScoringInput {
  interpretation: Interpretation;
  normalized: NormalizedEvidence;
  coverage: CoverageRow[];
  accessLevel: EvidenceAccessLevel;
  /** Confirmed structural scale — fed as evidence so capability is not understated
   *  for large churches we under-crawl. attendance comes from interpretation. */
  scale?: { campusCount?: number | null; multisite?: boolean };
  /** Coverage gate (Stage 3): which categories were actually investigated. A "miss"
   *  for an un-investigated category is reclassified as not-investigated, never a
   *  verified-absent score gap. Optional → when absent, all misses are treated as
   *  investigated (legacy behavior). NO score/confidence FORMULA changes. */
  investigatedSet?: Set<string>;
}

export function bandOf(score: number): Band {
  if (score <= 25) return 'weak';
  if (score <= 50) return 'emerging';
  if (score <= 75) return 'capable';
  return 'strong';
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

// ── internal rubric builder: accumulates evidence-traceable contributions ─────
class Rubric {
  readonly positives: { points: number; label: string; ids: string[] }[] = [];
  readonly negatives: { deduction: number; label: string; cov?: string }[] = [];
  add(points: number, label: string, ids: string[] = []): void {
    if (points > 0) this.positives.push({ points, label, ids });
  }
  /** Record an evidence-backed gap. `cov` names the coverage category this gap
   *  depends on, so the scorer can tell verified-absent from not-investigated. */
  miss(label: string, deduction = 5, cov?: string): void { this.negatives.push({ deduction, label, cov }); }
  /** Add a contribution if rows exist, else record the gap (with a recommended deduction). */
  want(rows: NormalizedRow[], points: number, label: string, missingLabel: string, cov?: string): void {
    if (rows.length) this.add(points, `${label}: ${rows.map((r) => r.value).join(', ')}`, rows.map((r) => r.id));
    else this.miss(missingLabel, Math.max(3, Math.round(points * 0.4)), cov);
  }
  get score(): number { return clamp(this.positives.reduce((s, p) => s + p.points, 0)); }
  get count(): number { return this.positives.length; }
  get consumed(): string[] { return this.positives.map((p) => `${p.label} [${p.ids.join(',') || '—'}] (+${p.points})`); }
  get labels(): string[] { return this.positives.map((p) => p.label); }
  get missing(): string[] { return this.negatives.map((n) => n.label); }
}

function slug(s: string): string { return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''); }

export function scoreStrategic(input: ScoringInput): StrategicScores {
  const { interpretation: I, normalized: N, coverage, accessLevel, scale } = input;
  const investigated = (cov?: string) => !cov || !input.investigatedSet || input.investigatedSet.has(cov);

  const tech = (cat: string) => N.technology_stack.filter((r) => r.category === cat);
  const sig = (cat: string) => N.external_signals.filter((r) => r.category === cat);
  const sigForDim = (dim: Dimension) => N.external_signals.filter((r) => (r.detail ?? '').includes(dim));
  const either = (...groups: NormalizedRow[][]) => {
    const seen = new Set<string>(); const out: NormalizedRow[] = [];
    for (const g of groups) for (const r of g) if (!seen.has(r.id)) { seen.add(r.id); out.push(r); }
    return out;
  };
  const officialUseful = !!coverage.find((c) => c.category === 'homepage')?.useful;
  const cap = capForAccess(accessLevel);

  // ── confirmed structural scale (used as capability evidence, not crawled platforms) ──
  const awa = I.attendance_estimate.value;
  const campuses = scale?.campusCount ?? null;
  const multisite = (scale?.multisite ?? false) || (campuses != null && campuses >= 2);
  const attnEv = I.attendance_estimate.evidence_ids?.length ? I.attendance_estimate.evidence_ids : ['interpretation'];
  // How thoroughly did we actually look? (fraction of REQUIRED coverage that was useful)
  const reqCov = coverage.filter((c) => c.required);
  const crawlBreadth = reqCov.length ? reqCov.filter((c) => c.useful).length / reqCov.length : (officialUseful ? 1 : 0.4);

  const finalize = (dim: Dimension, r: Rubric): ScoredDimension => {
    const score = r.score;
    // Confidence = COMPLETENESS, not volume. A score driven by ABSENCE of evidence
    // (many gaps, thin crawl) must report LOW confidence — not high confidence in a
    // low score. completeness = found / (found + missed); crawlBreadth = how
    // thoroughly we looked. This makes "low score + high confidence" impossible
    // unless we genuinely looked hard and found genuine weakness.
    const foundWeight = r.positives.reduce((s, p) => s + p.points, 0);
    const missedWeight = r.negatives.reduce((s, n) => s + n.deduction, 0);
    const completeness = foundWeight + missedWeight > 0 ? foundWeight / (foundWeight + missedWeight) : 0;
    let rawConfidence = Math.round(20 + 45 * completeness + 20 * crawlBreadth);
    if (r.count === 0) rawConfidence = 18;
    rawConfidence = Math.max(10, Math.min(92, rawConfidence));
    const confidence = Math.min(rawConfidence, cap);
    const capped = rawConfidence > cap;
    const band = bandOf(score);
    const reason = `${band} (${score}): ${r.labels.join('; ') || 'no qualifying evidence'}${r.missing.length ? ` · gaps: ${r.missing.join(', ')}` : ''}`;
    const positive_factors: ScoreFactor[] = r.positives.map((p) => ({
      id: `pos_${slug(p.label).slice(0, 40)}`, label: p.label, points: p.points, applied: true,
      evidence_refs: p.ids.length ? p.ids : ['interpretation'], detail: `+${p.points}`, investigated: true,
    }));
    // Coverage gate: a gap is only a VERIFIED absence if its category was investigated.
    const allNegatives: ScoreFactor[] = r.negatives.map((n) => {
      const inv = investigated(n.cov);
      return {
        id: `neg_${slug(n.label).slice(0, 40)}`, label: n.label, points: -n.deduction, applied: false,
        evidence_refs: [inv ? 'inspected:normalized_evidence' : `not_investigated:${n.cov}`],
        detail: inv ? `−${n.deduction} (candidate, not applied)` : `not investigated (${n.cov}) — confidence only`,
        investigated: inv,
      };
    });
    const negative_factors = allNegatives.filter((f) => f.investigated);
    const not_investigated = allNegatives.filter((f) => !f.investigated);
    const top_factors = [...positive_factors].sort((a, b) => b.points - a.points).slice(0, 5);
    return {
      dimension: dim, score, band, confidence, rawConfidence, capped,
      capReason: capped ? `raw ${rawConfidence} capped to ${cap} by best evidence access level (${accessLevel})` : undefined,
      positive_factors, negative_factors, not_investigated, top_factors,
      evidenceConsumed: r.consumed, evidenceMissing: r.missing, reason,
    };
  };

  // Baseline that GUARANTEES a dimension with strategic signals can never report
  // zero evidence (and stays fully traceable to the signal rows).
  const baseline = (r: Rubric, dim: Dimension) => {
    const s = sigForDim(dim);
    if (s.length) r.add(Math.min(15, s.length * 4), `${s.length} strategic signal(s) mapped to ${dim}`, s.map((x) => x.id));
  };

  // ── digital_maturity ──────────────────────────────────────────────────────
  const digital = () => {
    const r = new Rubric();
    baseline(r, 'digital_maturity');
    r.want(tech('ChMS'), 18, 'ChMS platform', 'no ChMS platform', 'technology');
    r.want(either(tech('Giving'), sig('giving')), 14, 'online giving', 'no giving platform', 'giving');
    r.want(either(tech('App'), sig('app_mobile')), 12, 'mobile app', 'no mobile app', 'app/mobile');
    r.want(either(tech('Streaming'), sig('livestream_video')), 12, 'livestream/video', 'no livestream/sermon video', 'sermons/media');
    r.want(sig('podcast'), 6, 'podcast', 'no podcast', 'sermons/media');
    r.want(either(tech('Email'), sig('newsletter_email')), 6, 'email/newsletter', 'no email platform', 'technology');
    r.want(sig('forms_workflows'), 8, 'digital forms/workflows', 'no online forms', 'technology');
    r.want(either(sig('groups'), sig('events_calendar')), 8, 'groups/calendar modules', 'no groups/calendar modules', 'groups');
    // SCALE: you cannot run multi-site worship without a streaming + comms backbone,
    // and large congregations invariably run digital systems — credit the inferred
    // infrastructure even when the specific platforms weren't crawled.
    const onlineWorship = either(sig('livestream_video'), tech('Streaming')).length > 0;
    if (campuses != null && campuses >= 4) r.add(20, `multi-site digital backbone (${campuses} campuses require streaming + comms systems)`, ['interpretation']);
    else if (multisite && onlineWorship) r.add(14, 'multi-site + online worship implies a digital backbone', ['interpretation']);
    else if (multisite) r.add(8, 'multi-site operation implies shared digital systems', ['interpretation']);
    if (awa != null && awa >= 2000) r.add(8, `large congregation (AWA ~${awa}) — digital systems near-certain`, attnEv);
    return finalize('digital_maturity', r);
  };

  // ── growth_orientation (the master fit signal — absorbs change readiness) ────
  // Drive to multiply AND openness to change are the same axis; hesitation/plateau
  // is its low end. This is the strongest predictor of "will they engage".
  const growth = () => {
    const r = new Rubric();
    baseline(r, 'growth_orientation');
    const stage = I.lifecycle_stage.value;
    const lifePts = /relaunch|revitaliz|plant/.test(stage) ? 28 : stage === 'growing' ? 22 : stage === 'established' ? 8 : 0;
    if (lifePts > 0) r.add(lifePts, `lifecycle momentum: ${stage}`, I.lifecycle_stage.evidence_ids);
    else r.miss(`growth hesitation (lifecycle ${stage || 'unknown'})`, 12);
    r.want(sig('jobs_hiring'), 18, 'hiring/job postings', 'no hiring signal', 'jobs/careers');
    r.want(sig('internship_residency'), 18, 'internship/residency', 'no residency/internship');
    r.want(sig('school_academy'), 10, 'school/academy', 'no school/academy', 'ministries');
    r.want(sig('network_affiliation'), 8, 'network/movement affiliation', 'no network affiliation');
    r.want(either(sig('livestream_video'), sig('podcast')), 6, 'media reach', 'no media-reach signal', 'sermons/media');
    r.want(either(tech('ChMS'), tech('App')), 6, 'modern platform adoption (openness to change)', 'no modern platform adoption', 'technology');
    if (I.staff_count.value != null && I.staff_count.value >= 8) r.add(6, `staffed for growth (staff ${I.staff_count.value})`, I.staff_count.evidence_ids);
    else r.miss('staff capacity (<8 or unknown)');
    // SCALE: actively multiplying campuses is the strongest growth + change signal.
    if (campuses != null && campuses >= 4) r.add(16, `active multiplication (${campuses} campuses)`, ['interpretation']);
    else if (multisite) r.add(8, 'multi-site expansion', ['interpretation']);
    return finalize('growth_orientation', r);
  };

  // ── organizational_capacity — "can they carry the lift of this product?" ─────
  // A lift-curve, not "bigger = better": size anchors capacity (more manpower +
  // systems), but under ~500 the lift is heavy — only a growth mindset AND real
  // manpower make it viable. Takes the growth score so the small-church gate works.
  const orgcap = (growthScore: number) => {
    const r = new Rubric();
    baseline(r, 'organizational_capacity');
    const sc = I.staff_count.value;
    let sizeBase = 18, sizeLabel = 'limited scale (AWA <500 or unknown)';
    if (awa != null && awa >= 10000) { sizeBase = 64; sizeLabel = `giga scale (AWA ~${awa})`; }
    else if (awa != null && awa >= 5000) { sizeBase = 58; sizeLabel = `large-mega scale (AWA ~${awa})`; }
    else if (awa != null && awa >= 2000) { sizeBase = 50; sizeLabel = `mega scale (AWA ~${awa})`; }
    else if (awa != null && awa >= 1000) { sizeBase = 38; sizeLabel = `sizable (AWA ~${awa})`; }
    else if (awa != null && awa >= 500) { sizeBase = 28; sizeLabel = `established size (AWA ~${awa})`; }
    r.add(sizeBase, `lift capacity — ${sizeLabel}`, awa != null ? attnEv : ['interpretation']);
    // SMALL-CHURCH GATE: under 500, capacity hinges on growth mindset + manpower.
    if (awa == null || awa < 500) {
      const manpower = sc != null && sc >= 8;
      if (growthScore >= 60 && manpower) r.add(20, 'growth mindset + manpower offset small size for the lift', I.staff_count.evidence_ids);
      else if (growthScore >= 60 || manpower) r.add(8, growthScore >= 60 ? 'growth mindset partly offsets small size' : 'some manpower for the lift', I.staff_count.evidence_ids);
      else r.miss('small + low growth + thin staff — lift likely too heavy', 18);
    }
    if (sc != null && sc >= 20) r.add(10, `deep staff (${sc})`, I.staff_count.evidence_ids);
    else if (sc != null && sc >= 10) r.add(6, `staff (${sc})`, I.staff_count.evidence_ids);
    else if (sc != null && sc >= 5) r.add(3, `small staff (${sc})`, I.staff_count.evidence_ids);
    const roles = (['executive_pastor', 'discipleship_pastor', 'operations_leader', 'marketing_director', 'communications_leader'] as const)
      .filter((k) => I[k].value).map((k) => ({ k, c: I[k] }));
    if (roles.length) r.add(Math.min(14, roles.length * 5), `staff infrastructure: ${roles.map((x) => x.k).join(', ')}`, roles.flatMap((x) => x.c.evidence_ids));
    if (campuses != null && campuses >= 4) r.add(12, `multi-campus operation (${campuses} campuses)`, ['interpretation']);
    else if (multisite) r.add(6, 'multi-site operation', ['interpretation']);
    r.want(tech('ChMS'), 6, 'operational ChMS backbone', 'no ChMS backbone', 'technology');
    if (N.staff_roster.length > 3) r.add(4, `staff roster depth (${N.staff_roster.length})`, N.staff_roster.slice(0, 5).map((x) => x.id));
    return finalize('organizational_capacity', r);
  };

  // ── contactability — can we reach the RIGHT senior owner, in priority order? ──
  // Lead Pastor > Exec Pastor > Operations > Comms. Comms is intentionally the
  // WEAKEST entry: this is a comms-heavy lift, but it must be owned by senior
  // leadership — a church reachable only through comms scores LOWER here.
  const contact = () => {
    const r = new Rubric();
    baseline(r, 'contactability');
    // Senior-owner ladder: Lead > Exec > Discipleship > Operations > Marketing > Comms.
    if (I.lead_pastors.value.length) r.add(35, `lead pastor reachable: ${I.lead_pastors.value.join('; ')}`, I.lead_pastors.evidence_ids); else r.miss('no named lead pastor', 18);
    if (I.executive_pastor.value) r.add(22, `executive pastor: ${I.executive_pastor.value}`, I.executive_pastor.evidence_ids); else r.miss('no executive pastor');
    if (I.discipleship_pastor.value) r.add(16, `discipleship/next-steps owner: ${I.discipleship_pastor.value}`, I.discipleship_pastor.evidence_ids);
    if (I.operations_leader.value) r.add(12, `operations leader: ${I.operations_leader.value}`, I.operations_leader.evidence_ids);
    if (I.marketing_director.value) r.add(8, `marketing/digital director: ${I.marketing_director.value}`, I.marketing_director.evidence_ids);
    if (I.communications_leader.value) r.add(5, `communications lead (weakest entry — should not drive): ${I.communications_leader.value}`, I.communications_leader.evidence_ids);
    if (I.office_email.value) r.add(14, 'office email channel', I.office_email.evidence_ids); else r.miss('no office email');
    if (I.office_phone.value) r.add(10, 'office phone channel', I.office_phone.evidence_ids); else r.miss('no office phone');
    r.want(sig('social_media'), 6, 'social channels', 'no social channels');
    return finalize('contactability', r);
  };

  const out = {} as StrategicScores;
  out.digital_maturity = digital();
  const g = growth();
  out.growth_orientation = g;
  out.organizational_capacity = orgcap(g.score);
  out.contactability = contact();
  return out;
}

/** Compact one-line summary for the report header. */
export function strategicScoreSummary(scores: StrategicScores): string {
  return DIMENSIONS.map((d) => `${d} ${scores[d].score} (${scores[d].band})`).join(' · ');
}
