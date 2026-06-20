import { multiplicationPrompt, type MultiplicationResult } from '../claude/prompts.js';
import {
  influenceScore,
  mmcFitScore,
  multiplicationScore,
} from '../lib/scoring.js';
import type { ResearchBundle } from '../research/types.js';
import type { Church } from '../types.js';
import {
  recordLlmEvidence,
  meterAdd,
  type AgentContext,
  type RunMeter,
} from './base.js';

export interface ScoreOutcome {
  multiplication: MultiplicationResult;
  scores: {
    multiplication_score: number;
    influence_score: number;
    mmc_fit_score: number;
    church_planting_activity: number;
    leadership_development_score: number;
    digital_reach_score: number;
  };
}

/**
 * Multiplication & MMC Fit Agent. Reads public content, scores multiplication
 * signals, then computes the weighted Influence / MMC Fit / Multiplication
 * scores using the platform formulas. Score fields are derived metrics and are
 * always written (not gated by the auto-update threshold).
 */
export async function runMultiplication(
  ctx: AgentContext,
  church: Church,
  bundle: ResearchBundle,
  meter: RunMeter,
): Promise<ScoreOutcome> {
  const { data, usage } = await ctx.llm.extractJson<MultiplicationResult>({
    system: multiplicationPrompt.system,
    user: multiplicationPrompt.user(church, bundle),
    schema: multiplicationPrompt.schema,
    maxTokens: 1400,
  });
  meterAdd(meter, usage);
  await recordLlmEvidence(ctx, church.id, bundle, data.evidence);

  // Re-read so we score against any attendance/structure the size agent wrote.
  const fresh = (await ctx.store.getChurch(church.id)) ?? church;

  const mmcInputs = {
    multiplicationLanguage: data.multiplication_orientation,
    churchPlantingActivity: data.church_planting_activity,
    leadershipDevelopment: data.leadership_development,
    kingdomCollaboration: data.kingdom_collaboration,
    innovationOpenness: data.innovation,
  };

  const scores = {
    church_planting_activity: data.church_planting_activity,
    leadership_development_score: data.leadership_development,
    digital_reach_score: data.digital_reach,
    multiplication_score: multiplicationScore(mmcInputs),
    mmc_fit_score: mmcFitScore(mmcInputs),
    influence_score: influenceScore({
      church: fresh,
      digitalReachScore: data.digital_reach,
      leadershipDevelopmentScore: data.leadership_development,
    }),
  };

  await ctx.store.updateChurch(church.id, scores);

  return { multiplication: data, scores };
}
