import { config } from '../config.js';
import type { ConfidenceTier } from '../types.js';

/**
 * Confidence bands (descriptive — for evidence quality):
 *   90-100 : direct evidence from official site or official report
 *   75-89  : strong evidence from multiple sources
 *   60-74  : plausible but incomplete
 *   40-59  : weak or indirect
 *   <40    : do not auto-update; route to review/evidence only
 */
export function confidenceBand(score: number): string {
  if (score >= 90) return 'direct-official';
  if (score >= 75) return 'strong-multi-source';
  if (score >= 60) return 'plausible-incomplete';
  if (score >= 40) return 'weak-indirect';
  return 'insufficient';
}

export type UpdateDecision = 'update' | 'review' | 'evidence_only';

/**
 * Auto-update rules:
 *   confidence >= AUTO_UPDATE_THRESHOLD (default 85) -> update record directly
 *   REVIEW_THRESHOLD..AUTO_UPDATE_THRESHOLD (60-84)  -> create review_queue item
 *   < REVIEW_THRESHOLD (60)                          -> save evidence only
 */
export function decideUpdate(confidence: number): UpdateDecision {
  if (confidence >= config.thresholds.autoUpdate) return 'update';
  if (confidence >= config.thresholds.review) return 'review';
  return 'evidence_only';
}

/** Map a 0..100 confidence to the attendance confidence tier. */
export function confidenceToTier(score: number): ConfidenceTier {
  if (score >= 75) return 'High';
  if (score >= 55) return 'Medium';
  if (score >= 35) return 'Low';
  return 'Very Low';
}

export function clampConfidence(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n * 100) / 100));
}
