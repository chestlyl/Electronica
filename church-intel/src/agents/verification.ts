import { verificationPrompt, type VerificationResult } from '../claude/prompts.js';
import { clampConfidence } from '../lib/confidence.js';
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
 * Church Verification Agent — is the church active? what's the official site?
 * signs of closure / merger / rename / relocation.
 */
export async function runVerification(
  ctx: AgentContext,
  church: Church,
  bundle: ResearchBundle,
  meter: RunMeter,
): Promise<VerificationResult> {
  const { data, usage } = await ctx.llm.extractJson<VerificationResult>({
    system: verificationPrompt.system,
    user: verificationPrompt.user(church, bundle),
    schema: verificationPrompt.schema,
    maxTokens: 1600,
  });
  meterAdd(meter, usage);

  await recordLlmEvidence(ctx, church.id, bundle, data.evidence);
  const urls = sourceUrlsFrom(data.evidence);

  await applyProposal(
    ctx, church, 'active_status', data.active_status,
    data.active_status_confidence,
    data.reasoning + (data.closure_merger_signals.length ? ` | signals: ${data.closure_merger_signals.join('; ')}` : ''),
    urls,
  );

  if (data.website_verified) {
    await applyProposal(
      ctx, church, 'website_verified', data.website_verified,
      data.website_verified_confidence, 'Official website identified during verification', urls,
    );
  }

  // verification_score is a derived metric: always written.
  const verificationScore = clampConfidence(
    data.active_status_confidence * 0.6 + data.website_verified_confidence * 0.4,
  );
  await ctx.store.updateChurch(church.id, {
    verification_score: verificationScore,
    last_checked_at: new Date().toISOString(),
  });

  return data;
}
