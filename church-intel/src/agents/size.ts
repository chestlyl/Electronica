import { sizePrompt, type SizeResult } from '../claude/prompts.js';
import { confidenceToTier } from '../lib/confidence.js';
import type { ResearchBundle } from '../research/types.js';
import type { Church } from '../types.js';
import {
  applyProposal,
  recordLlmEvidence,
  sourceUrlsFrom,
  meterAdd,
  type AgentContext,
  type RunMeter,
} from './base.js';

/**
 * Church Size Estimation Agent. Never emits a point estimate without a range
 * and confidence; prefers Unknown (null) over false precision.
 */
export async function runSize(
  ctx: AgentContext,
  church: Church,
  bundle: ResearchBundle,
  meter: RunMeter,
): Promise<SizeResult> {
  const { data, usage } = await ctx.llm.extractJson<SizeResult>({
    system: sizePrompt.system,
    user: sizePrompt.user(church, bundle),
    schema: sizePrompt.schema,
    maxTokens: 1400,
  });
  meterAdd(meter, usage);

  await recordLlmEvidence(ctx, church.id, bundle, data.evidence);
  const urls = sourceUrlsFrom(data.evidence);

  // Structural counts (high-confidence when explicit on the site).
  if (data.staff_count != null) await applyProposal(ctx, church, 'staff_count', data.staff_count, 80, 'Staff count from site', urls);
  if (data.campus_count != null) await applyProposal(ctx, church, 'campus_count', data.campus_count, 85, 'Campus count from site', urls);
  if (data.weekend_services_count != null) await applyProposal(ctx, church, 'weekend_services_count', data.weekend_services_count, 80, 'Weekend services from site', urls);

  // Attendance: only write when we actually have an estimate WITH a range.
  if (data.attendance_estimate != null && data.attendance_min != null && data.attendance_max != null) {
    const tier = data.attendance_confidence_tier ?? confidenceToTier(data.attendance_confidence);
    // Attendance estimate fields are written together as a block (derived metric),
    // but gated by the same auto-update decision on attendance_estimate.
    const decision = await applyProposal(
      ctx, church, 'attendance_estimate', data.attendance_estimate,
      data.attendance_confidence, data.reasoning, urls,
    );
    if (decision === 'update') {
      await ctx.store.updateChurch(church.id, {
        attendance_min: data.attendance_min,
        attendance_max: data.attendance_max,
        attendance_confidence: data.attendance_confidence,
        attendance_confidence_tier: tier,
      });
    }
  }

  return data;
}
