/**
 * Opportunity scoring.
 *
 * The score is intentionally conservative and explainable — it rewards
 * opportunities that are cheap to start, realistic, fast to a first dollar, and
 * honest, and it HARD-CAPS anything whose EV confidence is low (we refuse to
 * over-promise, mirroring church-intel's "prefer Unknown over false precision").
 */
import type { Cents, Opportunity } from './types.js';

export interface ScoreInputs {
  /** Capital the agent actually has available, in cents. */
  availableCents: Cents;
}

/**
 * Returns a 0-100 score. Components:
 *  - Affordability (25): startup cost vs. available capital.
 *  - Return ratio   (30): expected 30d revenue vs. startup cost (capped).
 *  - Speed          (20): hours to first dollar (less is better).
 *  - Confidence     (25): the EV confidence, directly.
 * The whole score is then scaled by a confidence factor so low-confidence
 * opportunities can never rank highly no matter how rosy their numbers.
 */
export function scoreOpportunity(o: Opportunity, inputs: ScoreInputs): number {
  const affordable = o.startupCostCents <= inputs.availableCents;
  const affordability = affordable
    ? 25 * (1 - o.startupCostCents / Math.max(1, inputs.availableCents))
    : 0; // can't afford it at all -> no affordability credit

  const ratio = o.startupCostCents > 0
    ? o.expectedRevenue30dCents / o.startupCostCents
    : o.expectedRevenue30dCents > 0
      ? 6 // zero-cost with real revenue is excellent, but capped
      : 0;
  const returnScore = 30 * Math.min(1, ratio / 6); // ratio of 6x maxes this out

  const speedScore = 20 * Math.min(1, 20 / Math.max(1, o.hoursToFirstDollar)); // 20h -> ~max

  const confidenceScore = 25 * (clamp(o.evConfidence) / 100);

  const raw = affordability + returnScore + speedScore + confidenceScore;

  // Confidence factor: an opportunity we're only 50% sure of can score at most 50%.
  const confidenceFactor = clamp(o.evConfidence) / 100;
  const scaled = raw * confidenceFactor;

  // Unaffordable opportunities are hard-floored so they sort to the bottom.
  return Math.round((affordable ? scaled : Math.min(scaled, 10)) * 100) / 100;
}

export function rankOpportunities(opps: Opportunity[], inputs: ScoreInputs): Opportunity[] {
  return opps
    .map((o) => ({ ...o, score: scoreOpportunity(o, inputs) }))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}

function clamp(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}
