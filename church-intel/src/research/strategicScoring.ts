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
  negative_factors: ScoreFactor[];   // gap candidates (recommended deductions, not yet applied)
  top_factors: ScoreFactor[];        // applied factors sorted by contribution (which drove the score)
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
  readonly negatives: { deduction: number; label: string }[] = [];
  add(points: number, label: string, ids: string[] = []): void {
    if (points > 0) this.positives.push({ points, label, ids });
  }
  /** Record an evidence-backed gap. Recommended deduction defaults to ~40% of the
   *  capability's positive weight (a principled default, NOT applied to the score). */
  miss(label: string, deduction = 5): void { this.negatives.push({ deduction, label }); }
  /** Add a contribution if rows exist, else record the gap (with a recommended deduction). */
  want(rows: NormalizedRow[], points: number, label: string, missingLabel: string): void {
    if (rows.length) this.add(points, `${label}: ${rows.map((r) => r.value).join(', ')}`, rows.map((r) => r.id));
    else this.miss(missingLabel, Math.max(3, Math.round(points * 0.4)));
  }
  get score(): number { return clamp(this.positives.reduce((s, p) => s + p.points, 0)); }
  get count(): number { return this.positives.length; }
  get consumed(): string[] { return this.positives.map((p) => `${p.label} [${p.ids.join(',') || '—'}] (+${p.points})`); }
  get labels(): string[] { return this.positives.map((p) => p.label); }
  get missing(): string[] { return this.negatives.map((n) => n.label); }
}

function slug(s: string): string { return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''); }

