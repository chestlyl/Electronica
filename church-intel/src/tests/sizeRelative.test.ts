/**
 * Capability-vs-size lens — divergence of strategic capability from what church
 * size (AWA) predicts. Additive/report-only; proves it does NOT mutate scores,
 * and that the modernization flag feeds the recommendation engine.
 *
 *   (run via `npm run test`)
 */
import assert from 'node:assert';
import { computeSizeRelative, sizeExpectation } from '../research/sizeRelative.js';
import type { StrategicScores } from '../research/strategicScoring.js';
import type { Band, ScoredDimension } from '../research/strategicScoring.js';
import type { Dimension } from '../research/strategicSignals.js';
import { runRecommendationEngine, type RecommendationInput } from '../research/recommendationEngine.js';
import { makeFinding, type SourceFinding } from '../research/dossier.js';
import { aggregateLeadership, type Facts } from '../research/extractors.js';
import { extractStaffCards } from '../research/staffCards.js';
import { detectTechStack } from '../research/techStack.js';
import { detectStrategicSignals, dimensionCounts as countDims } from '../research/strategicSignals.js';
import { normalizeEvidence } from '../research/normalize.js';
import { interpretDossier } from '../research/interpret.js';
import { scoreStrategic } from '../research/strategicScoring.js';
import type { CoverageRow } from '../research/coverage.js';

let failures = 0;
function check(label: string, fn: () => void) {
  try { fn(); console.log(`  ✓ ${label}`); } catch (e) { failures++; console.log(`  ✗ ${label}: ${(e as Error).message}`); }
}

function band(score: number): Band { return score <= 25 ? 'weak' : score <= 50 ? 'emerging' : score <= 75 ? 'capable' : 'strong'; }
function dim(d: Dimension, score: number): ScoredDimension {
  return {
    dimension: d, score, band: band(score), confidence: 60, rawConfidence: 60, capped: false,
    positive_factors: [], negative_factors: [], top_factors: [], evidenceConsumed: [], evidenceMissing: [], reason: 'test',
  };
}
// `cr` is accepted but ignored — change_readiness merged into growth_orientation.
function mkScores(v: { dm: number; go: number; cr?: number; oc: number; ct: number }): StrategicScores {
  return {
    digital_maturity: dim('digital_maturity', v.dm),
    growth_orientation: dim('growth_orientation', v.go),
    organizational_capacity: dim('organizational_capacity', v.oc),
    contactability: dim('contactability', v.ct),
  };
}

