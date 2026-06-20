import { decideUpdate, clampConfidence, type UpdateDecision } from '../lib/confidence.js';
import { logger } from '../lib/logger.js';
import type { LlmProvider } from '../claude/client.js';
import type { LlmEvidenceItem } from '../claude/prompts.js';
import type { ResearchProvider, ResearchBundle } from '../research/types.js';
import type { Store } from '../db/store.js';
import type { Church } from '../types.js';

export interface AgentContext {
  store: Store;
  llm: LlmProvider;
  research: ResearchProvider;
}

export interface RunMeter {
  tokens: number;
  cost: number;
}

export function newMeter(): RunMeter {
  return { tokens: 0, cost: 0 };
}

export function meterAdd(meter: RunMeter, usage: { inputTokens: number; outputTokens: number; costEstimate: number }) {
  meter.tokens += usage.inputTokens + usage.outputTokens;
  meter.cost += usage.costEstimate;
}

function sourceTypeForUrl(url: string | null, official: string | null): string {
  if (!url) return 'inference';
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    if (official && url.startsWith(new URL(official).origin)) return 'official_site';
    if (/facebook|instagram|twitter|x\.com|youtube|tiktok|linkedin/.test(host)) return 'social';
    if (/duckduckgo|google|bing/.test(host)) return 'search';
    return 'directory';
  } catch {
    return 'unknown';
  }
}

/** Persist the evidence array a Claude agent returned. */
export async function recordLlmEvidence(
  ctx: AgentContext,
  churchId: string,
  bundle: ResearchBundle,
  items: LlmEvidenceItem[],
): Promise<void> {
  for (const it of items) {
    await ctx.store.insertEvidence({
      church_id: churchId,
      field_name: it.field_name,
      proposed_value: it.proposed_value,
      evidence_text: it.evidence_text,
      source_url: it.source_url,
      source_type: sourceTypeForUrl(it.source_url, bundle.officialSite),
      confidence_score: clampConfidence(it.confidence_score),
    });
  }
}

/**
 * Apply the auto-update rules for a single proposed field value:
 *   >=85 update directly | 60-84 review queue | <60 evidence only.
 */
export async function applyProposal<K extends keyof Church>(
  ctx: AgentContext,
  church: Church,
  field: K,
  value: Church[K],
  confidence: number,
  evidenceSummary: string,
  sourceUrls: string[],
): Promise<UpdateDecision> {
  const conf = clampConfidence(confidence);
  const decision = decideUpdate(conf);
  const fieldName = String(field);

  if (value === null || value === undefined || value === '') {
    // Nothing concrete proposed — skip silently.
    return 'evidence_only';
  }

  if (decision === 'update') {
    await ctx.store.updateChurch(church.id, { [field]: value } as Partial<Church>);
    logger.info(`  ✓ ${fieldName} = ${String(value)} (conf ${conf}, auto-updated)`);
  } else if (decision === 'review') {
    await ctx.store.enqueueReview({
      church_id: church.id,
      field_name: fieldName,
      current_value: church[field] == null ? null : String(church[field]),
      proposed_value: String(value),
      confidence_score: conf,
      evidence_summary: evidenceSummary,
      source_urls: sourceUrls.filter(Boolean),
      review_status: 'pending',
    });
    logger.info(`  ? ${fieldName} = ${String(value)} (conf ${conf}, queued for review)`);
  } else {
    logger.info(`  · ${fieldName} = ${String(value)} (conf ${conf}, evidence only)`);
  }
  return decision;
}

export function sourceUrlsFrom(items: LlmEvidenceItem[]): string[] {
  return [...new Set(items.map((i) => i.source_url).filter((u): u is string => !!u))];
}
