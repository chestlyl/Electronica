/**
 * Ledger invariants: the agent can only propose; humans approve/reject/execute;
 * balances are derived correctly; the seed can never be overdrawn.
 *
 *   (run via `npm run test`)
 */
import assert from 'node:assert';
import { Ledger } from '../ledger.js';
import { toCents } from '../money.js';

let failures = 0;
function check(label: string, fn: () => void) {
  try { fn(); console.log(`  ✓ ${label}`); } catch (e) { failures++; console.log(`  ✗ ${label}: ${(e as Error).message}`); }
}

function main() {
  console.log('ledger');

  check('seed sets initial balance', () => {
    const l = new Ledger(toCents(100));
    assert.strictEqual(l.balance().executedBalanceCents, toCents(100));
    assert.strictEqual(l.balance().committedAvailableCents, toCents(100));
  });

  check('propose creates a proposed expense, balance unchanged until executed', () => {
    const l = new Ledger(toCents(100));
    l.propose({ direction: 'expense', amountCents: toCents(20), description: 'api', rationale: 'r', category: 'startup' });
    const b = l.balance();
    assert.strictEqual(b.executedBalanceCents, toCents(100)); // proposed doesn't move executed
    assert.strictEqual(b.proposedExpenseCents, toCents(20));
  });

  check('approve reduces committed-available but not executed', () => {
    const l = new Ledger(toCents(100));
    const e = l.propose({ direction: 'expense', amountCents: toCents(20), description: 'api', rationale: 'r', category: 'startup' });
    l.approve(e.id);
    const b = l.balance();
    assert.strictEqual(b.executedBalanceCents, toCents(100));
    assert.strictEqual(b.committedAvailableCents, toCents(80));
  });

  check('execute moves executed balance', () => {
    const l = new Ledger(toCents(100));
    const e = l.propose({ direction: 'expense', amountCents: toCents(20), description: 'api', rationale: 'r', category: 'startup' });
    l.approve(e.id);
    l.execute(e.id);
    assert.strictEqual(l.balance().executedBalanceCents, toCents(80));
  });

  check('income increases balance when executed', () => {
    const l = new Ledger(toCents(100));
    const e = l.propose({ direction: 'income', amountCents: toCents(50), description: 'sale', rationale: 'r', category: 'sale' });
    l.approve(e.id);
    l.execute(e.id);
    const b = l.balance();
    assert.strictEqual(b.executedBalanceCents, toCents(150));
    assert.strictEqual(b.executedIncomeCents, toCents(50));
  });

  check('cannot approve a non-proposed entry', () => {
    const l = new Ledger(toCents(100));
    const e = l.propose({ direction: 'expense', amountCents: toCents(10), description: 'x', rationale: 'r', category: 'c' });
    l.approve(e.id);
    assert.throws(() => l.approve(e.id), /expected "proposed"/);
  });

  check('cannot execute an unapproved entry', () => {
    const l = new Ledger(toCents(100));
    const e = l.propose({ direction: 'expense', amountCents: toCents(10), description: 'x', rationale: 'r', category: 'c' });
    assert.throws(() => l.execute(e.id), /expected "approved"/);
  });

  check('executing an expense that overdraws the seed is blocked', () => {
    const l = new Ledger(toCents(10));
    const e = l.propose({ direction: 'expense', amountCents: toCents(20), description: 'too big', rationale: 'r', category: 'c' });
    l.approve(e.id);
    assert.throws(() => l.execute(e.id), /overdraw/);
  });

  check('rejected entries do not affect any balance', () => {
    const l = new Ledger(toCents(100));
    const e = l.propose({ direction: 'expense', amountCents: toCents(30), description: 'x', rationale: 'r', category: 'c' });
    l.reject(e.id, 'not worth it');
    const b = l.balance();
    assert.strictEqual(b.executedBalanceCents, toCents(100));
    assert.strictEqual(b.committedAvailableCents, toCents(100));
    assert.strictEqual(b.proposedExpenseCents, 0);
  });

  check('propose rejects non-positive / non-integer amounts', () => {
    const l = new Ledger(toCents(100));
    assert.throws(() => l.propose({ direction: 'expense', amountCents: 0, description: 'x', rationale: 'r', category: 'c' }));
    assert.throws(() => l.propose({ direction: 'expense', amountCents: 10.5, description: 'x', rationale: 'r', category: 'c' }));
  });

  console.log(failures ? `\nFAILED (${failures})` : '\nALL PASSED');
  process.exit(failures ? 1 : 0);
}

main();
