/**
 * Average Weekend Attendance — reported vs inferred + explainability.
 *
 * Proves: a publicly-stated number is captured as `reported`; otherwise the
 * synthesis estimate is `inferred`; the attendance conclusion always carries a
 * range, evidence factors, and reasoning (never a mystery number); and service
 * times are normalized into evidence.
 *
 *   (run via `npm run test`)
 */
import assert from 'node:assert';
import { makeFinding, type SourceFinding } from '../research/dossier.js';
import { reportedAttendance, aggregateLeadership, extractFacts, type Facts } from '../research/extractors.js';
import { extractStaffCards } from '../research/staffCards.js';
import { detectTechStack } from '../research/techStack.js';
import { detectStrategicSignals } from '../research/strategicSignals.js';
import { normalizeEvidence, extractServiceTimes } from '../research/normalize.js';
import { interpretDossier } from '../research/interpret.js';
import type { DossierSynthesis } from '../claude/dossierPrompt.js';

let failures = 0;
function check(label: string, fn: () => void) {
  try { fn(); console.log(`  ✓ ${label}`); } catch (e) { failures++; console.log(`  ✗ ${label}: ${(e as Error).message}`); }
}

function synth(over: Partial<DossierSynthesis> = {}): DossierSynthesis {
  return {
    identity_summary: '', digital_summary: '', staff_summary: '', growth_summary: '', lifecycle_summary: '', research_summary: '',
    lifecycle_stage: 'growing', growth_orientation_score: 60, digital_maturity_score: 70, change_readiness_score: 55, staff_depth_score: 50,
    church_app_status: 'active', app_provider: null, lead_pastor: null, denomination: null,
    online_attendance_estimate: null, online_attendance_confidence: 0, attendance_estimate: 600, attendance_min: 400, attendance_max: 900,
    attendance_confidence: 45, staff_count: null, staff_count_confidence: 0, campus_count: null, campus_count_confidence: 0,
    fields: [], known: [], uncertain: [], ...over,
  } as DossierSynthesis;
}
function interp(findings: SourceFinding[], facts: Facts, over: Partial<DossierSynthesis> = {}) {
  const leadership = aggregateLeadership(findings);
  const techStack = detectTechStack(findings);
  const strategicSignals = detectStrategicSignals(findings);
  const normalized = normalizeEvidence({ findings, facts, leadership, techStack, strategicSignals, conflicts: [] });
  return interpretDossier({ normalized, synthesis: synth(over), facts, accessLevel: 'live_official_site', scoreConfidence: {}, identity: { inputMode: 'known_church', websiteVerificationStatus: 'verified' } });
}

