/**
 * Strategic Scoring v1 — rubric-based, report-only (OFH + Cornerstone fixtures).
 *
 * Verifies: scores derive ONLY from interpretation + normalized evidence +
 * strategic signals + tech stack + coverage; every score traces to evidence;
 * no dimension claims zero evidence when strategic signals exist for it; and
 * OFH's digital score reflects Church Center, Subsplash, giving/forms/groups/sermons.
 *
 *   (run via `npm run test`)
 */
import assert from 'node:assert';
import { makeFinding, type SourceFinding } from '../research/dossier.js';
import { aggregateLeadership, type Facts } from '../research/extractors.js';
import { extractStaffCards } from '../research/staffCards.js';
import { detectTechStack } from '../research/techStack.js';
import { detectStrategicSignals, dimensionCounts, DIMENSIONS } from '../research/strategicSignals.js';
import { normalizeEvidence } from '../research/normalize.js';
import { interpretDossier } from '../research/interpret.js';
import { scoreStrategic, bandOf } from '../research/strategicScoring.js';
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
    church_app_status: 'active', app_provider: 'Church Center / Planning Center', lead_pastor: null, denomination: 'Church of the Nazarene',
    online_attendance_estimate: null, online_attendance_confidence: 0, attendance_estimate: 250, attendance_min: 150, attendance_max: 400,
    attendance_confidence: 40, staff_count: null, staff_count_confidence: 0, campus_count: null, campus_count_confidence: 0,
    fields: [], known: [], uncertain: [], ...over,
  } as DossierSynthesis;
}

function bandRank(b: string) { return ['weak', 'emerging', 'capable', 'strong'].indexOf(b); }

