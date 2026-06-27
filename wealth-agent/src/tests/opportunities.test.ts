/**
 * Opportunity scoring: low EV-confidence can never rank highly, unaffordable
 * ideas sort to the bottom, and the vetted catalog scores sensibly.
 *
 *   (run via `npm run test`)
 */
import assert from 'node:assert';
import { scoreOpportunity, rankOpportunities } from '../opportunities.js';
import { vettedCatalog } from '../scout.js';
import { toCents } from '../money.js';
import type { Opportunity } from '../types.js';

let failures = 0;
function check(label: string, fn: () => void) {
  try { fn(); console.log(`  ✓ ${label}`); } catch (e) { failures++; console.log(`  ✗ ${label}: ${(e as Error).message}`); }
}

const base: Opportunity = {
  id: 'x', title: 'x', summary: '', category: 'c',
  startupCostCents: toCents(10), expectedRevenue30dCents: toCents(60),
  hoursToFirstDollar: 8, evConfidence: 80, evidence: [], risks: [], integrityBasis: '',
};

function main() {
  console.log('opportunity scoring');

  check('low EV-confidence caps the score hard', () => {
    const high = scoreOpportunity({ ...base, evConfidence: 90 }, { availableCents: toCents(100) });
    const low = scoreOpportunity({ ...base, evConfidence: 20 }, { availableCents: toCents(100) });
    assert.ok(low < high, `expected low(${low}) < high(${high})`);
    assert.ok(low <= 25, `low-confidence score should stay small, got ${low}`);
  });

  check('unaffordable opportunity is floored near zero', () => {
    const s = scoreOpportunity(
      { ...base, startupCostCents: toCents(500), evConfidence: 95 },
      { availableCents: toCents(100) },
    );
    assert.ok(s <= 10, `unaffordable should be <=10, got ${s}`);
  });

  check('cheaper + higher-confidence ranks above pricier + lower-confidence', () => {
    const a: Opportunity = { ...base, id: 'a', startupCostCents: toCents(5), evConfidence: 80 };
    const b: Opportunity = { ...base, id: 'b', startupCostCents: toCents(90), evConfidence: 45 };
    const ranked = rankOpportunities([b, a], { availableCents: toCents(100) });
    assert.strictEqual(ranked[0].id, 'a');
  });

  check('vetted catalog: research-as-a-service is the top pick at $100', () => {
    const ranked = rankOpportunities(vettedCatalog(), { availableCents: toCents(100) });
    assert.strictEqual(ranked[0].id, 'research-as-a-service');
  });

  check('every catalog entry has honest risks + an integrity basis', () => {
    for (const o of vettedCatalog()) {
      assert.ok(o.risks.length > 0, `${o.id} must list risks`);
      assert.ok(o.integrityBasis.length > 10, `${o.id} must state its integrity basis`);
    }
  });

  console.log(failures ? `\nFAILED (${failures})` : '\nALL PASSED');
  process.exit(failures ? 1 : 0);
}

main();
