import { contactPrompt, type ContactResult } from '../claude/prompts.js';
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

/** Contact Enrichment Agent — public email, phone, lead pastor. */
export async function runContact(
  ctx: AgentContext,
  church: Church,
  bundle: ResearchBundle,
  meter: RunMeter,
): Promise<ContactResult> {
  const { data, usage } = await ctx.llm.extractJson<ContactResult>({
    system: contactPrompt.system,
    user: contactPrompt.user(church, bundle),
    schema: contactPrompt.schema,
    maxTokens: 1200,
  });
  meterAdd(meter, usage);

  await recordLlmEvidence(ctx, church.id, bundle, data.evidence);
  const urls = sourceUrlsFrom(data.evidence);

  await applyProposal(ctx, church, 'email_verified', data.email_verified, data.email_confidence, 'Public office email', urls);
  await applyProposal(ctx, church, 'phone_verified', data.phone_verified, data.phone_confidence, 'Public office phone', urls);
  await applyProposal(ctx, church, 'lead_pastor', data.lead_pastor, data.lead_pastor_confidence, 'Lead/senior pastor', urls);

  return data;
}
