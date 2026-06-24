/**
 * Two calibration fixes, proven offline:
 *
 * 1. CONTACT — a personal/individual webmail (an elder's gmail scraped from a
 *    leaders-page mailto) must NEVER become the church office_email. An
 *    organizational-domain or role mailbox is preferred; if only personal
 *    addresses exist, office_email stays unknown (accuracy + privacy).
 * 2. SCORING — confirmed structural scale (campus count, attendance) feeds the
 *    capability dimensions, so a large multi-campus church we under-crawl is not
 *    scored as if thin; and confidence is COMPLETENESS-based, so a low score built
 *    on absence cannot also carry high confidence.
 *
 *   (run via `npm run test`)
 */
import assert from 'node:assert';
import { makeFinding, type SourceFinding } from '../research/dossier.js';
import { aggregateLeadership, extractFacts, isPersonalEmail, type Facts } from '../research/extractors.js';
import { extractStaffCards } from '../research/staffCards.js';
import { detectTechStack } from '../research/techStack.js';
import { detectStrategicSignals } from '../research/strategicSignals.js';
import { normalizeEvidence } from '../research/normalize.js';
import { interpretDossier } from '../research/interpret.js';
import { scoreStrategic, bandOf } from '../research/strategicScoring.js';
import type { CoverageRow } from '../research/coverage.js';
import type { DossierSynthesis } from '../claude/dossierPrompt.js';

let failures = 0;
function check(label: string, fn: () => void) {
  try { fn(); console.log(`  ✓ ${label}`); } catch (e) { failures++; console.log(`  ✗ ${label}: ${(e as Error).message}`); }
}

const fullCoverage: CoverageRow[] = ['homepage', 'staff', 'contact', 'about'].map((category) => ({
  category, required: category !== 'about' ? true : false, found: true, fetched: true, rendered: true, useful: category !== 'about', note: '',
}));

function synth(over: Partial<DossierSynthesis> = {}): DossierSynthesis {
  return {
    identity_summary: '', digital_summary: '', staff_summary: '', growth_summary: '', lifecycle_summary: '', research_summary: '',
    lifecycle_stage: 'growing', growth_orientation_score: 60, digital_maturity_score: 60, change_readiness_score: 55, staff_depth_score: 50,
    church_app_status: 'none', app_provider: null, lead_pastor: null, denomination: null,
    online_attendance_estimate: null, online_attendance_confidence: 0, attendance_estimate: null, attendance_min: null, attendance_max: null,
    attendance_confidence: 0, staff_count: null, staff_count_confidence: 0, campus_count: null, campus_count_confidence: 0,
    fields: [], known: [], uncertain: [], ...over,
  } as DossierSynthesis;
}

