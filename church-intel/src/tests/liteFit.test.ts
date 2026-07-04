/**
 * Lite enrichment — deterministic fit proxy + synthesis stub.
 *   (run via `npm run test`)
 */
import assert from "node:assert";
import { computeLiteFit, liteSynthesis } from "../research/liteFit.js";

let failures = 0;
function check(label: string, fn: () => void) {
  try { fn(); console.log(`  ✓ ${label}`); } catch (e) { failures++; console.log(`  ✗ ${label}: ${(e as Error).message}`); }
}

function main() {
  console.log("lite enrichment (fit proxy + synthesis stub)");

  check("closed/merged church → 0 regardless of size", () => {
    assert.strictEqual(computeLiteFit({ attendance: 5000, hasEmail: true, staffCount: 20, techCount: 5, active: false }), 0);
  });

  check("large + contactable + tech + staff → near 100", () => {
    const f = computeLiteFit({ attendance: 3000, hasEmail: true, staffCount: 15, techCount: 6, active: true });
    assert.strictEqual(f, 100); // 45 + 30 + 15 + 10
  });

  check("no email caps out contactability (−30)", () => {
    const withEmail = computeLiteFit({ attendance: 500, hasEmail: true, staffCount: 3, techCount: 2, active: true });
    const without = computeLiteFit({ attendance: 500, hasEmail: false, staffCount: 3, techCount: 2, active: true });
    assert.strictEqual(withEmail - without, 30);
  });

  check("larger attendance scores higher (monotonic bands)", () => {
    const base = { hasEmail: true, staffCount: 2, techCount: 2, active: true };
    const small = computeLiteFit({ ...base, attendance: 120 });
    const mid = computeLiteFit({ ...base, attendance: 600 });
    const big = computeLiteFit({ ...base, attendance: 2500 });
    assert.ok(small < mid && mid < big, `${small} < ${mid} < ${big}`);
  });

  check("null attendance / null staff handled (no NaN)", () => {
    const f = computeLiteFit({ attendance: null, hasEmail: true, staffCount: null, techCount: 0, active: true });
    assert.ok(Number.isFinite(f) && f === 30); // only the email points
  });

  check("score always within 0..100", () => {
    const f = computeLiteFit({ attendance: 999999, hasEmail: true, staffCount: 999, techCount: 999, active: true });
    assert.ok(f >= 0 && f <= 100);
  });

  check("liteSynthesis is a valid zero-cost stub (nulls + neutral enums)", () => {
    const s = liteSynthesis();
    assert.strictEqual(s.lifecycle_stage, "unknown");
    assert.strictEqual(s.church_app_status, "unknown");
    assert.strictEqual(s.attendance_estimate, null);
    assert.deepStrictEqual(s.fields, []);
  });

  console.log(failures ? `\nFAILED (${failures})` : "\nALL PASSED");
  process.exit(failures ? 1 : 0);
}

main();
