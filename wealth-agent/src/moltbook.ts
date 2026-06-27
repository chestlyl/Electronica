/**
 * Integrity-gated Moltbook client.
 *
 * Moltbook (https://www.moltbook.com) is a Reddit-style network where AI agents
 * post, comment, and vote in topic "submolts". This client makes participation
 * SAFE BY CONSTRUCTION:
 *
 *   1. Every action is run through `assessIntegrity()` first. A `block` verdict
 *      means the action never leaves this process.
 *   2. The agent's AI identity is disclosed on every public post.
 *   3. It is `dryRun` by default: it logs what it WOULD do and never hits the
 *      network until a human explicitly turns dry-run off and provides a handle.
 *
 * The actual HTTP integration is intentionally left as a clearly-marked seam
 * (`deliver()`), because (a) Moltbook restricts posting to authenticated agents
 * via an owner "claim" tweet and (b) it was acquired by Meta in 2026, so the
 * real endpoint/credentials must be supplied deliberately by the operator.
 */
import { assessIntegrity, signature, type IntegrityContext } from './integrity.js';
import type { AgentAction, IntegrityVerdict } from './types.js';

export interface MoltbookConfig {
  dryRun: boolean;
  handle: string;
  disclosure: string;
  minSecondsBetweenActions: number;
}

export interface MoltbookResult {
  attempted: AgentAction;
  verdict: IntegrityVerdict;
  delivered: boolean;
  dryRun: boolean;
  note: string;
}

export class MoltbookClient {
  private recentSignatures: string[] = [];
  private lastActionEpochMs: number | null = null;

  constructor(private cfg: MoltbookConfig) {}

  /**
   * Attempt an action. Always assesses integrity first. Returns a structured
   * result; throws nothing for a blocked action (it simply isn't delivered).
   */
  async act(action: AgentAction, nowMs: number = Date.now()): Promise<MoltbookResult> {
    // Auto-append disclosure to public content so the disclosure rule passes and
    // readers always know this is an AI agent.
    const prepared = this.withDisclosure(action);

    const ctx: IntegrityContext = {
      recentSignatures: this.recentSignatures,
      minSecondsBetweenActions: this.cfg.minSecondsBetweenActions,
      secondsSinceLastAction:
        this.lastActionEpochMs === null
          ? Number.POSITIVE_INFINITY
          : Math.floor((nowMs - this.lastActionEpochMs) / 1000),
    };

    const verdict = assessIntegrity(prepared, ctx);

    if (!verdict.allowed) {
      return {
        attempted: prepared,
        verdict,
        delivered: false,
        dryRun: this.cfg.dryRun,
        note: 'Action blocked by integrity policy; not delivered.',
      };
    }

    if (this.cfg.dryRun || !this.cfg.handle) {
      this.record(prepared, nowMs);
      return {
        attempted: prepared,
        verdict,
        delivered: false,
        dryRun: true,
        note: this.cfg.handle
          ? 'DRY RUN: passed integrity; would post but dryRun is on.'
          : 'DRY RUN: no MOLTBOOK_AGENT_HANDLE set; nothing is ever sent.',
      };
    }

    await this.deliver(prepared);
    this.record(prepared, nowMs);
    return {
      attempted: prepared,
      verdict,
      delivered: true,
      dryRun: false,
      note: 'Delivered to Moltbook.',
    };
  }

  private withDisclosure(action: AgentAction): AgentAction {
    if (!['post', 'comment', 'reply'].includes(action.kind)) return action;
    const already = action.disclosesAgentIdentity === true;
    const hasText = action.content && action.content.includes(this.cfg.disclosure);
    if (already && hasText) return action;
    const content = action.content
      ? `${action.content}\n\n— ${this.cfg.disclosure}`
      : this.cfg.disclosure;
    return { ...action, content, disclosesAgentIdentity: true };
  }

  private record(action: AgentAction, nowMs: number): void {
    this.recentSignatures.push(signature(action));
    if (this.recentSignatures.length > 50) this.recentSignatures.shift();
    this.lastActionEpochMs = nowMs;
  }

  /**
   * The real network seam. Deliberately unimplemented: supply your authenticated
   * Moltbook integration here once you have a claimed agent handle. Until then,
   * the client stays in dry-run and never sends anything.
   */
  private async deliver(_action: AgentAction): Promise<void> {
    throw new Error(
      'MoltbookClient.deliver() is not wired to a live endpoint. Keep MOLTBOOK_DRY_RUN=true ' +
        'until you have a claimed agent handle and implement deliver() against the real API.',
    );
  }
}
