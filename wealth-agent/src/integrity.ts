/**
 * The integrity engine.
 *
 * Every outward action the agent considers — a Moltbook post, a vote, an
 * outreach message, a spend — is passed through `assessIntegrity()` BEFORE it
 * can happen. A `block` verdict is a hard stop: the calling client must refuse.
 *
 * The rules encode a simple creed: be honest about who you are, add real value,
 * never manipulate people or markets, never spend money you don't have, never
 * touch credentials or accounts. These are deliberately conservative — when in
 * doubt the agent should do less, not more.
 *
 * This module is pure and deterministic so it can be unit-tested exhaustively.
 */
import type {
  AgentAction,
  IntegrityVerdict,
  IntegrityViolation,
  LedgerBalance,
} from './types.js';

export interface IntegrityContext {
  /** Current ledger balance, for spend checks. */
  balance?: LedgerBalance;
  /** Recent action signatures (channel|kind|hash) for spam/duplication checks. */
  recentSignatures?: string[];
  /** Seconds since the agent's last action on this channel, if known. */
  secondsSinceLastAction?: number;
  /** Minimum spacing required between actions (rate limit). */
  minSecondsBetweenActions?: number;
}

interface Rule {
  id: string;
  description: string;
  /** Returns a violation if the rule is broken, else null. */
  evaluate(action: AgentAction, ctx: IntegrityContext): IntegrityViolation | null;
}

// --- Vocabulary the rules match against. Kept explicit and auditable. ---

const MANIPULATION_PHRASES = [
  'pump', 'to the moon', 'guaranteed returns', 'guaranteed profit', 'can\'t lose',
  'risk-free', 'get rich quick', 'buy now before it', 'don\'t miss out', 'last chance',
  'insider', 'secret method', '100x', '1000x', 'financial freedom in',
];

const DECEPTION_PHRASES = [
  'i am a human', 'i am not a bot', 'i am not an ai', 'as a real person',
  'fake review', 'fake account', 'sockpuppet', 'astroturf',
];

const CREDENTIAL_PHRASES = [
  'bank login', 'routing number', 'account number', 'seed phrase', 'private key',
  'password', 'one-time code', 'otp', 'cvv', 'social security',
];

const VOTE_GAMING_INTENTS = [
  'manipulate votes', 'inflate', 'boost engagement artificially', 'vote ring',
  'brigade', 'mass upvote', 'mass downvote', 'farm karma',
];

function includesAny(haystack: string, needles: string[]): string | null {
  const h = haystack.toLowerCase();
  for (const n of needles) if (h.includes(n)) return n;
  return null;
}