async function main() {
  console.log('Scale-aware scoring + personal-email rejection');

  // ── 1. CONTACT: personal webmail must not become office_email ──────────────
  check('isPersonalEmail: individual gmail = personal', () => assert.ok(isPersonalEmail('sebastianw3965@gmail.com')));
  check('isPersonalEmail: org-domain address = NOT personal', () => assert.ok(!isPersonalEmail('jeff@gracechurches.org')));
  check('isPersonalEmail: role mailbox on gmail = NOT personal (small-church use)', () => assert.ok(!isPersonalEmail('office@gmail.com')));

  // Leaders page exposes ONLY elders' personal gmails via mailto (the Grace bug).
  const leadersPersonal: SourceFinding = makeFinding({
    sourceType: 'staff_page', accessLevel: 'live_official_site', url: 'https://www.example.org/about/leaders/', fetched: true, status: 200, category: 'staff',
    text: 'Our Lead Team. Jeff Bogue is the Senior Pastor.',
    fields: [
      { field_name: 'email', value: 'sebastianw3965@gmail.com', confidence: 88, evidence_text: 'mailto', source_url: 'https://www.example.org/about/leaders/', source_type: 'official_site', access_level: 'live_official_site' },
      { field_name: 'email', value: 'papaperren@gmail.com', confidence: 80, evidence_text: 'mailto', source_url: 'https://www.example.org/about/leaders/', source_type: 'official_site', access_level: 'live_official_site' },
    ],
  });
  const f1 = extractFacts([leadersPersonal]);
  check('office_email is NOT the personal gmail (left unknown)', () => assert.ok(!f1.office_email || !/gmail\.com/.test(String(f1.office_email.value))));

  // Same church, but a real org mailbox is present → that wins.
  const withOrgEmail: SourceFinding = makeFinding({
    sourceType: 'contact_page', accessLevel: 'live_official_site', url: 'https://www.example.org/contact/', fetched: true, status: 200, category: 'contact',
    text: 'Contact the church office at info@example.org. Elder contact: papaperren@gmail.com.',
  });
  const f2 = extractFacts([leadersPersonal, withOrgEmail]);
  check('office_email prefers the org mailbox info@example.org', () => assert.strictEqual(f2.office_email?.value, 'info@example.org'));

  // ── 2. SCORING: a large multi-campus church scored WITH and WITHOUT scale ───
  const STAFF = 'Our Lead Team Jeff Bogue Senior Pastor Dan Gregory Norton Campus Pastor Joel Gregory Barberton Campus Pastor';
  const home: SourceFinding = makeFinding({
    sourceType: 'official_site', accessLevel: 'live_official_site', url: 'https://www.example.org/', title: 'Big Church', fetched: true, status: 200, category: 'home',
    text: 'Big Church is a multi-campus church. Our average weekend attendance is 5,372 across all campuses. Watch our livestream. We are hiring and run a pastoral residency.',
    outboundLinks: [
      { url: 'https://www.youtube.com/@bigchurch', text: 'Watch live' },
      { url: 'https://www.example.org/onlinegiving', text: 'Give' },
      { url: 'https://www.example.org/jobs', text: 'Job Opportunities' },
      { url: 'https://www.example.org/internship', text: 'Internships' },
    ],
  });
  const staff: SourceFinding = makeFinding({
    sourceType: 'staff_page', accessLevel: 'live_official_site', url: 'https://www.example.org/about/leaders/', title: 'Leaders', fetched: true, status: 200, category: 'staff',
    text: STAFF, staffCards: extractStaffCards(STAFF),
  });
  const findings = [home, staff];
  // Use the real extractor (picks up the reported 5,372), then add structural scale.
  const facts: Facts = {
    ...extractFacts(findings),
    campus_count: { value: 9, confidence: 70, evidence: '9 campuses', source_url: home.url, access_level: 'live_official_site' },
    multi_site: { value: true, confidence: 70, evidence: 'multi-campus', source_url: home.url, access_level: 'live_official_site' },
    staff_count: { value: 13, confidence: 70, evidence: '13 staff', source_url: staff.url, access_level: 'live_official_site' },
  };
  const leadership = aggregateLeadership(findings);
  const techStack = detectTechStack(findings);
  const strategicSignals = detectStrategicSignals(findings);
  const normalized = normalizeEvidence({ findings, facts, leadership, techStack, strategicSignals, conflicts: [] });
  const interp = interpretDossier({ normalized, synthesis: synth(), facts, accessLevel: 'live_official_site', scoreConfidence: {}, identity: { inputMode: 'known_church', websiteVerificationStatus: 'verified' } });

  check('reported attendance flows to interpretation (~5,372)', () => assert.ok((interp.attendance_estimate.value ?? 0) >= 5000));

  const withScale = scoreStrategic({ interpretation: interp, normalized, coverage: fullCoverage, accessLevel: 'live_official_site', scale: { campusCount: 9, multisite: true } });
  const noScale = scoreStrategic({ interpretation: interp, normalized, coverage: fullCoverage, accessLevel: 'live_official_site' });

  check('org_capacity is capable+ once scale is known (was emerging)', () => assert.ok(withScale.organizational_capacity.score >= 51, `score=${withScale.organizational_capacity.score}`));
  check('org_capacity cites scale evidence', () => assert.match(withScale.organizational_capacity.evidenceConsumed.join(' | '), /operates at|multi-campus/i));
  check('change_readiness is capable+ for active multiplier', () => assert.ok(withScale.change_readiness.score >= 51, `score=${withScale.change_readiness.score}`));
  check('digital_maturity lifted by multi-site backbone', () => assert.ok(withScale.digital_maturity.score >= 51, `score=${withScale.digital_maturity.score}`));
  check('scale RAISES org_capacity vs no-scale (evidence, not crawl)', () => assert.ok(withScale.organizational_capacity.score > noScale.organizational_capacity.score));

  // De-saturation: growth is strong but should leave headroom below the cap.
  check('growth is strong but not pinned at 100 (de-saturated)', () => {
    const g = withScale.growth_orientation;
    assert.strictEqual(bandOf(g.score), 'strong');
    assert.ok(g.score < 100, `growth saturated at ${g.score}`);
  });

  // Confidence = completeness: low score from absence must NOT carry high confidence.
  const thinHome: SourceFinding = makeFinding({
    sourceType: 'official_site', accessLevel: 'live_official_site', url: 'https://tiny.example/', title: 'Tiny Church', fetched: true, status: 200, category: 'home',
    text: 'Welcome to Tiny Church. We meet on Sundays.',
  });
  const thinNorm = normalizeEvidence({ findings: [thinHome], facts: {}, leadership: aggregateLeadership([thinHome]), techStack: [], strategicSignals: detectStrategicSignals([thinHome]), conflicts: [] });
  const thinInterp = interpretDossier({ normalized: thinNorm, synthesis: synth({ lifecycle_stage: 'established' }), facts: {}, accessLevel: 'live_official_site', scoreConfidence: {}, identity: { inputMode: 'known_church', websiteVerificationStatus: 'verified' } });
  const thin = scoreStrategic({ interpretation: thinInterp, normalized: thinNorm, coverage: [{ category: 'homepage', required: true, found: true, fetched: true, rendered: true, useful: true, note: '' }], accessLevel: 'live_official_site' });

  check('thin church: low digital score carries LOW confidence (not high)', () => {
    const d = thin.digital_maturity;
    assert.ok(d.score <= 40, `score=${d.score}`);
    assert.ok(d.confidence <= 55, `low score should not be high-confidence; conf=${d.confidence}`);
  });
  check('well-evidenced dim outranks thin dim in confidence', () => assert.ok(withScale.organizational_capacity.confidence > thin.digital_maturity.confidence));

  console.log(failures ? `\nFAILED (${failures})` : '\nALL PASSED');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