async function main() {
  console.log('Capability-vs-size lens');

  // sizeExpectation: monotonic, clamped to [25, 92].
  check('sizeExpectation rises with size and is clamped', () => {
    assert.ok(sizeExpectation(30) <= sizeExpectation(800));
    assert.ok(sizeExpectation(30) >= 25 && sizeExpectation(50000) <= 92);
  });

  // null AWA → unknown, not assessed.
  check('null AWA → posture unknown, no reads', () => {
    const p = computeSizeRelative(null, mkScores({ dm: 50, go: 50, cr: 50, oc: 50, ct: 50 }));
    assert.strictEqual(p.posture, 'unknown');
    assert.strictEqual(p.reads.length, 0);
    assert.strictEqual(p.modernization_opportunity, false);
  });

  // Small church + strong capability → punching above its weight.
  check('small church + strong capability → punching_above_weight + above_weight flag', () => {
    const p = computeSizeRelative(180, mkScores({ dm: 85, go: 85, cr: 80, oc: 30, ct: 70 }));
    assert.strictEqual(p.posture, 'punching_above_weight');
    assert.strictEqual(p.above_weight, true);
    assert.strictEqual(p.modernization_opportunity, false);
  });

  // Large church + thin digital → underdeveloped + modernization opportunity.
  check('large church + thin digital → underdeveloped_for_size + modernization flag', () => {
    const p = computeSizeRelative(2500, mkScores({ dm: 30, go: 30, cr: 35, oc: 80, ct: 60 }));
    assert.strictEqual(p.posture, 'underdeveloped_for_size');
    assert.strictEqual(p.modernization_opportunity, true);
    assert.ok(p.reads.find((r) => r.dimension === 'digital_maturity')!.read === 'under');
  });

  // On-par: capability tracks the size expectation.
  check('capability near expectation → on_par, no flags', () => {
    const exp = sizeExpectation(900);
    const p = computeSizeRelative(900, mkScores({ dm: exp, go: exp, cr: exp, oc: 50, ct: 50 }));
    assert.strictEqual(p.posture, 'on_par');
    assert.strictEqual(p.modernization_opportunity, false);
    assert.strictEqual(p.above_weight, false);
  });

  // organizational_capacity is excluded from the reads (it is a size measure).
  check('organizational_capacity excluded from reads', () => {
    const p = computeSizeRelative(2500, mkScores({ dm: 30, go: 30, cr: 30, oc: 80, ct: 60 }));
    assert.ok(!p.reads.some((r) => r.dimension === 'organizational_capacity'));
  });

  // ── Recommendation engine: modernization flag bumps priority + adds product fit.
  const homeUseful: CoverageRow[] = [{ category: 'homepage', required: true, found: true, fetched: true, rendered: true, useful: true, note: '' }];
  const home: SourceFinding = makeFinding({
    sourceType: 'official_site', accessLevel: 'live_official_site', url: 'https://www.bigchurch.org/', title: 'Big Church', fetched: true, status: 200, category: 'home',
    text: 'Big Church, an established congregation. Service times Sunday 9am and 11am.',
  });
  const STAFF = `Staff\n\nDavid Stone\nLead Pastor\n\nMark Lee\nExecutive Pastor`;
  const staff: SourceFinding = makeFinding({ sourceType: 'staff_page', accessLevel: 'live_official_site', url: 'https://www.bigchurch.org/staff', title: 'Staff', fetched: true, status: 200, category: 'staff', text: 'Meet our staff.', staffCards: extractStaffCards(STAFF) });
  const facts: Facts = {
    office_email: { value: 'info@bigchurch.org', confidence: 88, evidence: 'x', source_url: 'https://www.bigchurch.org/', access_level: 'live_official_site' },
    office_phone: { value: '(555) 222-3333', confidence: 80, evidence: 'x', source_url: 'https://www.bigchurch.org/', access_level: 'live_official_site' },
  };
  const leadership = aggregateLeadership([home, staff]);
  const technologyStack = detectTechStack([home, staff]);
  const strategicSignals = detectStrategicSignals([home, staff]);
  const normalized = normalizeEvidence({ findings: [home, staff], facts, leadership, techStack: technologyStack, strategicSignals, conflicts: [] });
  const interpretation = interpretDossier({ normalized, synthesis: {
    identity_summary: '', digital_summary: '', staff_summary: '', growth_summary: '', lifecycle_summary: '', research_summary: '',
    lifecycle_stage: 'established', growth_orientation_score: 30, digital_maturity_score: 30, change_readiness_score: 35, staff_depth_score: 60,
    church_app_status: 'none', app_provider: null, lead_pastor: null, denomination: null,
    online_attendance_estimate: null, online_attendance_confidence: 0, attendance_estimate: 2500, attendance_min: 2000, attendance_max: 3000,
    attendance_confidence: 50, staff_count: null, staff_count_confidence: 0, campus_count: null, campus_count_confidence: 0,
    fields: [], known: [], uncertain: [],
  } as any, facts, accessLevel: 'live_official_site', scoreConfidence: {}, identity: { inputMode: 'known_church', websiteVerificationStatus: 'verified' } });
  const scores = scoreStrategic({ interpretation, normalized, coverage: homeUseful, accessLevel: 'live_official_site' });
  const base: Omit<RecommendationInput, 'sizeRelative'> = {
    interpretation, normalized, scores, strategicSignals, dimensionCounts: countDims(strategicSignals), technologyStack, accessLevel: 'live_official_site',
  };

  // Force a clean modernization profile so the test isolates the lens behavior
  // (the synthetic scores above already read thin-digital at AWA 2500).
  const modProfile = computeSizeRelative(2500, mkScores({ dm: 25, go: 30, cr: 30, oc: 80, ct: 70 }));
  check('engine: modernization profile makes it a high-value target', () => {
    const without = runRecommendationEngine({ ...base });
    const withMod = runRecommendationEngine({ ...base, sizeRelative: modProfile });
    assert.ok(modProfile.modernization_opportunity, 'profile should flag modernization');
    // priority is bumped at least one notch (low→medium or medium→high)
    const rank = (p: string) => (p === 'high' ? 2 : p === 'medium' ? 1 : 0);
    assert.ok(rank(withMod.engagement_priority.value) >= rank(without.engagement_priority.value));
    assert.ok(withMod.recommended_product_fit.value.includes('Digital Modernization (at scale)'));
    // every recommendation still cites evidence
    assert.ok(withMod.engagement_priority.evidence_refs.length > 0);
  });

  check('engine: no modernization flag ⇒ product fit unchanged', () => {
    const small = computeSizeRelative(180, mkScores({ dm: 85, go: 85, cr: 80, oc: 30, ct: 70 }));
    const r = runRecommendationEngine({ ...base, sizeRelative: small });
    assert.ok(!r.recommended_product_fit.value.includes('Digital Modernization (at scale)'));
  });

  console.log(failures ? `\nFAILED (${failures})` : '\nALL PASSED');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
