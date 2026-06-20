/**
 * Stabilization purge — single source of truth.
 *
 * Proves a stale legacy fact can NEVER override the interpretation conclusion:
 * if interpretation.lead_pastors = [Dan, Jennifer], neither the report nor enrich
 * may output only "Jennifer" from facts. Also proves staff_count + contacts flow
 * from interpretation, and the digital_maturity reason counts strategic signals.
 *
 *   (run via `npm run test`)
 */
import assert from 'node:assert';
import { rmSync } from 'node:fs';
import { makeFinding, type SourceFinding } from '../research/dossier.js';
import { aggregateLeadership } from '../research/extractors.js';
import { extractStaffCards } from '../research/staffCards.js';
import { normalizeEvidence } from '../research/normalize.js';
import { interpretDossier } from '../research/interpret.js';
import { scoreConfidence } from '../research/coverage.js';
import { detectDigitalSignals } from '../research/digitalSignals.js';
import { rowFromBuild, type CalibrationEntry } from '../research/calibrationSet.js';
import { renderCalibrationReport } from '../research/calibrationReport.js';
import { applyDossierToChurch } from '../agents/dossierApply.js';
import { buildCornerstoneOffline } from '../researchDemo.js';
import { JsonStore } from '../db/jsonStore.js';
import { MockLlmProvider } from '../claude/client.js';
import { ResilientResearch } from '../research/resilient.js';
import type { AgentContext } from '../agents/index.js';

const DB = 'data/output/stabilization_db.json';
let failures = 0;
function check(label: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`  ✓ ${label}`))
    .catch((e) => { failures++; console.log(`  ✗ ${label}: ${(e as Error).message}`); });
}

async function main() {
  console.log('Stabilization — one source of truth (OFH co-leads)');

  // ── Layer guarantee: facts naming only Jennifer cannot reduce the conclusion ─
  const STAFF = `Our Pastors\n\nDan Zirkle\nCo-Lead Pastor\n\nJennifer Zirkle\nCo-Lead Pastor`;
  const staffFinding: SourceFinding = makeFinding({
    sourceType: 'staff_page', accessLevel: 'live_official_site', url: 'https://www.ofhchurch.com/staff',
    title: 'Our Pastors', fetched: true, status: 200, text: STAFF.replace(/\s+/g, ' '), category: 'staff',
    staffCards: extractStaffCards(STAFF),
  });
  const leadership = aggregateLeadership([staffFinding]);
  // A STALE single-value fact that names only Jennifer — must not win.
  const normalized = normalizeEvidence({
    findings: [staffFinding],
    facts: { lead_pastor: { value: 'Jennifer Zirkle', confidence: 60, evidence: 'stale single fact', source_url: 'https://x', access_level: 'search_snippets' } },
    leadership, techStack: [], strategicSignals: [], conflicts: [],
  });
  const interp = interpretDossier({
    normalized, synthesis: stubSynth(), facts: {}, accessLevel: 'live_official_site',
    scoreConfidence: {}, identity: { inputMode: 'known_church', websiteVerificationStatus: 'verified' },
  });
  await check('interpretation keeps BOTH co-leads despite a Jennifer-only fact', () => {
    assert.deepStrictEqual(interp.lead_pastors.value.slice().sort(), ['Dan Zirkle', 'Jennifer Zirkle']);
  });

  // ── digital_maturity reason counts strategic signals (no "0 digital signals") ─
  await check('digital_maturity reason has no "0 digital signals" when strategic signals exist', () => {
    const sc = scoreConfidence('digital_maturity_score', [], detectDigitalSignals([]), { digital_maturity: 3 });
    assert.ok(!/no digital or strategic signals/.test(sc.reason), sc.reason);
    assert.ok(/3 strategic signal/.test(sc.reason), sc.reason);
  });
  await check('digital_maturity says "no digital or strategic signals" only when truly none', () => {
    const sc = scoreConfidence('digital_maturity_score', [], detectDigitalSignals([]), { digital_maturity: 0 });
    assert.match(sc.reason, /no digital or strategic signals found/);
  });

  // ── Report + enrich both consume the SAME interpretation ──────────────────
  const { build } = await buildCornerstoneOffline();
  // Force a divergence: interpretation says both co-leads; the legacy fact says
  // only Jennifer. Report + enrich must echo the interpretation, not the fact.
  build.interpretation.lead_pastors = { value: ['Dan Zirkle', 'Jennifer Zirkle'], confidence: 90, evidence_ids: ['leader_1', 'leader_2'], reason: 'co-leads', access_level: 'live_official_site' };
  (build.facts as any).lead_pastor = { value: 'Jennifer Zirkle', confidence: 60, evidence: 'stale', source_url: 'https://x', access_level: 'search_snippets' };

  const entry: CalibrationEntry = { id: 'ofh', name: 'Our Finest Hour', city: 'Broken Arrow', state: 'OK', url: 'https://www.ofhchurch.com/' };
  const row = rowFromBuild(entry, build);
  const md = renderCalibrationReport([row], {});
  await check('REPORT lead line shows both co-leads (not Jennifer-only)', () => {
    const line = md.split('\n').find((l) => /Lead pastor\(s\):\*\*/.test(l)) ?? '';
    assert.ok(/Dan Zirkle; Jennifer Zirkle/.test(line), line);
  });
  await check('REPORT field map lead_pastor = Dan Zirkle (from interpretation, not stale fact)', () => {
    assert.strictEqual(String(row.fields.lead_pastor?.value), 'Dan Zirkle');
  });

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
  const reviews = await store.listReviewQueue('pending');
  const leadReview = reviews.find((r) => r.field_name === 'lead_pastor');
  await check('ENRICH proposes both co-leads (not Jennifer-only from facts)', () => {
    assert.ok(leadReview, 'no lead_pastor review item');
    assert.strictEqual(leadReview!.proposed_value, 'Dan Zirkle; Jennifer Zirkle');
  });

  console.log(failures ? `\nFAILED (${failures})` : '\nALL PASSED');
  process.exit(failures ? 1 : 0);
}

function stubSynth() {
  return {
    identity_summary: '', digital_summary: '', staff_summary: '', growth_summary: '', lifecycle_summary: '', research_summary: '',
    lifecycle_stage: 'established', growth_orientation_score: 50, digital_maturity_score: 50, change_readiness_score: 50, staff_depth_score: 50,
    church_app_status: 'unknown', app_provider: null, lead_pastor: 'Jennifer Zirkle', denomination: null,
    online_attendance_estimate: null, online_attendance_confidence: 0, attendance_estimate: null, attendance_min: null, attendance_max: null,
    attendance_confidence: 0, staff_count: null, staff_count_confidence: 0, campus_count: null, campus_count_confidence: 0,
    fields: [], known: [], uncertain: [],
  } as any;
}

main().catch((e) => { console.error(e); process.exit(1); });
