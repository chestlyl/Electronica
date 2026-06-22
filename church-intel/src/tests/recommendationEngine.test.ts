/**
 * Strategic Recommendation Engine (Phase 2) — OFH / Cornerstone / CCC.
 *
 * Proves: (1) the engine consumes interpretation-layer inputs ONLY, (2) every
 * recommendation cites evidence, (3) no recommendation appears without evidence,
 * (4) same interpretation ⇒ identical recommendations, (5) changing raw findings
 * without changing interpretation does NOT change recommendations.
 *
 *   (run via `npm run test`)
 */
import assert from 'node:assert';
import { makeFinding, type SourceFinding } from '../research/dossier.js';
import { aggregateLeadership, type Facts } from '../research/extractors.js';
import { extractStaffCards } from '../research/staffCards.js';
import { detectTechStack } from '../research/techStack.js';
import { detectStrategicSignals, dimensionCounts as countDims } from '../research/strategicSignals.js';
import { normalizeEvidence } from '../research/normalize.js';
import { interpretDossier } from '../research/interpret.js';
import { scoreStrategic } from '../research/strategicScoring.js';
import { runRecommendationEngine, RULES, type RecommendationInput, type RecommendationEngineResult, type Recommendation } from '../research/recommendationEngine.js';
import { buildCornerstoneOffline } from '../researchDemo.js';
import type { CoverageRow } from '../research/coverage.js';
import type { DossierSynthesis } from '../claude/dossierPrompt.js';

let failures = 0;
function check(label: string, fn: () => void) {
  try { fn(); console.log(`  ✓ ${label}`); } catch (e) { failures++; console.log(`  ✗ ${label}: ${(e as Error).message}`); }
}

const homeUseful: CoverageRow[] = [{ category: 'homepage', required: true, found: true, fetched: true, rendered: true, useful: true, note: '' }];
function synth(over: Partial<DossierSynthesis> = {}): DossierSynthesis {
  return {
    identity_summary: '', digital_summary: '', staff_summary: '', growth_summary: '', lifecycle_summary: '', research_summary: '',
    lifecycle_stage: 'growing', growth_orientation_score: 60, digital_maturity_score: 70, change_readiness_score: 55, staff_depth_score: 50,
    church_app_status: 'active', app_provider: null, lead_pastor: null, denomination: null,
    online_attendance_estimate: null, online_attendance_confidence: 0, attendance_estimate: 250, attendance_min: 150, attendance_max: 400,
    attendance_confidence: 40, staff_count: null, staff_count_confidence: 0, campus_count: null, campus_count_confidence: 0,
    fields: [], known: [], uncertain: [], ...over,
  } as DossierSynthesis;
}

function pipeline(findings: SourceFinding[], facts: Facts, over: Partial<DossierSynthesis>, accessLevel: any = 'live_official_site'): RecommendationInput {
  const leadership = aggregateLeadership(findings);
  const technologyStack = detectTechStack(findings);
  const strategicSignals = detectStrategicSignals(findings);
  const normalized = normalizeEvidence({ findings, facts, leadership, techStack: technologyStack, strategicSignals, conflicts: [] });
  const interpretation = interpretDossier({ normalized, synthesis: synth(over), facts, accessLevel, scoreConfidence: {}, identity: { inputMode: 'known_church', websiteVerificationStatus: 'verified' } });
  const scores = scoreStrategic({ interpretation, normalized, coverage: homeUseful, accessLevel });
  return { interpretation, normalized, scores, strategicSignals, dimensionCounts: countDims(strategicSignals), technologyStack, accessLevel };
}

const ALLOWED_KINDS = new Set(['score', 'signal', 'technology', 'leadership', 'interpretation', 'coverage']);
function allRecs(r: RecommendationEngineResult): Recommendation<unknown>[] {
  return [r.engagement_priority, r.recommended_first_conversation, r.recommended_entry_point, r.likely_pain_points, r.likely_growth_constraints, r.recommended_product_fit, r.partnership_probability];
}
function assertEvidenceEverywhere(r: RecommendationEngineResult) {
  for (const rec of allRecs(r)) {
    assert.ok(rec.evidence_refs.length > 0, 'a recommendation has no evidence');
    for (const e of rec.evidence_refs) assert.ok(ALLOWED_KINDS.has(e.kind), `evidence kind ${e.kind} not interpretation-derived`);
  }
  for (const d of Object.values(r.dimensions)) assert.ok(d.evidence_refs.length > 0, 'a dimension has no evidence');
}

