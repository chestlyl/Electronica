/**
 * Manual churches import/export — CSV round-trip + import normalization.
 *   (run via `npm run test`)
 */
import assert from "node:assert";
import { toCsv, parseCsv, parseChurchesImport, toChurchUpsert, makeRowId } from "../tools/churchesIO.js";

let failures = 0;
function check(label: string, fn: () => void) {
  try { fn(); console.log(`  ✓ ${label}`); } catch (e) { failures++; console.log(`  ✗ ${label}: ${(e as Error).message}`); }
}

function main() {
  console.log("churches import/export");

  check("CSV round-trips values, quoting commas/quotes/newlines", () => {
    const rows = [
      { original_row_id: "r1", name: "One City Church", city: "Nashville", state: "TN", notes: 'Uses "Squarespace", multi, line\nnote' },
    ];
    const csv = toCsv(rows, ["original_row_id", "name", "city", "state", "notes"]);
    const parsed = parseCsv(csv);
    assert.strictEqual(parsed.length, 1);
    assert.strictEqual(parsed[0].name, "One City Church");
    assert.strictEqual(parsed[0].notes, 'Uses "Squarespace", multi, line\nnote');
  });

  check("import from CSV coerces numbers + only keeps provided columns", () => {
    const csv = "name,state,attendance_estimate,mmc_fit_score\nGrace Church,OH,\"1,200\",78";
    const [row] = parseChurchesImport(csv, "x.csv");
    assert.strictEqual(row.name, "Grace Church");
    assert.strictEqual(row.attendance_estimate, 1200);
    assert.strictEqual(row.mmc_fit_score, 78);
    assert.ok(!("website_verified" in row), "unprovided columns must be omitted (never nulled)");
  });

  check("import from JSON array works", () => {
    const rows = parseChurchesImport('[{"name":"Redemption","state":"AZ","email_verified":"info@r.org"}]', "x.json");
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].email_verified, "info@r.org");
  });

  check("original_row_id synthesized from name+state when absent, stable", () => {
    const a = toChurchUpsert({ name: "One City Church", state: "TN" });
    const b = toChurchUpsert({ name: "One City Church", state: "TN" });
    assert.ok(a && a.original_row_id === b?.original_row_id);
    assert.strictEqual(a.original_row_id, makeRowId("One City Church", "TN"));
  });

  check("existing original_row_id is preserved (idempotent upsert key)", () => {
    const row = toChurchUpsert({ original_row_id: "row-1001", name: "Whatever", state: "TN" });
    assert.strictEqual(row?.original_row_id, "row-1001");
  });

  check("rows with no name and no id are dropped", () => {
    const rows = parseChurchesImport("name,state\n,OH\nReal Church,OH", "x.csv");
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].name, "Real Church");
  });

  console.log(failures ? `\nFAILED (${failures})` : "\nALL PASSED");
  process.exit(failures ? 1 : 0);
}

main();
