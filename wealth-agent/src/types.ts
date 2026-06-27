/**
 * Core types for wealth-agent.
 *
 * Money is always represented in integer **US cents** to avoid floating-point
 * drift. Never store dollars as a float. Helpers in `money.ts` convert.
 */

export type Cents = number; // integer cents, e.g. $100.00 -> 10000

export type MoneyMode = 'advise_only' | 'prepaid_wallet' | 'scoped_autonomy';

/**
 * A ledger entry models a single intended movement of the seed capital.
 * The agent only ever creates `proposed` entries. A human transitions them to
 * `approved`/`rejected`, and marks `executed` once THEY have actually paid /
 * received the money in the real world. The agent never moves real money.
 */
export type LedgerStatus = 'proposed' | 'approved' | 'rejected' | 'executed';

export type LedgerDirection = 'expense' | 'income';

export interface LedgerEntry {
  id: string;
  createdAt: string; // ISO
  direction: LedgerDirection;
  amountCents: Cents; // always positive; `direction` carries the sign
  description: string;
  /** What this buys/earns and why it advances the plan. */
  rationale: string;
  /** Free-form category, e.g. "api_cost", "hosting", "ad_spend", "sale". */
  category: string;
  status: LedgerStatus;
  /** Optional link to the opportunity this entry serves. */
  opportunityId?: string;
  /** Human note recorded at approval/rejection/execution time. */
  note?: string;
  updatedAt?: string;
}

export interface LedgerState {
  seedCents: Cents;
  currency: 'USD';
  entries: LedgerEntry[];
}

/** A balance snapshot derived from the ledger. */
export interface LedgerBalance {
  seedCents: Cents;
  /** seed - executed expenses + executed income */
  executedBalanceCents: Cents;
  /** executedBalance - approved-but-not-yet-executed expenses (worst case) */
  committedAvailableCents: Cents;
  /** Total still-pending (proposed) expense exposure. */
  proposedExpenseCents: Cents;
  executedIncomeCents: Cents;
  executedExpenseCents: Cents;
}

/**
 * An opportunity is a concrete, low-capital, *honest* way to earn. The scout
 * proposes these; scoring ranks them. Mirrors church-intel's evidence+confidence
 * discipline: every opportunity carries the reasoning and a confidence (0-100)
 * that the EV estimate is realistic, never an inflated promise.
 */
export interface Opportunity {
  id: string;
  title: string;
  summary: string;
  /** e.g. "research_service", "digital_product", "freelance", "content". */
  category: string;
  /** Up-front cash needed before first dollar, in cents. */
  startupCostCents: Cents;
  /** Realistic gross revenue in the first 30 days, in cents (low estimate). */
  expectedRevenue30dCents: Cents;
  /** Hours of human/agent work to first dollar. */
  hoursToFirstDollar: number;
  /** 0-100: how confident the EV estimate is, given the evidence. */
  evConfidence: number;
  /** Plain-language reasons + any sources backing the estimate. */
  evidence: string[];
  /** Honest, named risks. Never hidden. */
  risks: string[];
  /** Why this is integrity-clean (no deception/manipulation/spam). */
  integrityBasis: string;
  /** Computed by scoreOpportunity(); absent until scored. */
  score?: number;
}

/** The kind of action the agent might take on Moltbook or elsewhere. */
export type ActionKind =
  | 'post'
  | 'comment'
  | 'upvote'
  | 'downvote'
  | 'reply'
  | 'spend'
  | 'outreach';

export interface AgentAction {
  kind: ActionKind;
  /** Where: a submolt like "m/sideprojects", an email, a marketplace, etc. */
  channel?: string;
  /** The content being posted/sent, if any. */
  content?: string;
  /** For spend actions: amount in cents and the category. */
  amountCents?: Cents;
  category?: string;
  /** True if the agent has disclosed it is an AI agent in `content`. */
  disclosesAgentIdentity?: boolean;
  /** Caller-declared intent, used only as a hint; rules verify independently. */
  intent?: string;
}

export type IntegritySeverity = 'ok' | 'warn' | 'block';

export interface IntegrityViolation {
  ruleId: string;
  severity: 'warn' | 'block';
  message: string;
}

export interface IntegrityVerdict {
  allowed: boolean;
  severity: IntegritySeverity;
  violations: IntegrityViolation[];
  /** Human-readable summary of why the action was allowed/blocked. */
  rationale: string;
}