async function main() {
  console.log('Average Weekend Attendance — reported vs inferred + explainability');

  // ── reported attendance detector ──────────────────────────────────────────
  check('reportedAttendance: "average attendance of 750"', () => assert.strictEqual(reportedAttendance('Our average weekend attendance of 750 each week.')?.value, 750));
  check('reportedAttendance: "1,200 people gather"', () => assert.strictEqual(reportedAttendance('About 1,200 people gather every weekend.')?.value, 1200));
  check('reportedAttendance: ignores unrelated numbers', () => assert.strictEqual(reportedAttendance('Founded in 1998 at 250 Main Street.'), null));

  // ── REPORTED path: a stated number wins and is flagged reported ────────────
  const reported: SourceFinding = makeFinding({
    sourceType: 'official_site', accessLevel: 'live_official_site', url: 'https://www.bigchurch.org/', fetched: true, status: 200, category: 'home',
    text: 'We are a growing church with an average weekend attendance of 2,400 across Sunday services at 9:00am and 11:00am.',
  });
  const rFacts = extractFacts([reported]);
  const rInterp = interp([reported], rFacts);
  check('reported number captured into facts.reported_attendance', () => assert.strictEqual(Number(rFacts.reported_attendance?.value), 2400));
  check('interpretation attendance = reported value, source=reported', () => {
    assert.strictEqual(rInterp.attendance_estimate.value, 2400);
    assert.strictEqual(rInterp.attendance_source, 'reported');
  });
  check('reported attendance reasoning says "Reported"', () => assert.match(rInterp.attendance_reasoning, /Reported 2400/));
  check('service times normalized as evidence', () => {
    const times = extractServiceTimes([reported]);
    assert.ok(times.length >= 2, JSON.stringify(times));
    assert.ok(rInterp.attendance_evidence.some((a) => a.factor === 'service_times'));
  });

  // ── INFERRED path: no stated number → synthesis estimate, flagged inferred ─
  const STAFF = `Staff\n\nJoe Smith\nLead Pastor\n\nMary Jones\nExecutive Pastor`;
  const inferredHome: SourceFinding = makeFinding({
    sourceType: 'official_site', accessLevel: 'live_official_site', url: 'https://www.midchurch.org/', fetched: true, status: 200, category: 'home',
    text: 'Welcome to Mid Church. Join a group. Give online.',
    outboundLinks: [{ url: 'https://midchurch.churchcenter.com/groups', text: 'Groups' }],
  });
  const inferredStaff: SourceFinding = makeFinding({ sourceType: 'staff_page', accessLevel: 'live_official_site', url: 'https://www.midchurch.org/staff', fetched: true, status: 200, category: 'staff', text: 'team', staffCards: extractStaffCards(STAFF) });
  const iFacts: Facts = { staff_count: { value: 9, confidence: 70, evidence: '9 staff', source_url: 'https://www.midchurch.org/staff', access_level: 'live_official_site' } };
  const iInterp = interp([inferredHome, inferredStaff], iFacts);
  // Staff is the primary size indicator, but headcount is inflated vs FTE, so the
  // per-head factor is conservative: 9 staff × ~60 ≈ 550, with a WIDE range and
  // modest confidence (it's a rough heuristic, not hard-and-fast).
  check('inferred: value = staff-headcount estimate (9×60=550), source=inferred', () => {
    assert.strictEqual(iInterp.attendance_estimate.value, 550);
    assert.strictEqual(iInterp.attendance_source, 'inferred');
  });
  check('inferred: confidence is modest (≤50) and range is wide', () => {
    assert.ok(iInterp.attendance_estimate.confidence <= 50);
    assert.ok((iInterp.attendance_range.max ?? 0) - (iInterp.attendance_range.min ?? 0) >= 600);
  });
  check('inferred: reasoning cites headcount caveat (part-time/volunteer)', () => {
    assert.match(iInterp.attendance_reasoning, /staff headcount/);
    assert.match(iInterp.attendance_reasoning, /part-time\/volunteer/);
    assert.match(iInterp.attendance_reasoning, /Source: inferred/);
  });
  check('inferred: attendance_evidence includes staff_count + church_center_usage', () => {
    const factors = iInterp.attendance_evidence.map((a) => a.factor);
    assert.ok(factors.includes('staff_count') && factors.includes('church_center_usage'), JSON.stringify(factors));
  });

  // ── synthesis fallback when staff is unknown ──────────────────────────────
  const synthOnly = interp([inferredHome], {});
  check('no staff → falls back to synthesis estimate (600)', () => {
    assert.strictEqual(synthOnly.attendance_estimate.value, 600);
    assert.match(synthOnly.attendance_reasoning, /synthesis estimate/);
  });

  // ── UNKNOWN path: no reported, no staff, no synthesis estimate ────────────
  const u = interp([inferredHome], {}, { attendance_estimate: null, attendance_min: null, attendance_max: null });
  check('unknown: value null, source=unknown, honest reasoning', () => {
    assert.strictEqual(u.attendance_estimate.value, null);
    assert.strictEqual(u.attendance_source, 'unknown');
    assert.match(u.attendance_reasoning, /No attendance estimate/);
  });

  console.log(failures ? `\nFAILED (${failures})` : '\nALL PASSED');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
