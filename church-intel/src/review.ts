import { logger } from './lib/logger.js';
import type { Store } from './db/store.js';
import type { Church, ReviewItem, ReviewStatus } from './types.js';

const NUMERIC_FIELDS = new Set<keyof Church>([
  'staff_count', 'campus_count', 'weekend_services_count',
  'attendance_estimate', 'attendance_min', 'attendance_max',
  'attendance_confidence', 'influence_score', 'mmc_fit_score',
  'multiplication_score', 'church_planting_activity',
  'leadership_development_score', 'digital_reach_score', 'verification_score',
]);

/** Convert a review item's string proposed_value to the field's real type. */
export function coerceFieldValue(field: string, value: string | null): unknown {
  if (value === null) return null;
  if (NUMERIC_FIELDS.has(field as keyof Church)) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return value;
}

/** Apply a single approved review item to the church record. */
export async function applyReviewItem(store: Store, item: ReviewItem): Promise<void> {
  const value = coerceFieldValue(item.field_name, item.proposed_value);
  await store.updateChurch(item.church_id, { [item.field_name]: value } as Partial<Church>);
}

export async function setReviewStatus(
  store: Store,
  id: string,
  status: ReviewStatus,
  notes?: string,
): Promise<void> {
  const item = await store.getReviewItem(id);
  if (!item) throw new Error(`review item ${id} not found`);
  if (status === 'approved') {
    await applyReviewItem(store, item);
    logger.info(`Approved & applied: ${item.field_name} = ${item.proposed_value}`);
  }
  await store.updateReview(id, { review_status: status, reviewer_notes: notes ?? null });
}

export interface ReviewQueueSummary {
  pending: number;
  approvedApplied: number;
  rejected: number;
  needsMoreResearch: number;
}

/**
 * process-review-queue: commit any items already marked "approved" (idempotent)
 * and report what remains pending for a human.
 */
export async function processReviewQueue(store: Store): Promise<ReviewQueueSummary> {
  const approved = await store.listReviewQueue('approved');
  for (const item of approved) {
    await applyReviewItem(store, item);
  }
  const pending = (await store.listReviewQueue('pending')).length;
  const rejected = (await store.listReviewQueue('rejected')).length;
  const needsMore = (await store.listReviewQueue('needs_more_research')).length;
  logger.info(
    `Review queue — pending: ${pending}, approved/applied: ${approved.length}, ` +
      `rejected: ${rejected}, needs more research: ${needsMore}`,
  );
  return {
    pending,
    approvedApplied: approved.length,
    rejected,
    needsMoreResearch: needsMore,
  };
}
