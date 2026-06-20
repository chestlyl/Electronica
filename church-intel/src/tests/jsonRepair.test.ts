/**
 * Regression: resilient JSON extraction must survive markdown fences, leading/
 * trailing prose, multiple objects, and TRUNCATED output (the row-2
 * "Unbalanced JSON in model output" failure). Repair runs before throwing.
 *
 *   (run via `npm run test`)
 */
import assert from 'node:assert';
import { parseJsonLoose, extractJsonCandidate, repairJson } from '../claude/client.js';
import { dossierSynthesisSchema } from '../claude/dossierPrompt.js';

// A truncated dossier-synthesis response: leading prose + an unclosed ```json
// fence + the JSON cut off mid-string inside the fields[] array.
const TRUNCATED = `Here is the dossier you requested:
\`\`\`json
{
  "identity_summary": "Cornerstone Church, Akron OH",
  "digital_summary": "Website + livestream + social",
  "staff_summary": "Jacob Young leads",
  "growth_summary": "Revitalizing",
  "lifecycle_summary": "Relaunch in 2020",
  "research_summary": "Reconstructed from snippets",
  "lifecycle_stage": "relaunch_revitalization",
  "growth_orientation_score": 55,
  "digital_maturity_score": 50,
  "change_readiness_score": 70,
  "staff_depth_score": 40,
  "church_app_status": "none_found",
  "app_provider": null,
  "lead_pastor": "Jacob Young",
  "denomination": "Non-denominational",
  "online_attendance_estimate": 120,
  "online_attendance_confidence": 60,
  "attendance_estimate": 300,
  "attendance_min": 150,
  "attendance_max": 500,
  "attendance_confidence": 65,
  "fields": [
    { "field_name": "lead_pastor", "value": "Jacob Young", "confidence": 65, "evidence": "staff page snippet`;

let failures = 0;
function check(label: string, fn: () => void) {
  try { fn(); console.log(`  ✓ ${label}`); } catch (e) { failures++; console.log(`  ✗ ${label}: ${(e as Error).message}`); }
}

function main() {
  console.log('json extraction resilience');

  check('plain object', () => assert.deepStrictEqual(parseJsonLoose('{"a":1}'), { a: 1 }));
  check('markdown fence', () => assert.deepStrictEqual(parseJsonLoose('```json\n{"a":1}\n```'), { a: 1 }));
  check('leading + trailing prose', () => assert.deepStrictEqual(parseJsonLoose('Sure! {"a":1} hope that helps'), { a: 1 }));
  check('multiple objects → first wins', () => assert.deepStrictEqual(parseJsonLoose('{"a":1}\n{"b":2}'), { a: 1 }));
  check('truncated object repaired (value-less key → null)', () => assert.deepStrictEqual(parseJsonLoose('{"a":1,"b":'), { a: 1, b: null }));
  check('truncated key dropped', () => assert.deepStrictEqual(parseJsonLoose('{"a":1,"b'), { a: 1 }));
  check('truncated string repaired', () => assert.deepStrictEqual(parseJsonLoose('{"a":"hel'), { a: 'hel' }));

  console.log('row-2-style truncated dossier synthesis');
  const candidate = extractJsonCandidate(TRUNCATED);
  check('candidate starts at first brace', () => assert.ok(candidate.trimStart().startsWith('{')));
  const repaired = repairJson(candidate);
  check('repaired candidate is valid JSON', () => JSON.parse(repaired));

  const parsed = parseJsonLoose(TRUNCATED);
  check('parseJsonLoose does NOT throw on truncated output', () => assert.ok(parsed && typeof parsed === 'object'));

  const dossier = dossierSynthesisSchema.parse(parsed) as any;
  check('schema validates the repaired dossier', () => {
    assert.strictEqual(dossier.lifecycle_stage, 'relaunch_revitalization');
    assert.strictEqual(dossier.attendance_estimate, 300);
    assert.strictEqual(dossier.attendance_confidence, 65);
    assert.ok(Array.isArray(dossier.fields) && dossier.fields.length >= 1);
    assert.strictEqual(dossier.fields[0].field_name, 'lead_pastor');
  });

  // Demonstrate the pipeline values for the report.
  console.log('\n--- demonstration (truncated row-2-style payload) ---');
  console.log('RAW (last 60 chars):       …' + JSON.stringify(TRUNCATED.slice(-60)));
  console.log('REPAIRED (last 60 chars):  …' + JSON.stringify(repaired.slice(-60)));
  console.log('PARSED.fields[0]:          ' + JSON.stringify(dossier.fields[0]));

  console.log(failures ? `\nFAILED (${failures})` : '\nALL PASSED');
  process.exit(failures ? 1 : 0);
}

main();
