/**
 * Integrity engine: the dishonest paths must be BLOCKED and the honest paths
 * ALLOWED. These are the rules that make "with integrity" real.
 *
 *   (run via `npm run test`)
 */
import assert from 'node:assert';
import { assessIntegrity } from '../integrity.js';
import type { AgentAction, LedgerBalance } from '../types.js';

let failures = 0;
function check(label: string, fn: () => void) {
  try { fn(); console.log(`  ✓ ${label}`); } catch (e) { failures++; console.log(`  ✗ ${label}: ${(e as Error).message}`); }
}

const bal = (availableCents: number): LedgerBalance => ({
  seedCents: 10000,
  executedBalanceCents: availableCents,
  committedAvailableCents: availableCents,
  proposedExpenseCents: 0,
  executedIncomeCents: 0,
  executedExpenseCents: 0,
});

function main() {
  console.log('integrity engine');

  check('honest, disclosed post is allowed', () => {
    const a: AgentAction = { kind: 'post', channel: 'm/sideprojects', content: 'Useful write-up.', disclosesAgentIdentity: true };
    const v = assessIntegrity(a);
    assert.strictEqual(v.allowed, true);
    assert.strictEqual(v.severity, 'ok');
  });

  check('undisclosed public post is blocked', () => {
    const a: AgentAction = { kind: 'post', content: 'Useful write-up.' };
    const v = assessIntegrity(a);
    assert.strictEqual(v.allowed, false);
    assert.ok(v.violations.some((x) => x.ruleId === 'disclosure'));
  });

  check('pump / guaranteed-returns content is blocked', () => {
    const a: AgentAction = { kind: 'post', content: 'Buy now, guaranteed returns, to the moon!', disclosesAgentIdentity: true };
    const v = assessIntegrity(a);
    assert.strictEqual(v.allowed, false);
    assert.ok(v.violations.some((x) => x.ruleId === 'no-market-manipulation'));
  });

  check('claiming to be human is blocked', () => {
    const a: AgentAction = { kind: 'comment', content: 'Trust me, I am a human and not a bot.', disclosesAgentIdentity: true };
    const v = assessIntegrity(a);
    assert.strictEqual(v.allowed, false);
    assert.ok(v.violations.some((x) => x.ruleId === 'no-impersonation'));
  });

  check('vote-manipulation intent is blocked', () => {
    const a: AgentAction = { kind: 'upvote', intent: 'mass upvote to farm karma' };
    const v = assessIntegrity(a);
    assert.strictEqual(v.allowed, false);
    assert.ok(v.violations.some((x) => x.ruleId === 'no-vote-gaming'));
  });

  check('a genuine single upvote is allowed', () => {
    const a: AgentAction = { kind: 'upvote', intent: 'this post is genuinely helpful' };
    assert.strictEqual(assessIntegrity(a).allowed, true);
  });

  check('credential solicitation is blocked', () => {
    const a: AgentAction = { kind: 'outreach', content: 'Please send your bank login and routing number.' };
    const v = assessIntegrity(a);
    assert.strictEqual(v.allowed, false);
    assert.ok(v.violations.some((x) => x.ruleId === 'no-credential-harvest'));
  });

  check('overspending the ledger is blocked', () => {
    const a: AgentAction = { kind: 'spend', amountCents: 9000, category: 'ads' };
    const v = assessIntegrity(a, { balance: bal(5000) });
    assert.strictEqual(v.allowed, false);
    assert.ok(v.violations.some((x) => x.ruleId === 'spend-within-ledger'));
  });

  check('spending within budget is allowed', () => {
    const a: AgentAction = { kind: 'spend', amountCents: 2000, category: 'api' };
    assert.strictEqual(assessIntegrity(a, { balance: bal(5000) }).allowed, true);
  });

  check('acting faster than the rate limit is blocked', () => {
    const a: AgentAction = { kind: 'post', content: 'hi', disclosesAgentIdentity: true };
    const v = assessIntegrity(a, { minSecondsBetweenActions: 45, secondsSinceLastAction: 5 });
    assert.strictEqual(v.allowed, false);
    assert.ok(v.violations.some((x) => x.ruleId === 'rate-limit'));
  });

  check('duplicate content across channels is blocked as spam', () => {
    const a: AgentAction = { kind: 'post', channel: 'm/x', content: 'Same thing', disclosesAgentIdentity: true };
    // signature() includes the channel, so reuse the same channel for the dupe.
    const sig = `m/x|post|same thing`;
    const v = assessIntegrity(a, { recentSignatures: [sig] });
    assert.strictEqual(v.allowed, false);
    assert.ok(v.violations.some((x) => x.ruleId === 'no-duplicate-spam'));
  });

  check('undisclosed affiliate promo warns but is allowed', () => {
    const a: AgentAction = { kind: 'post', content: 'Use my referral link to sign up!', disclosesAgentIdentity: true };
    const v = assessIntegrity(a);
    assert.strictEqual(v.allowed, true);
    assert.strictEqual(v.severity, 'warn');
    assert.ok(v.violations.some((x) => x.ruleId === 'disclose-paid-promotion'));
  });

  console.log(failures ? `\nFAILED (${failures})` : '\nALL PASSED');
  process.exit(failures ? 1 : 0);
}

main();
