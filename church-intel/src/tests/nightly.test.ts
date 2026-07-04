/**
 * Nightly orchestrator — sequencing, error isolation, dry-run propagation.
 *   (run via `npm run test`)
 */
import assert from "node:assert";
import { runNightly, renderNightlySummary, type NightlyStep } from "../research/nightly.js";

let failures = 0;
async function check(label: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log(`  ✓ ${label}`); } catch (e) { failures++; console.log(`  ✗ ${label}: ${(e as Error).message}`); }
}

const DATE = "2026-07-04T03:00:00Z";

async function main() {
  console.log("nightly (orchestrator)");

  await check("runs all steps in order and reports ok", async () => {
    const order: string[] = [];
    const steps: NightlyStep[] = [
      { name: "discover", run: async () => { order.push("discover"); return { status: "ok", detail: "5 net-new" }; } },
      { name: "batch", run: async () => { order.push("batch"); return { status: "ok", detail: "300 drafted" }; } },
      { name: "hubspot", run: async () => { order.push("hubspot"); return { status: "skipped", detail: "on hold" }; } },
    ];
    const s = await runNightly(steps, { startedAt: DATE });
    assert.deepStrictEqual(order, ["discover", "batch", "hubspot"]);
    assert.strictEqual(s.ok, true);
    assert.strictEqual(s.steps.length, 3);
  });

  await check("a thrown step is isolated — later steps still run, run marked not-ok", async () => {
    const ran: string[] = [];
    const steps: NightlyStep[] = [
      { name: "discover", run: async () => { throw new Error("places down"); } },
      { name: "batch", run: async () => { ran.push("batch"); return { status: "ok", detail: "300 drafted" }; } },
    ];
    const s = await runNightly(steps, { startedAt: DATE });
    assert.ok(ran.includes("batch"), "batch should still run after discover failed");
    assert.strictEqual(s.ok, false);
    assert.strictEqual(s.steps[0].result.status, "failed");
    assert.ok(s.steps[0].result.detail.includes("places down"));
  });

  await check("dry-run flag is propagated into each step", async () => {
    let seen = false;
    const steps: NightlyStep[] = [{ name: "batch", run: async ({ dryRun }) => { seen = dryRun; return { status: "ok", detail: "planned" }; } }];
    const s = await runNightly(steps, { startedAt: DATE, dryRun: true });
    assert.strictEqual(seen, true);
    assert.strictEqual(s.dryRun, true);
  });

  await check("summary renders per-step marks", async () => {
    const steps: NightlyStep[] = [
      { name: "batch", run: async () => ({ status: "ok", detail: "300 drafted" }) },
      { name: "hubspot", run: async () => ({ status: "skipped", detail: "on hold" }) },
    ];
    const s = await runNightly(steps, { startedAt: DATE });
    const text = renderNightlySummary(s);
    assert.ok(text.includes("✓ batch"));
    assert.ok(text.includes("– hubspot"));
  });

  console.log(failures ? `\nFAILED (${failures})` : "\nALL PASSED");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
