/**
 * Coverage-Aware Scoring Gate (Stage 3). The gate must change CLASSIFICATION only,
 * never the score: a "miss" for an un-investigated category becomes
 * `not_investigated` (confidence-only); for an investigated category it stays a
 * verified-absent `negative_factor`. Score VALUES are identical regardless —
 * honoring "do not change score formulas."
 *
 *   (run via `npm run test`)
 */
import assert from 'node:assert';
import { buildCornerstoneOffline } from '../researchDemo.js';
import { scoreStrategic } from '../research/strategicScoring.js';
import { DIMENSIONS } from '../research/strategicSignals.js';

let failures = 0;
function check(label: string, fn: () => void) {
  try { fn(); console.log(`  ✓ ${label}`); } catch (e) { failures++; console.log(`  ✗ ${label}: ${(e as Error).message}`); }
}

async function main() {
  console.log('Coverage-Aware Scoring Gate (Stage 3)');

  const { build } = await buildCornerstoneOffline();
  const base = { interpretation: build.interpretation, normalized: build.normalized, coverage: build.coverage, accessLevel: build.accessLevel };

  const legacy = scoreStrategic({ ...base });                                  // no set → all investigated (back-compat)
  const noneInvestigated = scoreStrategic({ ...base, investigatedSet: new Set<string>() });
  const allInvestigated = scoreStrategic({ ...base, investigatedSet: new Set(['technology', 'giving', 'app/mobile', 'sermons/media', 'groups', 'jobs/careers', 'ministries']) });

  // 1) THE CONSTRAINT: the score value is identical regardless of the gate.
  check('score VALUE unchanged by the coverage gate (all dimensions)', () => {
    for (const d of DIMENSIONS) {
      assert.strictEqual(noneInvestigated[d].score, legacy[d].score, `${d} score moved (none)`);
      assert.strictEqual(allInvestigated[d].score, legacy[d].score, `${d} score moved (all)`);
    }
  });
  check('confidence VALUE unchanged by the gate (formula untouched)', () => {
    for (const d of DIMENSIONS) assert.strictEqual(noneInvestigated[d].confidence, legacy[d].confidence, `${d} confidence moved`);
  });

  // 2) Reclassification: nothing investigated → coverage-gated misses move out of
  //    negative_factors into not_investigated.
  const dmNone = noneInvestigated.digital_maturity;
  const dmAll = allInvestigated.digital_maturity;
  check('digital_maturity has coverage-gated misses (ChMS/giving/app...)', () => {
    assert.ok((dmNone.negative_factors.length + dmNone.not_investigated.length) > 0);
  });
  check('NOTHING investigated → those gaps are not_investigated, NOT negative factors', () => {
    assert.ok(dmNone.not_investigated.length > 0, 'expected not_investigated entries');
    assert.ok(dmNone.not_investigated.some((f) => /giving|ChMS|app/i.test(f.label)));
    assert.ok(!dmNone.negative_factors.some((f) => /no giving platform|no ChMS platform|no mobile app/i.test(f.label)));
  });
  check('ALL investigated → same gaps ARE verified-absent negative factors', () => {
    assert.ok(dmAll.negative_factors.some((f) => /no giving platform|no ChMS platform/i.test(f.label)));
    assert.ok(!dmAll.not_investigated.some((f) => /giving|ChMS/i.test(f.label)));
  });
  check('every factor carries an `investigated` flag', () => {
    for (const f of [...dmNone.negative_factors, ...dmNone.not_investigated, ...dmNone.positive_factors]) assert.ok(typeof f.investigated === 'boolean');
    assert.ok(dmNone.not_investigated.every((f) => f.investigated === false));
    assert.ok(dmAll.negative_factors.every((f) => f.investigated === true));
  });
  check('contactability gaps (office email/phone) are NOT coverage-gated (always investigated)', () => {
    // contact page is a required category → its misses stay verified-absent.
    const c = noneInvestigated.contactability;
    assert.ok(c.not_investigated.length === 0 || c.not_investigated.every((f) => !/email|phone/i.test(f.label)));
  });

  console.log(failures ? `\nFAILED (${failures})` : '\nALL PASSED');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
