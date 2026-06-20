/**
 * Regression: enrich-church must not fail Zod/schema validation when Claude
 * returns null scores, string/tier confidences, or malformed fields[].
 * Reproduces the row-2 enrich-church failure shape.
 *
 *   npm run test
 */
import assert from 'node:assert';
import { rmSync } from 'node:fs';
import { dossierSynthesisSchema } from '../claude/dossierPrompt.js';
import { JsonStore } from '../db/jsonStore.js';
import { MockLlmProvider, type ExtractOptions } from '../claude/client.js';
import { ResilientResearch } from '../research/resilient.js';
import { enrichChurch, type AgentContext } from '../agents/index.js';
import { installMockFetch } from '../researchDemo.js';

const DB = 'data/output/regression_db.json';

// The exact malformed shape from the real row-2 failure.
const MALFORMED = {
  identity_summary: 'Cornerstone Church', digital_summary: '', staff_summary: '',
  growth_summary: '', lifecycle_summary: '', research_summary: '',
  lifecycle_stage: 'established',
  growth_orientation_score: null,
  digital_maturity_score: null,
  change_readiness_score: null,
  staff_depth_score: null,
  church_app_status: 'none_found', app_provider: null,
  lead_pastor: 'Jacob Young', denomination: 'Non-denominational',
  online_attendance_estimate: '120',
  online_attendance_confidence: 'High',
  attendance_estimate: '300', attendance_min: '150', attendance_max: '500',
  attendance_confidence: 'Medium',
  fields: [
    { value: 'Jacob Young', confidence: '85', evidence: 'staff page' }, // no field_name, string confidence
    { field_name: undefined, value: null, confidence: 'high' },          // dropped (empty)
    { field_name: 'lifecycle_stage', value: 'established', confidence: 80 },
  ],
  known: ['Founded ~1980'], uncertain: ['Attendance'],
};

const MULTIPLICATION = {
  church_planting_activity: 10, disciple_making: 50, leadership_development: 40,
  residency_internship: 5, mission_sending: 45, kingdom_collaboration: 35,
  innovation: 40, multiplication_orientation: 30, digital_reach: 45,
  explanation: 'mock', evidence: [],
};

function responder(opts: ExtractOptions<unknown>): unknown {
  return opts.system.includes('building a DOSSIER') ? MALFORMED : MULTIPLICATION;
}

let failures = 0;
function check(label: string, fn: () => void) {
  try { fn(); console.log(`  ✓ ${label}`); }
  catch (e) { failures++; console.log(`  ✗ ${label}: ${(e as Error).message}`); }
}

async function main() {
  console.log('1) schema absorbs malformed Claude output');
  const parsed = dossierSynthesisSchema.parse(MALFORMED) as any;
  check('null scores stay null (not rejected)', () => assert.strictEqual(parsed.growth_orientation_score, null));
  check('tier "High" → 80 (number)', () => { assert.strictEqual(typeof parsed.online_attendance_confidence, 'number'); assert.strictEqual(parsed.online_attendance_confidence, 80); });
  check('tier "Medium" → 55', () => assert.strictEqual(parsed.attendance_confidence, 55));
  check('string "300" → 300 (number)', () => assert.strictEqual(parsed.attendance_estimate, 300));
  check('every field has string field_name', () => parsed.fields.forEach((f: any) => assert.strictEqual(typeof f.field_name, 'string')));
  check('every field has numeric confidence', () => parsed.fields.forEach((f: any) => assert.strictEqual(typeof f.confidence, 'number')));
  check('empty field entry dropped', () => assert.strictEqual(parsed.fields.length, 2));

  console.log('2) full enrich-church path does not throw on malformed output');
  rmSync(DB, { force: true });
  installMockFetch();
  const store = new JsonStore(DB);
  const { id } = await store.upsertImportRecord({
    original_row_id: 'reg-cornerstone', name: 'Cornerstone Church', address: null,
    city: 'Akron', state: 'OH', zip: null, country: 'United States', phone_original: null,
    email_original: null, website_original: 'https://www.cornerstonechurch.info',
    language: null, network_affiliation: null, notes: null,
  });
  const ctx: AgentContext = { store, llm: new MockLlmProvider(responder), research: new ResilientResearch() };

  let threw: Error | null = null;
  try { await enrichChurch(ctx, id); } catch (e) { threw = e as Error; }
  check('enrichChurch completed without throwing', () => assert.strictEqual(threw, null, threw?.message));

  const c = (await store.getChurch(id)) as any;
  check('null score persisted as null (not NaN/string)', () => assert.strictEqual(c.change_readiness_score, null));
  check('research_confidence is a number', () => assert.strictEqual(typeof c.research_confidence, 'number'));
  check('online_attendance_confidence is a number', () => assert.strictEqual(typeof c.online_attendance_confidence, 'number'));
  check('no numeric column holds a string', () => {
    for (const k of ['research_confidence', 'online_attendance_estimate', 'attendance_confidence', 'influence_score', 'mmc_fit_score']) {
      const v = c[k];
      assert.ok(v == null || (typeof v === 'number' && Number.isFinite(v)), `${k}=${v}`);
    }
  });
  const reviews = await store.listReviewQueue('pending');
  check('review items carry numeric confidence', () => reviews.forEach((r) => assert.ok(r.confidence_score == null || typeof r.confidence_score === 'number')));

  console.log(failures ? `\nFAILED (${failures})` : '\nALL PASSED');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
