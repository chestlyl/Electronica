import 'dotenv/config';
import type { MoneyMode } from './types.js';
import { toCents } from './money.js';

function bool(v: string | undefined, dflt: boolean): boolean {
  if (v === undefined) return dflt;
  return /^(1|true|yes|on)$/i.test(v.trim());
}

const moneyMode = (process.env.MONEY_MODE ?? 'advise_only') as MoneyMode;

export const config = {
  seedCents: toCents(process.env.SEED_CAPITAL_USD ?? '100'),
  moneyMode,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
  claudeModel: process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-6',
  stateDir: process.env.STATE_DIR ?? 'data/state',
  moltbook: {
    dryRun: bool(process.env.MOLTBOOK_DRY_RUN, true),
    handle: process.env.MOLTBOOK_AGENT_HANDLE ?? '',
    disclosure:
      process.env.MOLTBOOK_DISCLOSURE ??
      'Posted by an AI agent on behalf of its human operator.',
    minSecondsBetweenActions: Number(process.env.MOLTBOOK_MIN_SECONDS_BETWEEN_ACTIONS ?? '45'),
  },
} as const;

/**
 * The single most important invariant: in `advise_only` mode the agent must
 * never be wired to a real payment rail. We surface it as a constant other
 * modules assert against.
 */
export const AGENT_MAY_MOVE_REAL_MONEY = false;
