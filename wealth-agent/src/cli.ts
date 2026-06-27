#!/usr/bin/env node
/**
 * wealth-agent CLI.
 *
 *   npm run cli -- <command>
 *
 * The agent only ever PROPOSES. Approving, rejecting, and marking entries
 * executed are human actions — they map to explicit subcommands a person runs.
 */
import { Command } from 'commander';
import { config } from './config.js';
import { Ledger } from './ledger.js';
import { vettedCatalog, scoutWithClaude } from './scout.js';
import { rankOpportunities } from './opportunities.js';
import { assessIntegrity, integrityRules } from './integrity.js';
import { MoltbookClient } from './moltbook.js';
import { fmt, toCents } from './money.js';
import type { AgentAction } from './types.js';

const program = new Command();
program
  .name('wealth-agent')
  .description('Integrity-first agent that grows a $100 seed via honest research & commerce.')
  .version('0.1.0');

function loadLedger(): Ledger {
  return Ledger.load(config.stateDir, config.seedCents);
}

program
  .command('status')
  .description('Show the money boundary, seed, and ledger balance.')
  .action(() => {
    const ledger = loadLedger();
    const b = ledger.balance();
    console.log(`Money mode:        ${config.moneyMode}  (agent never moves real money)`);
    console.log(`Seed capital:      ${fmt(b.seedCents)}`);
    console.log(`Executed balance:  ${fmt(b.executedBalanceCents)}`);
    console.log(`Available:         ${fmt(b.committedAvailableCents)}  (after approved spends)`);
    console.log(`Proposed exposure: ${fmt(b.proposedExpenseCents)}`);
    console.log(`Income earned:     ${fmt(b.executedIncomeCents)}`);
  });

program
  .command('ledger')
  .description('List ledger entries.')
  .option('--status <status>', 'filter: proposed|approved|rejected|executed')
  .action((opts) => {
    const ledger = loadLedger();
    const rows = ledger.entries().filter((e) => !opts.status || e.status === opts.status);
    if (rows.length === 0) return console.log('(no entries)');
    for (const e of rows) {
      const sign = e.direction === 'expense' ? '-' : '+';
      console.log(
        `${e.id.slice(0, 8)}  ${e.status.padEnd(9)} ${sign}${fmt(e.amountCents)}  ` +
          `${e.category.padEnd(12)} ${e.description}`,
      );
    }
  });

program
  .command('scout')
  .description('Scout + rank honest, low-capital opportunities against current capital.')
  .action(async () => {
    const ledger = loadLedger();
    const available = ledger.balance().committedAvailableCents;
    const opps = await scoutWithClaude(config.anthropicApiKey, config.claudeModel).catch(
      () => vettedCatalog(),
    );
    const ranked = rankOpportunities(opps, { availableCents: available });
    for (const o of ranked) {
      console.log(`[${String(o.score).padStart(5)}] ${o.title}`);
      console.log(`        ${o.summary}`);
      console.log(
        `        start ${fmt(o.startupCostCents)} · ~${fmt(o.expectedRevenue30dCents)}/30d · ` +
          `${o.hoursToFirstDollar}h to $1 · EV-confidence ${o.evConfidence}`,
      );
      console.log(`        risks: ${o.risks.join('; ')}`);
      console.log(`        integrity: ${o.integrityBasis}\n`);
    }
  });

program
  .command('propose')
  .description('Agent proposes a ledger entry (does NOT spend).')
  .requiredOption('--amount <usd>', 'amount in USD, e.g. 5.00')
  .requiredOption('--desc <text>', 'short description')
  .option('--direction <dir>', 'expense|income', 'expense')
  .option('--category <cat>', 'category tag', 'startup')
  .option('--rationale <text>', 'why this advances the plan', '')
  .option('--opp <id>', 'related opportunity id')
  .action((opts) => {
    const ledger = loadLedger();
    const entry = ledger.propose({
      direction: opts.direction === 'income' ? 'income' : 'expense',
      amountCents: toCents(opts.amount),
      description: opts.desc,
      rationale: opts.rationale,
      category: opts.category,
      opportunityId: opts.opp,
    });
    ledger.save(config.stateDir);
    console.log(`Proposed ${entry.id.slice(0, 8)}: ${fmt(entry.amountCents)} — ${entry.description}`);
    console.log('Run `wealth-agent approve --id <id>` to approve (a human decision).');
  });

for (const verb of ['approve', 'reject', 'execute'] as const) {
  program
    .command(verb)
    .description(
      verb === 'execute'
        ? 'HUMAN action: record that YOU completed the real-world transaction.'
        : `HUMAN action: ${verb} a proposed entry.`,
    )
    .requiredOption('--id <id>', 'entry id (first 8 chars ok)')
    .option('--note <text>', 'optional note')
    .action((opts) => {
      const ledger = loadLedger();
      const full = ledger.entries().find((e) => e.id.startsWith(opts.id));
      if (!full) return console.error(`No entry starting with ${opts.id}`);
      const entry = ledger[verb](full.id, opts.note);
      ledger.save(config.stateDir);
      console.log(`${verb}d ${entry.id.slice(0, 8)} → ${entry.status}`);
    });
}

program
  .command('integrity-policy')
  .description('Print the integrity rules every action is checked against.')
  .action(() => {
    console.log('Every outward action is checked against these rules (block = hard stop):\n');
    for (const r of integrityRules()) console.log(`  • ${r.id.padEnd(26)} ${r.description}`);
  });

program
  .command('check')
  .description('Run a single action through the integrity engine (no side effects).')
  .requiredOption('--kind <kind>', 'post|comment|reply|upvote|downvote|spend|outreach')
  .option('--content <text>', 'the content to check')
  .option('--channel <ch>', 'e.g. m/sideprojects')
  .option('--intent <text>', 'declared intent')
  .action((opts) => {
    const action: AgentAction = {
      kind: opts.kind,
      content: opts.content,
      channel: opts.channel,
      intent: opts.intent,
    };
    const verdict = assessIntegrity(action);
    console.log(`Severity: ${verdict.severity.toUpperCase()}  allowed: ${verdict.allowed}`);
    console.log(verdict.rationale);
  });

program
  .command('moltbook-draft')
  .description('Draft a Moltbook post through the integrity gate (dry-run; never posts).')
  .requiredOption('--content <text>', 'post body')
  .option('--channel <ch>', 'submolt, e.g. m/sideprojects', 'm/sideprojects')
  .action(async (opts) => {
    const client = new MoltbookClient({ ...config.moltbook, dryRun: true });
    const result = await client.act({ kind: 'post', channel: opts.channel, content: opts.content });
    console.log(`Verdict:   ${result.verdict.severity.toUpperCase()} (allowed: ${result.verdict.allowed})`);
    console.log(`Delivered: ${result.delivered}  (${result.note})`);
    console.log(`Final content:\n${result.attempted.content}`);
  });

program.parseAsync(process.argv).catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
