/**
 * Source-of-truth guard — report and enrich must echo INTERPRETATION exactly.
 *
 * Fails whenever a report value or an enrich value differs from the interpretation
 * conclusion for the same field. This prevents any future re-introduction of a
 * second producer (facts/synthesis) that could disagree with interpretation.
 *
 *   (run via `npm run test`)
 */
import assert from 'node:assert';
import { rmSync } from 'node:fs';
import { buildCornerstoneOffline } from '../researchDemo.js';
import { rowFromBuild, lifecycleDisplay, type CalibrationEntry } from '../research/calibrationSet.js';
import { renderCalibrationReport } from '../research/calibrationReport.js';
import { applyDossierToChurch } from '../agents/dossierApply.js';
import { JsonStore } from '../db/jsonStore.js';
import { MockLlmProvider } from '../claude/client.js';
import { ResilientResearch } from '../research/resilient.js';
import type { AgentContext } from '../agents/index.js';

const DB = 'data/output/sot_db.json';
let failures = 0;
function eq(label: string, a: unknown, b: unknown) {
  try { assert.deepStrictEqual(a, b); console.log(`  ✓ ${label}`); }
  catch { failures++; console.log(`  ✗ ${label}: report/enrich ${JSON.stringify(a)} ≠ interpretation ${JSON.stringify(b)}`); }
}

async function main() {
  console.log('Source-of-truth guard — report/enrich == interpretation');

  const { build } = await buildCornerstoneOffline();
  // Populate every owned conclusion with a concrete value so each field is
  // genuinely exercised (a stale producer would surface as a mismatch).
  const I = build.interpretation;
  I.lead_pastors = { value: ['Dan Zirkle', 'Jennifer Zirkle'], confidence: 90, evidence_ids: ['leader_1', 'leader_2'], reason: 'co-leads', access_level: 'live_official_site' };
  I.office_email = { value: 'info@ofhchurch.com', confidence: 80, evidence_ids: ['contact_email'], reason: '', access_level: 'live_official_site' };
  I.office_phone = { value: '(918) 279-1243', confidence: 75, evidence_ids: ['contact_phone'], reason: '', access_level: 'live_official_site' };
  I.staff_count = { value: 8, confidence: 70, evidence_ids: [], reason: '', access_level: 'live_official_site' };
  I.denomination = { value: 'Church of the Nazarene', confidence: 60, evidence_ids: [], reason: '', access_level: 'live_official_site' };
  I.attendance_estimate = { value: 250, confidence: 40, evidence_ids: [], reason: '', access_level: 'live_official_site' };
  I.lifecycle_stage = { value: 'growing', confidence: 60, evidence_ids: [], reason: '', access_level: 'live_official_site' };
  // synthesis range sub-components (min/max travel with the attendance conclusion)
  (build.synthesis as any).attendance_min = 150;
  (build.synthesis as any).attendance_max = 400;

  // ── REPORT == INTERPRETATION ──────────────────────────────────────────────
  const entry: CalibrationEntry = { id: 'ofh', name: 'Our Finest Hour', city: 'Broken Arrow', state: 'OK', url: 'https://www.ofhchurch.com/' };
  const row = rowFromBuild(entry, build);
  eq('report.lead_pastor == interpretation[0]', row.fields.lead_pastor?.value, I.lead_pastors.value[0]);
  eq('report.office_email == interpretation', row.fields.office_email?.value, I.office_email.value);
  eq('report.office_phone == interpretation', row.fields.office_phone?.value, I.office_phone.value);
  eq('report.staff_count == interpretation', row.fields.staff_count?.value, I.staff_count.value);
  eq('report.denomination == interpretation', row.fields.denomination?.value, I.denomination.value);
  eq('report.avg_weekly_attendance == interpretation', row.fields.avg_weekly_attendance?.value, I.attendance_estimate.value);
  eq('report.lifecycle == interpretation', row.lifecycle.value, lifecycleDisplay(I.lifecycle_stage.value));
  eq('report.archetype == interpretation', row.archetype.value, I.archetype.value);
  eq('report.digital_maturity == interpretation', row.fields.digital_maturity_score?.value, I.digital_maturity_score.value);
  eq('report.growth_orientation == interpretation', row.fields.growth_orientation_score?.value, I.growth_orientation_score.value);
  eq('report.change_readiness == interpretation', row.fields.change_readiness_score?.value, I.change_readiness_score.value);
  eq('report.staff_depth == interpretation', row.fields.staff_depth_score?.value, I.staff_depth_score.value);

  // rendered lead line shows the FULL interpretation (both co-leads)
  const md = renderCalibrationReport([row], {});
  eq('rendered report lead line == interpretation join', md.split('\n').find((l) => /Lead pastor\(s\):\*\*/.test(l))?.includes(I.lead_pastors.value.join('; ')), true);

  // ── ENRICH == INTERPRETATION ──────────────────────────────────────────────
  rmSync(DB, { force: true });
  const store = new JsonStore(DB);
  const { id } = await store.upsertImportRecord({
    original_row_id: 'ofh-1', name: 'Our Finest Hour', address: null, city: 'Broken Arrow', state: 'OK',
    zip: null, country: 'United States', phone_original: null, email_original: null,
    website_original: 'https://www.ofhchurch.com/', language: null, network_affiliation: null, notes: null,
  });
  const church = await store.getChurch(id);
  const ctx: AgentContext = { store, llm: new MockLlmProvider(() => ({})), research: new ResilientResearch() };
  await applyDossierToChurch(ctx, church!, build);

  const proposed = async (field: string): Promise<string | null> => {
    const evs = await store.listEvidence(id, field);
    return evs.length ? (evs[evs.length - 1].proposed_value ?? null) : null;
  };
  eq('enrich.lead_pastor == interpretation join', await proposed('lead_pastor'), I.lead_pastors.value.join('; '));
  eq('enrich.email_verified == interpretation', await proposed('email_verified'), I.office_email.value);
  eq('enrich.phone_verified == interpretation', await proposed('phone_verified'), I.office_phone.value);
  eq('enrich.staff_count == interpretation', await proposed('staff_count'), String(I.staff_count.value));
  eq('enrich.denomination == interpretation', await proposed('denomination'), I.denomination.value);
  eq('enrich.attendance starts with interpretation point', (await proposed('attendance_estimate'))?.startsWith(String(I.attendance_estimate.value)), true);

  console.log(failures ? `\nFAILED (${failures})` : '\nALL PASSED');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