export function scoreStrategic(input: ScoringInput): StrategicScores {
  const { interpretation: I, normalized: N, coverage, accessLevel } = input;

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

  const finalize = (dim: Dimension, r: Rubric): ScoredDimension => {
    const score = r.score;
    // Confidence is evidence-volume driven, then capped by access level.
    let rawConfidence = Math.min(90, 30 + r.count * 10 + (officialUseful ? 10 : 0));
    if (r.count === 0) rawConfidence = 20;
    const confidence = Math.min(rawConfidence, cap);
    const capped = rawConfidence > cap;
    const band = bandOf(score);
    const reason = `${band} (${score}): ${r.labels.join('; ') || 'no qualifying evidence'}${r.missing.length ? ` · gaps: ${r.missing.join(', ')}` : ''}`;
    const positive_factors: ScoreFactor[] = r.positives.map((p) => ({
      id: `pos_${slug(p.label).slice(0, 40)}`, label: p.label, points: p.points, applied: true,
      evidence_refs: p.ids.length ? p.ids : ['interpretation'], detail: `+${p.points}`,
    }));
    const negative_factors: ScoreFactor[] = r.negatives.map((n) => ({
      id: `neg_${slug(n.label).slice(0, 40)}`, label: n.label, points: -n.deduction, applied: false,
      evidence_refs: ['inspected:normalized_evidence'], detail: `−${n.deduction} (candidate, not applied)`,
    }));
    const top_factors = [...positive_factors].sort((a, b) => b.points - a.points).slice(0, 5);
    return {
      dimension: dim, score, band, confidence, rawConfidence, capped,
      capReason: capped ? `raw ${rawConfidence} capped to ${cap} by best evidence access level (${accessLevel})` : undefined,
      positive_factors, negative_factors, top_factors,
      evidenceConsumed: r.consumed, evidenceMissing: r.missing, reason,
    };
  };

  // Baseline that GUARANTEES a dimension with strategic signals can never report
  // zero evidence (and stays fully traceable to the signal rows).
  const baseline = (r: Rubric, dim: Dimension) => {
    const s = sigForDim(dim);
    if (s.length) r.add(Math.min(20, s.length * 5), `${s.length} strategic signal(s) mapped to ${dim}`, s.map((x) => x.id));
  };

  // ── digital_maturity ──────────────────────────────────────────────────────
  const digital = () => {
    const r = new Rubric();
    baseline(r, 'digital_maturity');
    r.want(tech('ChMS'), 30, 'ChMS platform', 'no ChMS platform');
    r.want(either(tech('Giving'), sig('giving')), 20, 'online giving', 'no giving platform');
    r.want(either(tech('App'), sig('app_mobile')), 15, 'mobile app', 'no mobile app');
    r.want(either(tech('Streaming'), sig('livestream_video')), 15, 'livestream/video', 'no livestream/sermon video');
    r.want(sig('podcast'), 10, 'podcast', 'no podcast');
    r.want(either(tech('Email'), sig('newsletter_email')), 10, 'email/newsletter', 'no email platform');
    r.want(sig('forms_workflows'), 10, 'digital forms/workflows', 'no online forms');
    r.want(either(sig('groups'), sig('events_calendar')), 10, 'groups/calendar modules', 'no groups/calendar modules');
    return finalize('digital_maturity', r);
  };

  // ── growth_orientation ────────────────────────────────────────────────────
  const growth = () => {
    const r = new Rubric();
    baseline(r, 'growth_orientation');
    r.want(sig('jobs_hiring'), 30, 'hiring/job postings', 'no hiring signal');
    r.want(sig('internship_residency'), 30, 'internship/residency', 'no residency/internship');
    r.want(sig('school_academy'), 15, 'school/academy', 'no school/academy');
    r.want(sig('network_affiliation'), 10, 'network affiliation', 'no network affiliation');
    r.want(either(sig('livestream_video'), sig('podcast')), 10, 'media reach', 'no media-reach signal');
    if (I.staff_count.value != null && I.staff_count.value >= 8) r.add(10, `staffed for growth (staff_count ${I.staff_count.value})`, I.staff_count.evidence_ids);
    else r.miss('staff capacity (<8 or unknown)');
    return finalize('growth_orientation', r);
  };

  // ── change_readiness ──────────────────────────────────────────────────────
  const change = () => {
    const r = new Rubric();
    baseline(r, 'change_readiness');
    const stage = I.lifecycle_stage.value;
    const lifePts = /relaunch|revitaliz|plant/.test(stage) ? 35 : stage === 'growing' ? 25 : stage === 'established' ? 10 : stage === 'plateaued' ? 5 : 0;
    if (lifePts > 0) r.add(lifePts, `lifecycle: ${stage}`, I.lifecycle_stage.evidence_ids);
    else r.miss(`lifecycle not change-oriented (${stage || 'unknown'})`);
    r.want(sig('network_affiliation'), 20, 'network affiliation', 'no network affiliation');
    r.want(either(sig('jobs_hiring'), sig('internship_residency')), 15, 'investing in new roles', 'no hiring/residency investment');
    r.want(either(tech('ChMS'), tech('App')), 15, 'recent platform adoption', 'no modern platform adoption');
    r.want(sig('forms_workflows'), 10, 'digital workflow adoption', 'no digital workflows');
    return finalize('change_readiness', r);
  };

  // ── organizational_capacity ───────────────────────────────────────────────
  const orgcap = () => {
    const r = new Rubric();
    baseline(r, 'organizational_capacity');
    const sc = I.staff_count.value;
    if (sc != null && sc >= 10) r.add(30, `large staff (${sc})`, I.staff_count.evidence_ids);
    else if (sc != null && sc >= 5) r.add(20, `mid staff (${sc})`, I.staff_count.evidence_ids);
    else if (sc != null && sc >= 1) r.add(10, `small staff (${sc})`, I.staff_count.evidence_ids);
    else r.miss('staff count unknown');
    const roles = (['executive_pastor', 'operations_leader', 'communications_leader'] as const)
      .filter((k) => I[k].value).map((k) => ({ k, c: I[k] }));
    if (roles.length) r.add(Math.min(30, roles.length * 10), `leadership roles filled: ${roles.map((x) => x.k).join(', ')}`, roles.flatMap((x) => x.c.evidence_ids));
    else r.miss('no exec/ops/comms roles identified');
    r.want(tech('ChMS'), 15, 'operational ChMS backbone', 'no ChMS backbone');
    r.want(sig('school_academy'), 10, 'school/academy operation', 'no school/academy');
    r.want(either(sig('groups'), sig('forms_workflows')), 10, 'operational systems (groups/forms)', 'no operational systems');
    if (N.staff_roster.length > 3) r.add(5, `staff roster depth (${N.staff_roster.length})`, N.staff_roster.slice(0, 5).map((x) => x.id));
    return finalize('organizational_capacity', r);
  };

  // ── contactability ────────────────────────────────────────────────────────
  const contact = () => {
    const r = new Rubric();
    baseline(r, 'contactability');
    if (I.office_email.value) r.add(30, `office email`, I.office_email.evidence_ids); else r.miss('no office email');
    if (I.office_phone.value) r.add(25, `office phone`, I.office_phone.evidence_ids); else r.miss('no office phone');
    if (I.lead_pastors.value.length) r.add(20, `lead pastor(s): ${I.lead_pastors.value.join('; ')}`, I.lead_pastors.evidence_ids); else r.miss('no named lead pastor');
    const secondary = (['executive_pastor', 'operations_leader', 'communications_leader'] as const).filter((k) => I[k].value);
    if (secondary.length) r.add(10, `secondary contacts: ${secondary.join(', ')}`, secondary.flatMap((k) => I[k].evidence_ids)); else r.miss('no secondary contacts');
    r.want(sig('social_media'), 10, 'social channels', 'no social channels');
    r.want(either(tech('ChMS'), sig('forms_workflows')), 5, 'digital contact pathway', 'no digital contact pathway');
    return finalize('contactability', r);
  };

  const builders: Record<Dimension, () => ScoredDimension> = {
    digital_maturity: digital, growth_orientation: growth, change_readiness: change,
    organizational_capacity: orgcap, contactability: contact,
  };
  const out = {} as StrategicScores;
  for (const d of DIMENSIONS) out[d] = builders[d]();
  return out;
}

/** Compact one-line summary for the report header. */
export function strategicScoreSummary(scores: StrategicScores): string {
  return DIMENSIONS.map((d) => `${d} ${scores[d].score} (${scores[d].band})`).join(' · ');
}