const RULES: Rule[] = [
  {
    id: 'disclosure',
    description: 'Public posts/comments/replies must disclose the author is an AI agent.',
    evaluate(action) {
      if (!['post', 'comment', 'reply'].includes(action.kind)) return null;
      if (action.disclosesAgentIdentity) return null;
      return {
        ruleId: 'disclosure',
        severity: 'block',
        message:
          'Public content must disclose it is from an AI agent. Set disclosesAgentIdentity ' +
          'or append the configured disclosure string.',
      };
    },
  },
  {
    id: 'no-impersonation',
    description: 'The agent must never claim to be a human or deny being an AI.',
    evaluate(action) {
      const hit = action.content ? includesAny(action.content, DECEPTION_PHRASES) : null;
      if (!hit) return null;
      return {
        ruleId: 'no-impersonation',
        severity: 'block',
        message: `Content implies deception/impersonation ("${hit}"). The agent must be truthful about being an AI and must not fabricate identities or reviews.`,
      };
    },
  },
  {
    id: 'no-market-manipulation',
    description: 'No pump-and-dump, hype, or guaranteed-return claims (esp. m/cryptocurrency).',
    evaluate(action) {
      const hit = action.content ? includesAny(action.content, MANIPULATION_PHRASES) : null;
      if (!hit) return null;
      return {
        ruleId: 'no-market-manipulation',
        severity: 'block',
        message: `Content contains market-manipulation / hype language ("${hit}"). Integrity agents never pump assets or promise returns.`,
      };
    },
  },
  {
    id: 'no-vote-gaming',
    description: 'No artificial vote inflation, brigading, or karma farming.',
    evaluate(action) {
      const fields = [action.intent, action.content].filter(Boolean).join(' ');
      const hit = includesAny(fields, VOTE_GAMING_INTENTS);
      if (hit) {
        return {
          ruleId: 'no-vote-gaming',
          severity: 'block',
          message: `Action signals vote manipulation ("${hit}"). Upvotes/downvotes must reflect genuine assessment only.`,
        };
      }
      return null;
    },
  },
  {
    id: 'no-credential-harvest',
    description: 'Never request or transmit secrets, credentials, or financial account details.',
    evaluate(action) {
      const hit = action.content ? includesAny(action.content, CREDENTIAL_PHRASES) : null;
      if (!hit) return null;
      return {
        ruleId: 'no-credential-harvest',
        severity: 'block',
        message: `Content references credentials/secrets ("${hit}"). The agent must never solicit or handle these.`,
      };
    },
  },
  {
    id: 'rate-limit',
    description: 'Respect minimum spacing between actions to avoid spammy behavior.',
    evaluate(action, ctx) {
      if (!['post', 'comment', 'reply', 'upvote', 'downvote', 'outreach'].includes(action.kind)) {
        return null;
      }
      const min = ctx.minSecondsBetweenActions;
      const since = ctx.secondsSinceLastAction;
      if (min === undefined || since === undefined) return null;
      if (since >= min) return null;
      return {
        ruleId: 'rate-limit',
        severity: 'block',
        message: `Acting too fast (${since}s since last action; minimum ${min}s). Slow down to stay non-spammy.`,
      };
    },
  },
  {
    id: 'no-duplicate-spam',
    description: 'Do not post the same content repeatedly across channels.',
    evaluate(action, ctx) {
      if (!action.content || !ctx.recentSignatures) return null;
      const sig = signature(action);
      const dupes = ctx.recentSignatures.filter((s) => s === sig).length;
      if (dupes === 0) return null;
      return {
        ruleId: 'no-duplicate-spam',
        severity: 'block',
        message: 'Identical content was already posted recently. Repeated/duplicate posting is spam.',
      };
    },
  },
  {
    id: 'spend-within-ledger',
    description: 'Never propose spending more than the ledger has available.',
    evaluate(action, ctx) {
      if (action.kind !== 'spend' || action.amountCents === undefined) return null;
      if (action.amountCents <= 0) {
        return {
          ruleId: 'spend-within-ledger',
          severity: 'block',
          message: 'Spend amount must be positive.',
        };
      }
      if (!ctx.balance) return null; // can't check without a balance; caller should provide one
      if (action.amountCents > ctx.balance.committedAvailableCents) {
        return {
          ruleId: 'spend-within-ledger',
          severity: 'block',
          message: `Proposed spend (${action.amountCents}¢) exceeds available capital (${ctx.balance.committedAvailableCents}¢). The agent cannot overspend the seed.`,
        };
      }
      return null;
    },
  },
  {
    id: 'disclose-paid-promotion',
    description: 'Any paid/affiliate promotion must be clearly disclosed as such.',
    evaluate(action) {
      if (!action.content) return null;
      const c = action.content.toLowerCase();
      const looksPromotional = /\b(affiliate|sponsored|referral link|use my code|promo code)\b/.test(c);
      if (!looksPromotional) return null;
      const disclosed = /\b(disclosure|#ad|sponsored|affiliate link|i may earn)\b/.test(c);
      if (disclosed) return null;
      return {
        ruleId: 'disclose-paid-promotion',
        severity: 'warn',
        message: 'Content looks promotional but lacks an explicit paid/affiliate disclosure. Add one.',
      };
    },
  },
];

/** Stable-ish signature for duplicate detection (channel + kind + normalized content). */
export function signature(action: AgentAction): string {
  const norm = (action.content ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  return `${action.channel ?? ''}|${action.kind}|${norm}`;
}

export function assessIntegrity(
  action: AgentAction,
  ctx: IntegrityContext = {},
): IntegrityVerdict {
  const violations: IntegrityViolation[] = [];
  for (const rule of RULES) {
    const v = rule.evaluate(action, ctx);
    if (v) violations.push(v);
  }
  const blocked = violations.some((v) => v.severity === 'block');
  const warned = violations.some((v) => v.severity === 'warn');
  const severity = blocked ? 'block' : warned ? 'warn' : 'ok';

  let rationale: string;
  if (blocked) {
    rationale = 'BLOCKED: ' + violations.filter((v) => v.severity === 'block').map((v) => v.message).join(' ');
  } else if (warned) {
    rationale = 'ALLOWED WITH WARNINGS: ' + violations.map((v) => v.message).join(' ');
  } else {
    rationale = 'OK: action is consistent with the integrity policy.';
  }

  return { allowed: !blocked, severity, violations, rationale };
}

/** The rule catalog, exposed for documentation / the `integrity-policy` command. */
export function integrityRules(): { id: string; description: string }[] {
  return RULES.map((r) => ({ id: r.id, description: r.description }));
}
