import { logger } from '../lib/logger.js';
import type { ResearchBundle, ResearchInput } from '../research/types.js';
import type { Church, RunStatus } from '../types.js';
import { newMeter, type AgentContext, type RunMeter } from './base.js';
import { runVerification } from './verification.js';
import { runContact } from './contact.js';
import { runDenomination } from './denomination.js';
import { runSize } from './size.js';
import { runMultiplication } from './multiplication.js';

export type { AgentContext } from './base.js';

function toResearchInput(c: Church): ResearchInput {
  return {
    name: c.name ?? '',
    city: c.city,
    state: c.state,
    originalWebsite: c.website_original,
    originalPhone: c.phone_original,
    originalEmail: c.email_original,
  };
}

async function withRun<T>(
  ctx: AgentContext,
  churchId: string,
  runType: string,
  fn: (meter: RunMeter) => Promise<T>,
): Promise<T> {
  const meter = newMeter();
  const runId = await ctx.store.createRun({
    church_id: churchId,
    run_type: runType,
    status: 'running',
    model_used: ctx.llm.model,
  });
  let status: RunStatus = 'completed';
  let error: string | null = null;
  try {
    return await fn(meter);
  } catch (err) {
    status = 'failed';
    error = (err as Error).message;
    logger.error(`run ${runType} failed for ${churchId}: ${error}`);
    throw err;
  } finally {
    await ctx.store.completeRun(runId, {
      status,
      error_message: error,
      tokens_used: meter.tokens,
      cost_estimate: Math.round(meter.cost * 10000) / 10000,
      model_used: ctx.llm.model,
    });
  }
}

/**
 * If research produced no readable pages, record a review-queue item explaining
 * why (so a human can investigate) and report whether agents can still run.
 * Returns true when there is enough signal to run extraction agents.
 */
async function ensureResearchable(
  ctx: AgentContext,
  church: Church,
  bundle: ResearchBundle,
): Promise<boolean> {
  const okPages = bundle.pages.filter((p) => p.ok).length;
  if (okPages > 0) return true;

  const reason = bundle.officialSite
    ? `Found a candidate site (${bundle.officialSite}) but could not read any pages ` +
      `[crawlMethod=${bundle.crawlMethod}]. ${bundle.note ?? ''}`
    : `No official website could be identified [crawlMethod=${bundle.crawlMethod}]. ` +
      (bundle.searchResults.length === 0
        ? 'Web search returned no results (outbound search may be blocked).'
        : 'Search returned only directory/social links.');

  await ctx.store.enqueueReview({
    church_id: church.id,
    field_name: 'research_status',
    current_value: null,
    proposed_value: 'needs manual research',
    confidence_score: 0,
    evidence_summary: reason.trim(),
    source_urls: bundle.officialSite ? [bundle.officialSite] : [],
    review_status: 'pending',
  });
  logger.warn('  research yielded no readable pages — queued a research_status review item');
  return false;
}

/** verify-church: research + Church Verification Agent. */
export async function verifyChurch(ctx: AgentContext, churchId: string): Promise<void> {
  const church = await ctx.store.getChurch(churchId);
  if (!church) throw new Error(`church ${churchId} not found`);
  logger.info(`▶ verify: ${church.name} (${church.city}, ${church.state})`);
  await withRun(ctx, churchId, 'verify', async (meter) => {
    const bundle = await ctx.research.research(toResearchInput(church));
    const researchable = await ensureResearchable(ctx, church, bundle);
    // Verification can still reason from search snippets, so run it whenever we
    // have pages OR search results.
    if (researchable || bundle.searchResults.length > 0) {
      await runVerification(ctx, church, bundle, meter);
    }
  });
}

/**
 * enrich-church: ONE research pass shared across all agents:
 * verification → contact → denomination → size → multiplication/scoring.
 */
export async function enrichChurch(ctx: AgentContext, churchId: string): Promise<void> {
  const church = await ctx.store.getChurch(churchId);
  if (!church) throw new Error(`church ${churchId} not found`);
  logger.info(`▶ enrich: ${church.name} (${church.city}, ${church.state})`);
  await withRun(ctx, churchId, 'enrich', async (meter) => {
    const bundle: ResearchBundle = await ctx.research.research(toResearchInput(church));
    logger.info(`  research: crawlMethod=${bundle.crawlMethod}, pages=${bundle.pages.filter((p) => p.ok).length}, site=${bundle.officialSite ?? '—'}`);
    const researchable = await ensureResearchable(ctx, church, bundle);

    // Verification can use search snippets even without readable pages.
    if (researchable || bundle.searchResults.length > 0) {
      await safe('verification', () => runVerification(ctx, church, bundle, meter));
    }
    // Content-extraction agents need actual page text.
    if (researchable) {
      await safe('contact', () => runContact(ctx, church, bundle, meter));
      await safe('denomination', () => runDenomination(ctx, church, bundle, meter));
      await safe('size', () => runSize(ctx, church, bundle, meter));
      await safe('scoring', () => runMultiplication(ctx, church, bundle, meter));
    } else {
      logger.warn('  skipping content agents (no readable pages)');
    }
  });
}

/** score-church: research + multiplication/scoring only (uses existing fields). */
export async function scoreChurch(ctx: AgentContext, churchId: string): Promise<void> {
  const church = await ctx.store.getChurch(churchId);
  if (!church) throw new Error(`church ${churchId} not found`);
  logger.info(`▶ score: ${church.name}`);
  await withRun(ctx, churchId, 'score', async (meter) => {
    const bundle = await ctx.research.research(toResearchInput(church));
    await runMultiplication(ctx, church, bundle, meter);
  });
}

/** Run one agent step but don't let a single failure abort the whole enrich. */
async function safe(label: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    logger.warn(`  agent step "${label}" failed: ${(err as Error).message}`);
  }
}
