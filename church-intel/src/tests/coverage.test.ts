/**
 * Minimum-evidence coverage + coverage-aware confidence (Cornerstone regression).
 *
 * The bug: the system produced strategic scores BEFORE successfully extracting
 * staff intelligence. These tests assert the system now KNOWS whether it has
 * enough evidence:
 *   - coverage reports staff found/fetched/rendered/useful,
 *   - staff_depth confidence is HIGH when the staff page rendered with roles,
 *     and LOW (with a reason) when the staff page is unavailable,
 *   - contactability confidence reflects collected contact/staff evidence,
 *   - digital-maturity confidence reflects detected digital signals.
 *
 *   (run via `npm run test`)
 */
import assert from 'node:assert';
import { makeFinding, type SourceFinding } from '../research/dossier.js';
import type { Facts, Fact } from '../research/extractors.js';
import { detectDigitalSignals } from '../research/digitalSignals.js';
import { computeCoverage, scoreConfidence, contactabilityConfidence } from '../research/coverage.js';

let failures = 0;
function check(label: string, fn: () => void) {
  try { fn(); console.log(`  ✓ ${label}`); } catch (e) { failures++; console.log(`  ✗ ${label}: ${(e as Error).message}`); }
}

const fact = (value: string | number): Fact => ({ value, confidence: 70, evidence: 'x', source_url: 'https://x/', access_level: 'live_official_site' });

// ── Cornerstone "good" coverage: homepage + rendered staff + contact + about ──
const givingText = 'Give online. Set up recurring giving. Apple Pay and text to give. Powered by Pushpay. Watch our livestream on YouTube. Download our app on Church Center.';
const goodFindings: SourceFinding[] = [
  makeFinding({ sourceType: 'official_site', accessLevel: 'live_official_site', url: 'https://www.cornerstonechurch.info/', category: 'home', fetched: true, status: 200, crawlMethod: 'fetch', text: `Welcome to Cornerstone Church in Akron. ${givingText} ${'We gather weekly. '.repeat(20)}` }),
  makeFinding({ sourceType: 'staff_page', accessLevel: 'live_official_site', url: 'https://www.cornerstonechurch.info/staff', category: 'staff', fetched: true, status: 200, crawlMethod: 'playwright_rendered', renderedTextLength: 3200, text: 'Jacob Young — Lead Pastor. Rachel Carpenter — Operations.' }),
  makeFinding({ sourceType: 'contact_page', accessLevel: 'live_official_site', url: 'https://www.cornerstonechurch.info/contact', category: 'contact', fetched: true, status: 200, crawlMethod: 'fetch', text: 'Get in touch.' }),
  makeFinding({ sourceType: 'about_history', accessLevel: 'live_official_site', url: 'https://www.cornerstonechurch.info/about', category: 'about', fetched: true, status: 200, crawlMethod: 'fetch', text: `About Cornerstone. ${'Our story spans decades of ministry. '.repeat(12)}` }),
];
const goodFacts: Facts = {
  lead_pastor: fact('Jacob Young'),
  operations_leader: fact('Rachel Carpenter'),
  staff_count: fact(9),
  office_email: fact('connect@cornerstonechurch.info'),
  office_phone: fact('+13306443937'),
};

// ── "bad" coverage: homepage only, no staff/contact/about, no facts ──
const badFindings: SourceFinding[] = [
  makeFinding({ sourceType: 'official_site', accessLevel: 'live_official_site', url: 'https://x/', category: 'home', fetched: true, status: 200, crawlMethod: 'fetch', text: 'Welcome. Sundays at 10am.' }),
];
const badFacts: Facts = {};

async function main() {
  console.log('Coverage-aware confidence (Cornerstone regression)');

  const goodDigital = detectDigitalSignals(goodFindings);
  const goodCov = computeCoverage(goodFindings, [], goodFacts, goodDigital);
  const badDigital = detectDigitalSignals(badFindings);
  const badCov = computeCoverage(badFindings, [], badFacts, badDigital);

  const staff = goodCov.find((c) => c.category === 'staff')!;
  check('staff coverage reported found/fetched/rendered/useful', () => {
    assert.ok(staff.found && staff.fetched && staff.rendered && staff.useful, JSON.stringify(staff));
  });
  check('staff coverage note shows roles detected', () => assert.match(staff.note, /roles detected/));

  const contact = goodCov.find((c) => c.category === 'contact')!;
  check('contact coverage useful (email/phone collected)', () => assert.ok(contact.useful));
  const about = goodCov.find((c) => c.category === 'about')!;
  check('about coverage useful', () => assert.ok(about.fetched && about.useful));

  // Digital signals detected from the homepage giving block.
  check('digital signals detected (>= 4)', () => assert.ok(goodDigital.signalsDetected >= 4, `n=${goodDigital.signalsDetected}`));
  check('platforms detected: Pushpay + Church Center', () => assert.ok(goodDigital.platforms.includes('Pushpay') && goodDigital.platforms.includes('Church Center')));
  check('recurring + text-to-give detected', () => assert.ok(goodDigital.recurring_giving && goodDigital.text_to_give));

  // Coverage-aware confidence: HIGH with rendered staff + roles, LOW when missing.
  const sdGood = scoreConfidence('staff_depth_score', goodCov, goodDigital);
  const sdBad = scoreConfidence('staff_depth_score', badCov, badDigital);
  check('staff_depth confidence HIGH when staff rendered + roles', () => assert.strictEqual(sdGood.tier, 'High'));
  check('staff_depth confidence LOW + reason when staff unavailable', () => { assert.strictEqual(sdBad.tier, 'Low'); assert.match(sdBad.reason, /staff page unavailable/); });
  check('staff_depth confidence improved with coverage', () => assert.ok(sdGood.confidence > sdBad.confidence));

  const dmGood = scoreConfidence('digital_maturity_score', goodCov, goodDigital);
  const dmBad = scoreConfidence('digital_maturity_score', badCov, badDigital);
  check('digital_maturity confidence HIGH with signals, LOW without', () => { assert.strictEqual(dmGood.tier, 'High'); assert.strictEqual(dmBad.tier, 'Low'); });

  const cGood = contactabilityConfidence(goodCov);
  const cBad = contactabilityConfidence(badCov);
  check('contactability confidence HIGH with contact+staff, LOW without', () => { assert.strictEqual(cGood.tier, 'High'); assert.strictEqual(cBad.tier, 'Low'); });
  check('contactability confidence improved with coverage', () => assert.ok(cGood.confidence > cBad.confidence));

  // The required-evidence-incomplete signal: bad coverage flags required gaps.
  check('bad coverage marks required categories not useful', () => {
    const missing = badCov.filter((c) => c.required && !c.useful).map((c) => c.category);
    assert.ok(missing.includes('staff') && missing.includes('contact') && missing.includes('about'));
  });

  console.log(failures ? `\nFAILED (${failures})` : '\nALL PASSED');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
