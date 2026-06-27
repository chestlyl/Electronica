/**
 * Offline end-to-end demo — no credentials, no network, nothing posted.
 *
 *   npm run demo
 *
 * It seeds a $100 virtual ledger, scouts + ranks honest opportunities, proposes
 * a concrete first-move spend, and runs two Moltbook drafts through the integrity
 * engine: one honest post (allowed, dry-run) and one pump-style post (blocked).
 */
import { Ledger } from './ledger.js';
import { vettedCatalog } from './scout.js';
import { rankOpportunities } from './opportunities.js';
import { MoltbookClient } from './moltbook.js';
import { fmt, toCents } from './money.js';
import type { AgentAction } from './types.js';

async function main() {
  const SEED = toCents(100);
  console.log('=== wealth-agent demo (offline, advise-only, nothing posted) ===\n');

  // 1) Virtual ledger seeded with $100. The agent never touches real money.
  const ledger = new Ledger(SEED);
  console.log(`Seed capital: ${fmt(SEED)}  (virtual ledger — your real bank is never touched)\n`);

  // 2) Scout + rank opportunities against available capital.
  const bal0 = ledger.balance();
  const ranked = rankOpportunities(vettedCatalog(), { availableCents: bal0.committedAvailableCents });
  console.log('Ranked honest opportunities:');
  for (const o of ranked) {
    console.log(
      `  [${String(o.score).padStart(5)}] ${o.title}\n` +
        `          start ${fmt(o.startupCostCents)} · ~${fmt(o.expectedRevenue30dCents)}/30d · ` +
        `${o.hoursToFirstDollar}h · EV-conf ${o.evConfidence}\n` +
        `          integrity: ${o.integrityBasis}`,
    );
  }
  const top = ranked[0];
  console.log(`\nTop pick: ${top.title}\n`);

  // 3) Propose a concrete first spend toward the top opportunity. PROPOSED only —
  //    a human must approve, and only the human ever executes real money.
  const proposal = ledger.propose({
    direction: 'expense',
    amountCents: top.startupCostCents > 0 ? top.startupCostCents : toCents(5),
    description: 'Initial costs for ' + top.title,
    rationale:
      'Stand up a minimal landing page + cover first API costs to deliver one paid research ' +
      'dossier. Smallest spend that unlocks a first sale.',
    category: 'startup',
    opportunityId: top.id,
  });
  console.log(
    `Proposed ledger entry (NOT executed): ${fmt(proposal.amountCents)} — ${proposal.description}`,
  );
  console.log('  status: proposed → awaiting YOUR approval, then YOU make the real payment.\n');

  // Show the balance picture.
  const bal = ledger.balance();
  console.log(
    `Balance — executed: ${fmt(bal.executedBalanceCents)} · ` +
      `available after approvals: ${fmt(bal.committedAvailableCents)} · ` +
      `proposed exposure: ${fmt(bal.proposedExpenseCents)}\n`,
  );

  // 4) Moltbook: two drafts through the integrity gate.
  const moltbook = new MoltbookClient({
    dryRun: true,
    handle: '',
    disclosure: 'Posted by an AI agent on behalf of its human operator.',
    minSecondsBetweenActions: 45,
  });

  const honest: AgentAction = {
    kind: 'post',
    channel: 'm/sideprojects',
    content:
      'Shared a small write-up on verifying org websites with evidence + confidence scoring. ' +
      'Happy to run a free sample dossier on one org if useful — reply with a name.',
    intent: 'share genuinely useful research, offer real help',
  };
  const pump: AgentAction = {
    kind: 'post',
    channel: 'm/cryptocurrency',
    content: 'Buy $MOLT now before it goes to the moon — guaranteed returns, can\'t lose!',
    intent: 'drive token price',
  };

  console.log('Moltbook draft #1 (honest, useful):');
  const r1 = await moltbook.act(honest, 0);
  console.log(`  verdict: ${r1.verdict.severity.toUpperCase()} · delivered: ${r1.delivered} · ${r1.note}`);
  console.log(`  content: ${JSON.stringify(r1.attempted.content)}\n`);

  console.log('Moltbook draft #2 (pump/hype):');
  const r2 = await moltbook.act(pump, 60_000);
  console.log(`  verdict: ${r2.verdict.severity.toUpperCase()} · delivered: ${r2.delivered}`);
  console.log(`  rationale: ${r2.verdict.rationale}\n`);

  console.log('=== demo complete — no money moved, nothing posted ===');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
