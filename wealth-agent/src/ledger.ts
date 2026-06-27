/**
 * The virtual ledger.
 *
 * This is the ONLY place "money" lives, and it is purely a record — no payment
 * rail, no card, no bank, no wallet. The agent creates `proposed` entries; a
 * human approves/rejects and, after they personally complete the real-world
 * transaction, marks an entry `executed`. Balances are derived, never stored.
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type {
  Cents,
  LedgerBalance,
  LedgerDirection,
  LedgerEntry,
  LedgerState,
} from './types.js';

export interface ProposeInput {
  direction: LedgerDirection;
  amountCents: Cents;
  description: string;
  rationale: string;
  category: string;
  opportunityId?: string;
}

export class Ledger {
  private state: LedgerState;

  constructor(seedCents: Cents, entries: LedgerEntry[] = []) {
    if (seedCents < 0) throw new Error('Seed capital cannot be negative.');
    this.state = { seedCents, currency: 'USD', entries };
  }

  /** Create a *proposed* entry. The agent can only ever call this. */
  propose(input: ProposeInput): LedgerEntry {
    if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
      throw new Error('amountCents must be a positive integer (cents).');
    }
    const now = new Date().toISOString();
    const entry: LedgerEntry = {
      id: randomUUID(),
      createdAt: now,
      direction: input.direction,
      amountCents: input.amountCents,
      description: input.description,
      rationale: input.rationale,
      category: input.category,
      status: 'proposed',
      opportunityId: input.opportunityId,
    };
    this.state.entries.push(entry);
    return entry;
  }

  /** Human action: move a proposed entry to approved. */
  approve(id: string, note?: string): LedgerEntry {
    return this.transition(id, 'proposed', 'approved', note);
  }

  /** Human action: reject a proposed entry. */
  reject(id: string, note?: string): LedgerEntry {
    return this.transition(id, 'proposed', 'rejected', note);
  }

  /**
   * Human action: mark an approved entry executed — i.e. the human has actually
   * paid or received the money in the real world. The agent must never call this
   * on its own initiative; it only records what the human reports.
   */
  execute(id: string, note?: string): LedgerEntry {
    return this.transition(id, 'approved', 'executed', note);
  }

  private transition(
    id: string,
    from: LedgerEntry['status'],
    to: LedgerEntry['status'],
    note?: string,
  ): LedgerEntry {
    const entry = this.state.entries.find((e) => e.id === id);
    if (!entry) throw new Error(`No ledger entry with id ${id}`);
    if (entry.status !== from) {
      throw new Error(`Entry ${id} is "${entry.status}", expected "${from}" to ${to} it.`);
    }
    // Guard: never let executed expenses drive the balance negative.
    if (to === 'executed' && entry.direction === 'expense') {
      const after = this.balance().executedBalanceCents - entry.amountCents;
      if (after < 0) {
        throw new Error(
          `Executing this expense would overdraw the seed (balance would be ${after}¢). Blocked.`,
        );
      }
    }
    entry.status = to;
    entry.note = note ?? entry.note;
    entry.updatedAt = new Date().toISOString();
    return entry;
  }

  balance(): LedgerBalance {
    let executedExpense = 0;
    let executedIncome = 0;
    let approvedExpense = 0;
    let proposedExpense = 0;
    for (const e of this.state.entries) {
      if (e.direction === 'expense') {
        if (e.status === 'executed') executedExpense += e.amountCents;
        else if (e.status === 'approved') approvedExpense += e.amountCents;
        else if (e.status === 'proposed') proposedExpense += e.amountCents;
      } else {
        if (e.status === 'executed') executedIncome += e.amountCents;
      }
    }
    const executedBalance = this.state.seedCents - executedExpense + executedIncome;
    return {
      seedCents: this.state.seedCents,
      executedBalanceCents: executedBalance,
      committedAvailableCents: executedBalance - approvedExpense,
      proposedExpenseCents: proposedExpense,
      executedIncomeCents: executedIncome,
      executedExpenseCents: executedExpense,
    };
  }

  entries(): readonly LedgerEntry[] {
    return this.state.entries;
  }

  toJSON(): LedgerState {
    return structuredClone(this.state);
  }

  // --- Persistence (local JSON only; never contains real credentials) ---

  static load(stateDir: string, seedCents: Cents): Ledger {
    const file = ledgerFile(stateDir);
    if (!existsSync(file)) return new Ledger(seedCents);
    const raw = JSON.parse(readFileSync(file, 'utf8')) as LedgerState;
    return new Ledger(raw.seedCents, raw.entries ?? []);
  }

  save(stateDir: string): void {
    const file = ledgerFile(stateDir);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(this.state, null, 2));
  }
}

function ledgerFile(stateDir: string): string {
  return join(stateDir, 'ledger.json');
}