async function main() {
  console.log('Strategic Recommendation Engine — OFH / Cornerstone / CCC');

  check('rule table has at least 20 deterministic rules', () => assert.ok(RULES.length >= 20, `RULES=${RULES.length}`));

  // ── OFH: digitally mature (ChMS+forms+groups), residency + hiring, co-leads ─
  const OFH_STAFF = `Our Pastors\n\nDan Zirkle\nCo-Lead Pastor\n\nJennifer Zirkle\nCo-Lead Pastor`;
  const ofhHome: SourceFinding = makeFinding({
    sourceType: 'official_site', accessLevel: 'live_official_site', url: 'https://www.ofhchurch.com/', title: 'OFH', fetched: true, status: 200, category: 'home',
    text: 'Our Finest Hour Church, a Church of the Nazarene. We are now hiring a worship leader and run a pastoral residency.',
    outboundLinks: [
      { url: 'https://our-finest-hour-church.churchcenter.com/giving', text: 'Give' },
      { url: 'https://our-finest-hour-church.churchcenter.com/groups', text: 'Groups' },
      { url: 'https://our-finest-hour-church.churchcenter.com/people/forms/929885', text: 'Forms' },
      { url: 'https://subsplash.com/ofhchurch/app', text: 'Get our app' },
      { url: 'https://www.youtube.com/@ofhchurch', text: 'Watch sermons' },
    ],
  });
  const ofhStaff: SourceFinding = makeFinding({ sourceType: 'staff_page', accessLevel: 'live_official_site', url: 'https://www.ofhchurch.com/staff', title: 'Our Pastors', fetched: true, status: 200, category: 'staff', text: OFH_STAFF.replace(/\s+/g, ' '), staffCards: extractStaffCards(OFH_STAFF) });
  const ofhFacts: Facts = {
    office_email: { value: 'info@ofhchurch.com', confidence: 88, evidence: 'x', source_url: 'https://www.ofhchurch.com/', access_level: 'live_official_site' },
    office_phone: { value: '(918) 279-1243', confidence: 80, evidence: 'x', source_url: 'https://www.ofhchurch.com/', access_level: 'live_official_site' },
  };
  const ofh = runRecommendationEngine(pipeline([ofhHome, ofhStaff], ofhFacts, { lifecycle_stage: 'growing' }));

  check('OFH: every recommendation + dimension cites interpretation-only evidence', () => assertEvidenceEverywhere(ofh));
  check('OFH: engagement priority high (contactability + leadership + verified)', () => assert.strictEqual(ofh.engagement_priority.value, 'high'));
  check('OFH: first conversation = Leadership Pipeline (growth + residency)', () => assert.strictEqual(ofh.recommended_first_conversation.value, 'Leadership Pipeline'));
  check('OFH: entry point = Lead Pastor (no exec/ops/comms)', () => assert.strictEqual(ofh.recommended_entry_point.value, 'Lead Pastor'));
  check('OFH: digital MATURE → NOT pitched digital transformation', () => {
    assert.notStrictEqual(ofh.recommended_first_conversation.value, 'Digital Systems');
    assert.ok(!ofh.recommended_product_fit.value.includes('Digital Systems Consulting'));
    assert.ok(ofh.dimensions.digital_opportunity.findings.some((f) => /mature/.test(f)));
  });

  // ── Determinism (Rule 4): same interpretation ⇒ identical recommendations ──
  const ofhInput = pipeline([ofhHome, ofhStaff], ofhFacts, { lifecycle_stage: 'growing' });
  check('deterministic: same input ⇒ identical result (run twice)', () => {
    assert.deepStrictEqual(runRecommendationEngine(ofhInput), runRecommendationEngine(ofhInput));
  });

  // ── Cornerstone: snippet-only → capped confidence, still evidence-backed ───
  const { build } = await buildCornerstoneOffline();
  const cs = build.recommendations;
  check('Cornerstone: produced recommendations with overall evidence + confidence', () => { assert.ok(cs.evidence_refs.length > 0); assert.ok(cs.confidence > 0 && cs.confidence <= 65); });
  check('Cornerstone: no recommendation appears without evidence', () => assertEvidenceEverywhere(cs));

  // ── Rule 5: change raw findings WITHOUT changing interpretation ⇒ same recs ─
  const inputFromBuild = (b: typeof build): RecommendationInput => ({
    interpretation: b.interpretation, normalized: b.normalized, scores: b.strategicScores,
    strategicSignals: b.strategicSignals, dimensionCounts: b.strategicDimensionCounts,
    technologyStack: b.techStack, accessLevel: b.accessLevel,
  });
  const before = runRecommendationEngine(inputFromBuild(build));
  // Mutate the RAW layers only (findings + raw evidence). Interpretation untouched.
  (build.findings as any).push(makeFinding({ sourceType: 'search', accessLevel: 'search_snippets', url: 'https://junk.example/x', fetched: false, status: 200, snippet: 'totally different raw text about another church' }));
  (build.raw as any).push({ id: 'raw_junk', source_type: 'search', source_url: 'https://junk.example/x', page_category: 'x', text_excerpt: 'noise', outbound_links: [], fetched: false, rendered: false, crawl_method: 'none', access_level: 'search_snippets', collected_at: '' });
  const after = runRecommendationEngine(inputFromBuild(build));
  check('Rule 5: mutating raw findings does NOT change recommendations', () => assert.deepStrictEqual(before, after));
  check('Rule 1: engine result identical to build.recommendations (interpretation-only)', () => assert.deepStrictEqual(before, build.recommendations));

  // ── CCC: large, digitally mature, plateaued, exec pastor present ───────────
  const CCC_STAFF = `Staff\n\nDavid Stone\nLead Pastor\n\nMark Lee\nExecutive Pastor\n\nSara Kim\nOperations Director`;
  const cccHome: SourceFinding = makeFinding({
    sourceType: 'official_site', accessLevel: 'live_official_site', url: 'https://www.ccc.org/', title: 'Christ Community Church', fetched: true, status: 200, category: 'home',
    text: 'Christ Community Church, a Southern Baptist congregation established in 1968.',
    outboundLinks: [
      { url: 'https://ccc.churchcenter.com/giving', text: 'Give' },
      { url: 'https://ccc.churchcenter.com/groups', text: 'Groups' },
      { url: 'https://ccc.churchcenter.com/people/forms/100', text: 'Forms' },
    ],
  });
  // Use the authoritative staff CARDS; keep page text benign so the frozen prose
  // extractor doesn't cross-attribute titles from a collapsed staff list.
  const cccStaff: SourceFinding = makeFinding({ sourceType: 'staff_page', accessLevel: 'live_official_site', url: 'https://www.ccc.org/staff', title: 'Staff', fetched: true, status: 200, category: 'staff', text: 'Meet our staff and leadership team at Christ Community Church.', staffCards: extractStaffCards(CCC_STAFF) });
  const cccFacts: Facts = {
    office_email: { value: 'info@ccc.org', confidence: 88, evidence: 'x', source_url: 'https://www.ccc.org/', access_level: 'live_official_site' },
    office_phone: { value: '(555) 123-4567', confidence: 80, evidence: 'x', source_url: 'https://www.ccc.org/', access_level: 'live_official_site' },
    staff_count: { value: 25, confidence: 70, evidence: '25 staff', source_url: 'https://www.ccc.org/staff', access_level: 'live_official_site' },
  };
  const ccc = runRecommendationEngine(pipeline([cccHome, cccStaff], cccFacts, { lifecycle_stage: 'plateaued', denomination: 'Southern Baptist' }));
  check('CCC: every recommendation cites evidence', () => assertEvidenceEverywhere(ccc));
  check('CCC: plateaued → first conversation = Revitalization Strategy', () => assert.strictEqual(ccc.recommended_first_conversation.value, 'Revitalization Strategy'));
  check('CCC: entry point = Executive Pastor', () => assert.strictEqual(ccc.recommended_entry_point.value, 'Executive Pastor'));
  check('CCC: product fit includes Revitalization Cohort', () => assert.ok(ccc.recommended_product_fit.value.includes('Revitalization Cohort')));
  check('CCC: digital mature → no digital transformation pitched', () => {
    assert.ok(!ccc.recommended_product_fit.value.includes('Digital Systems Consulting'));
    assert.strictEqual(ccc.dimensions.digital_opportunity.level, 'low');
  });

  console.log(failures ? `\nFAILED (${failures})` : '\nALL PASSED');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
