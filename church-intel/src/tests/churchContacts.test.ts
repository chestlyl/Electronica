/**
 * church_contacts — flatten all discovered emails into deduped rows.
 *   (run via `npm run test`)
 */
import assert from "node:assert";
import { flattenContactChannels, type ChurchContactRow } from "../research/churchContacts.js";
import type { ContactIntelligence, ContactChannel } from "../research/contactIntel.js";

let failures = 0;
function check(label: string, fn: () => void) {
  try { fn(); console.log(`  ✓ ${label}`); } catch (e) { failures++; console.log(`  ✗ ${label}: ${(e as Error).message}`); }
}

const ch = (value: string, label: string | null, confidence: number): ContactChannel => ({
  value, label, source_url: "https://x.org/staff", access_level: "live_official_site", confidence,
});

function ci(p: Partial<ContactIntelligence>): ContactIntelligence {
  return {
    primary_email: null, primary_phone: null,
    church_emails: [], role_emails: [], person_emails: [], unassigned_emails: [],
    departments: [], contact_forms: [], campus_contacts: [], phones: [],
    ...p,
  };
}
const byEmail = (rows: ChurchContactRow[]) => new Map(rows.map((r) => [r.email, r]));

function main() {
  console.log("church_contacts (flatten + dedupe)");

  check("collects every bucket with its category", () => {
    const rows = flattenContactChannels(ci({
      church_emails: [ch("info@x.org", "Main office", 80)],
      role_emails: [ch("pastor@x.org", "Lead Pastor", 75)],
      person_emails: [ch("hollis@x.org", "Hollis Thomas", 90)],
      unassigned_emails: [ch("random@x.org", null, 40)],
    }));
    assert.strictEqual(rows.length, 4);
    const m = byEmail(rows);
    assert.strictEqual(m.get("info@x.org")?.category, "church");
    assert.strictEqual(m.get("pastor@x.org")?.category, "role");
    assert.strictEqual(m.get("pastor@x.org")?.role, "Lead Pastor");
    assert.strictEqual(m.get("hollis@x.org")?.category, "person");
  });

  check("lowercases emails and dedupes the same address across buckets", () => {
    const rows = flattenContactChannels(ci({
      church_emails: [ch("Info@X.org", "office", 60)],
      unassigned_emails: [ch("info@x.org", null, 50)],
    }));
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].email, "info@x.org");
  });

  check("higher confidence wins on the same email", () => {
    const rows = flattenContactChannels(ci({
      church_emails: [ch("info@x.org", "office", 55)],
      person_emails: [ch("info@x.org", "Pat", 95)],
    }));
    assert.strictEqual(byEmail(rows).get("info@x.org")?.confidence, 95);
    assert.strictEqual(byEmail(rows).get("info@x.org")?.category, "person");
  });

  check("more specific category wins on EQUAL confidence (person > church)", () => {
    const rows = flattenContactChannels(ci({
      church_emails: [ch("info@x.org", "office", 70)],
      person_emails: [ch("info@x.org", "Pat Rivers", 70)],
    }));
    assert.strictEqual(byEmail(rows).get("info@x.org")?.category, "person");
  });

  check("drops non-email junk", () => {
    const rows = flattenContactChannels(ci({ unassigned_emails: [ch("not-an-email", null, 30)] }));
    assert.strictEqual(rows.length, 0);
  });

  console.log(failures ? `\nFAILED (${failures})` : "\nALL PASSED");
  process.exit(failures ? 1 : 0);
}

main();
