import { denominationPrompt, type DenominationResult } from '../claude/prompts.js';
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

/** Denomination & Network Agent. Returns "Unknown" rather than guessing. */
export async function runDenomination(
  ctx: AgentContext,
  church: Church,
  bundle: ResearchBundle,
  meter: RunMeter,
): Promise<DenominationResult> {
  const { data, usage } = await ctx.llm.extractJson<DenominationResult>({
    system: denominationPrompt.system,
    user: denominationPrompt.user(church, bundle),
    schema: denominationPrompt.schema,
    maxTokens: 1000,
  });
  meterAdd(meter, usage);

  await recordLlmEvidence(ctx, church.id, bundle, data.evidence);
  const urls = sourceUrlsFrom(data.evidence);

  if (data.denomination && data.denomination.toLowerCase() !== 'unknown') {
    await applyProposal(ctx, church, 'denomination', data.denomination, data.denomination_confidence, 'Denomination classification', urls);
  }
  if (data.network_affiliation && data.network_affiliation.toLowerCase() !== 'unknown') {
    await applyProposal(ctx, church, 'network_affiliation', data.network_affiliation, data.network_confidence, 'Network affiliation classification', urls);
  }

  return data;
}