async function main() {
  console.log('Strategic Scoring v1 — rubric (OFH + Cornerstone)');

  // ── OFH fixture: full digital stack + leadership + contacts ───────────────
  const STAFF = `Our Pastors\n\nDan Zirkle\nCo-Lead Pastor\n\nJennifer Zirkle\nCo-Lead Pastor`;
  const home: SourceFinding = makeFinding({
    sourceType: 'official_site', accessLevel: 'live_official_site', url: 'https://www.ofhchurch.com/',
    title: 'Our Finest Hour Church', fetched: true, status: 200, category: 'home',
    text: 'Welcome to Our Finest Hour Church, a Church of the Nazarene. 11045 OK-51, Broken Arrow, OK 74014. We are now hiring a worship leader and run a pastoral residency. Listen to our weekly podcast.',
    outboundLinks: [
      { url: 'https://our-finest-hour-church.churchcenter.com/giving', text: 'Give' },
      { url: 'https://our-finest-hour-church.churchcenter.com/groups', text: 'Groups' },
      { url: 'https://our-finest-hour-church.churchcenter.com/calendar', text: 'Calendar' },
      { url: 'https://our-finest-hour-church.churchcenter.com/people/forms/929885', text: 'Forms' },
      { url: 'https://pushpay.com/g/ofh', text: 'Donate' },
      { url: 'https://subsplash.com/ofhchurch/app', text: 'Get our app' },
      { url: 'https://www.youtube.com/@ofhchurch', text: 'Watch sermons' },
      { url: 'https://open.spotify.com/show/ofh', text: 'Podcast' },
      { url: 'https://www.facebook.com/ofhchurch', text: 'Facebook' },
    ],
  });
  const staff: SourceFinding = makeFinding({
    sourceType: 'staff_page', accessLevel: 'live_official_site', url: 'https://www.ofhchurch.com/staff',
    title: 'Our Pastors', fetched: true, status: 200, category: 'staff', text: STAFF.replace(/\s+/g, ' '),
    staffCards: extractStaffCards(STAFF),
  });
  const findings = [home, staff];
  const facts: Facts = {
    office_email: { value: 'info@ofhchurch.com', confidence: 88, evidence: 'mailto', source_url: 'https://www.ofhchurch.com/', access_level: 'live_official_site' },
    office_phone: { value: '(918) 279-1243', confidence: 80, evidence: 'tel', source_url: 'https://www.ofhchurch.com/', access_level: 'live_official_site' },
    staff_count: { value: 9, confidence: 70, evidence: '9 staff', source_url: 'https://www.ofhchurch.com/staff', access_level: 'live_official_site' },
  };
  const leadership = aggregateLeadership(findings);
  const techStack = detectTechStack(findings);
  const strategicSignals = detectStrategicSignals(findings);
  const counts = dimensionCounts(strategicSignals);
  const normalized = normalizeEvidence({ findings, facts, leadership, techStack, strategicSignals, conflicts: [] });
  const interp = interpretDossier({ normalized, synthesis: synth(), facts, accessLevel: 'live_official_site', scoreConfidence: {}, identity: { inputMode: 'known_church', websiteVerificationStatus: 'verified' } });
  const scores = scoreStrategic({ interpretation: interp, normalized, coverage: homeUseful, accessLevel: 'live_official_site' });

  const digital = scores.digital_maturity;
  const consumed = digital.evidenceConsumed.join(' | ');
  check('OFH digital reflects Church Center (ChMS)', () => assert.match(consumed, /Church Center/));
  check('OFH digital reflects Subsplash (app)', () => assert.match(consumed, /Subsplash/));
  check('OFH digital reflects giving', () => assert.match(consumed, /giving/i));
  check('OFH digital reflects forms', () => assert.match(consumed, /forms/i));
  check('OFH digital reflects groups', () => assert.match(consumed, /groups/i));
  check('OFH digital reflects sermons/video', () => assert.match(consumed, /livestream|video/i));
  check('OFH digital is capable or strong', () => assert.ok(bandRank(digital.band) >= 2, `band=${digital.band} score=${digital.score}`));

  check('OFH growth reflects hiring + residency', () => {
    const c = scores.growth_orientation.evidenceConsumed.join(' | ');
    assert.ok(/hiring/i.test(c) || /residency|internship/i.test(c), c);
  });
  check('OFH change_readiness reflects lifecycle (growing)', () => assert.match(scores.change_readiness.evidenceConsumed.join(' | '), /lifecycle: growing/));
  check('OFH contactability reflects email + phone + lead pastors', () => {
    const c = scores.contactability.evidenceConsumed.join(' | ');
    assert.ok(/email/i.test(c) && /phone/i.test(c) && /lead pastor/i.test(c), c);
  });

  // ── ACCEPTANCE: no dimension claims zero evidence when signals exist for it ─
  check('no dimension claims zero evidence when strategic signals exist', () => {
    for (const d of DIMENSIONS) {
      if (counts[d] > 0) {
        assert.ok(scores[d].score > 0, `${d} score 0 despite ${counts[d]} signals`);
        assert.ok(scores[d].evidenceConsumed.length > 0, `${d} has signals but empty evidenceConsumed`);
        assert.ok(scores[d].evidenceConsumed.join(' ').includes('signal'), `${d} evidence does not cite signals`);
      }
    }
  });

  // ── ACCEPTANCE: every score traces to evidence rows ───────────────────────
  check('every non-zero score cites evidence row ids', () => {
    for (const d of DIMENSIONS) {
      const s = scores[d];
      if (s.score > 0) {
        assert.ok(s.evidenceConsumed.length > 0, `${d} score ${s.score} but no evidence`);
        assert.ok(s.evidenceConsumed.some((e) => /\[[a-z]+_\d+/.test(e) || /\[interpretation/.test(e) || /\[—\]/.test(e) === false), `${d} evidence lacks traceable ids: ${s.evidenceConsumed.join(';')}`);
      }
    }
  });

  check('every dimension carries score/band/confidence/reason + missing list', () => {
    for (const d of DIMENSIONS) {
      const s = scores[d];
      assert.ok(s.score >= 0 && s.score <= 100, `${d} score range`);
      assert.strictEqual(s.band, bandOf(s.score));
      assert.ok(s.confidence >= 0 && s.confidence <= 100);
      assert.ok(typeof s.reason === 'string' && s.reason.length > 0);
      assert.ok(Array.isArray(s.evidenceMissing));
    }
  });

  // ── Cornerstone (snippet-only) — confidence capped by access level ─────────
  const { build } = await buildCornerstoneOffline();
  const cs = build.strategicScores;
  check('Cornerstone produces all five dimension scores', () => assert.deepStrictEqual(Object.keys(cs).sort(), [...DIMENSIONS].sort()));
  check('Cornerstone confidence capped by snippet access (≤65)', () => {
    for (const d of DIMENSIONS) assert.ok(cs[d].confidence <= 65, `${d} conf ${cs[d].confidence} > 65 cap`);
  });
  check('Cornerstone capping invariant holds (confidence = min(raw, cap), capped = raw>cap)', () => {
    for (const d of DIMENSIONS) {
      assert.strictEqual(cs[d].confidence, Math.min(cs[d].rawConfidence, 65), `${d} confidence != min(raw,cap)`);
      assert.strictEqual(cs[d].capped, cs[d].rawConfidence > 65, `${d} capped flag wrong`);
    }
  });
  check('capping ENGAGES when rich evidence meets a low access level', () => {
    // Re-score OFH's rich evidence as if best access were snippet-only (cap 65):
    // digital has many contributions → raw 90 > 65 → must be capped to 65.
    const capped = scoreStrategic({ interpretation: interp, normalized, coverage: homeUseful, accessLevel: 'search_snippets' });
    assert.ok(capped.digital_maturity.capped, 'digital should cap at snippet access');
    assert.strictEqual(capped.digital_maturity.confidence, 65);
    assert.ok(capped.digital_maturity.rawConfidence > 65);
    assert.match(capped.digital_maturity.capReason ?? '', /capped to 65/);
  });
  check('Cornerstone contactability has traceable evidence (lead pastor / email)', () => {
    const c = cs.contactability.evidenceConsumed.join(' | ');
    assert.ok(cs.contactability.score > 0 && c.length > 0, c);
  });

  console.log(failures ? `\nFAILED (${failures})` : '\nALL PASSED');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
