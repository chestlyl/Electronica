/**
 * Outreach batch generator — eligibility, ranking, copy, and dedupe.
 *   (run via `npm run test`)
 */
import assert from "node:assert";
import { buildOutreachBatch, isEligible, defaultCopyTemplate, type OutreachEligibleChurch } from "../research/outreachBatch.js";

let failures = 0;
function check(label: string, fn: () => void) {
  try { fn(); console.log(`  ✓ ${label}`); } catch (e) { failures++; console.log(`  ✗ ${label}: ${(e as Error).message}`); }
}

function church(p: Partial<OutreachEligibleChurch> & { id: string }): OutreachEligibleChurch {
  // Respect explicit null (uses `in`, not `??`, so null overrides the default).
  const g = <K extends keyof OutreachEligibleChurch>(k: K, dflt: OutreachEligibleChurch[K]): OutreachEligibleChurch[K] =>
    (k in p ? (p[k] as OutreachEligibleChurch[K]) : dflt);
  return {
    id: p.id,
    name: g("name", `Church ${p.id}`),
    city: g("city", "Nashville"),
    state: g("state", "TN"),
    email_verified: g("email_verified", "info@example.org"),
    lead_pastor: g("lead_pastor", "Pat Rivers"),
    mmc_fit_score: g("mmc_fit_score", 75),
    active_status: g("active_status", "Verified Active"),
  };
}

const DATE = "2026-07-04";

function main() {
  console.log("outreach-batch (Today's 300)");

  check("eligible requires verified email + fit≥min + active status", () => {
    const opts = { batchDate: DATE };
    assert.strictEqual(isEligible(church({ id: "a" }), opts), true);
    assert.strictEqual(isEligible(church({ id: "b", email_verified: null }), opts), false);
    assert.strictEqual(isEligible(church({ id: "c", mmc_fit_score: 40 }), opts), false);
    assert.strictEqual(isEligible(church({ id: "d", active_status: "Closed" }), opts), false);
  });

  check("excludeChurchIds removes churches already in today's batch", () => {
    const opts = { batchDate: DATE, excludeChurchIds: new Set(["a"]) };
    assert.strictEqual(isEligible(church({ id: "a" }), opts), false);
    assert.strictEqual(isEligible(church({ id: "z" }), opts), true);
  });

  check("batch is ranked by MMC fit desc and capped at limit", () => {
    const churches = [
      church({ id: "low", mmc_fit_score: 62 }),
      church({ id: "high", mmc_fit_score: 95 }),
      church({ id: "mid", mmc_fit_score: 80 }),
      church({ id: "excluded", mmc_fit_score: 50 }), // below min → dropped
    ];
    const batch = buildOutreachBatch(churches, { batchDate: DATE, limit: 2 });
    assert.strictEqual(batch.length, 2);
    assert.strictEqual(batch[0].church_id, "high");
    assert.strictEqual(batch[0].rank, 1);
    assert.strictEqual(batch[1].church_id, "mid");
    assert.strictEqual(batch[1].rank, 2);
  });

  check("draft carries contact + draft/not-synced status + batch date", () => {
    const [d] = buildOutreachBatch([church({ id: "a", lead_pastor: "Hollis Thomas", email_verified: "biz@x.org" })], { batchDate: DATE });
    assert.strictEqual(d.contact_name, "Hollis Thomas");
    assert.strictEqual(d.contact_role, "Lead Pastor");
    assert.strictEqual(d.contact_email, "biz@x.org");
    assert.strictEqual(d.approval_status, "pending");
    assert.strictEqual(d.hubspot_sync_status, "not_synced");
    assert.strictEqual(d.batch_date, DATE);
  });

  check("no lead pastor → contact_role General", () => {
    const [d] = buildOutreachBatch([church({ id: "a", lead_pastor: null })], { batchDate: DATE });
    assert.strictEqual(d.contact_role, "General");
    assert.strictEqual(d.contact_name, null);
  });

  check("default copy names the church and greets the pastor by first name", () => {
    const copy = defaultCopyTemplate(church({ id: "a", name: "One City Church", lead_pastor: "Hollis Thomas" }));
    assert.ok(copy.subject.includes("One City Church"));
    assert.ok(copy.body.startsWith("Hi Hollis,"));
    assert.ok(!/undefined|null/.test(copy.body));
  });

  check("injected copy generator overrides the template", () => {
    const [d] = buildOutreachBatch([church({ id: "a" })], {
      batchDate: DATE,
      generateCopy: () => ({ subject: "custom", body: "custom body" }),
    });
    assert.strictEqual(d.subject, "custom");
  });

  console.log(failures ? `\nFAILED (${failures})` : "\nALL PASSED");
  process.exit(failures ? 1 : 0);
}

main();
