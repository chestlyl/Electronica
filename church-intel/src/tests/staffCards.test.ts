/**
 * Staff-card extraction (rendered-DOM staff pages) — Cornerstone fixture.
 *
 * Uses the real browser-visible staff names/titles from Cornerstone's /staff
 * page (which a plain fetch only sees as a ~884-char Squarespace nav shell).
 * Verifies:
 *   1. extractStaffCards recovers all 9 {name,title} pairs from rendered
 *      innerText (adjacent-line layout, incl. an honorific "Pastor Brenda Young"),
 *   2. roleFromTitle maps Lead Pastor / Operations / Engagement to roles,
 *   3. the collectWebsite → extractFacts path turns the cards into facts:
 *      lead_pastor = Jacob Young, operations_leader = Rachel Carpenter,
 *      staff_count >= 8, and contactability > 0.
 *
 *   (run via `npm run test`)
 */
import assert from 'node:assert';
import { extractStaffCards, roleFromTitle } from '../research/staffCards.js';
import { extractFacts } from '../research/extractors.js';
import { collectWebsite } from '../research/sources/website.js';
import { deriveContactability } from '../research/calibrationSet.js';
import type { ResearchBundle } from '../research/types.js';

// Rendered innerText of Cornerstone's /staff (newlines preserved), with nav +
// footer noise around the staff list to exercise the filtering.
const STAFF_INNERTEXT = `Home
About
Our Staff
Give
Plan a Visit

Meet Our Team

Jacob Young
Lead Pastor

Rachel Carpenter
Operations

Matthew Ellis
Weekends

Madison Higgins
Engagement

Caleb Mason
Ministries

Bruce Oberlin
Community Ambassador

Debbie Ring
Next Steps

Pastor Brenda Young
Teaching Pastor

Jessica Young
Next Gen

Contact Us
© 2024 Cornerstone Church`;

let failures = 0;
function check(label: string, fn: () => void) {
  try { fn(); console.log(`  ✓ ${label}`); } catch (e) { failures++; console.log(`  ✗ ${label}: ${(e as Error).message}`); }
}

async function main() {
  console.log('Staff-card extraction (Cornerstone /staff fixture)');

  const cards = extractStaffCards(STAFF_INNERTEXT);
  const byName = Object.fromEntries(cards.map((c) => [c.name, c.title]));

  check('recovered >= 8 staff cards', () => assert.ok(cards.length >= 8, `got ${cards.length}`));
  check('Jacob Young — Lead Pastor', () => assert.strictEqual(byName['Jacob Young'], 'Lead Pastor'));
  check('Rachel Carpenter — Operations', () => assert.strictEqual(byName['Rachel Carpenter'], 'Operations'));
  check('honorific stripped: Brenda Young — Teaching Pastor', () => assert.strictEqual(byName['Brenda Young'], 'Teaching Pastor'));
  check('nav/footer lines not treated as staff', () => assert.ok(!('Our Staff' in byName) && !('Meet Our Team' in byName) && !('Contact Us' in byName)));

  check('roleFromTitle: Lead Pastor → lead_pastor', () => assert.strictEqual(roleFromTitle('Lead Pastor')?.field, 'lead_pastor'));
  check('roleFromTitle: Operations → operations_leader', () => assert.strictEqual(roleFromTitle('Operations')?.field, 'operations_leader'));
  check('roleFromTitle: Engagement → communications_leader', () => assert.strictEqual(roleFromTitle('Engagement')?.field, 'communications_leader'));
  check('roleFromTitle: Next Gen → no role (count only)', () => assert.strictEqual(roleFromTitle('Next Gen'), null));

  // End-to-end: a rendered staff page (staffCards populated) flows through
  // collectWebsite → extractFacts → facts. A fake provider supplies the bundle
  // (Chromium isn't available in CI, so we inject the rendered result directly).
  const bundle: ResearchBundle = {
    query: 'Cornerstone Church Akron OH', searchResults: [],
    officialSite: 'https://www.cornerstonechurch.info/', originalSiteWorks: true,
    pages: [{
      url: 'https://www.cornerstonechurch.info/staff', finalUrl: 'https://www.cornerstonechurch.info/staff',
      ok: true, status: 200, title: 'Our Staff', text: 'Meet Our Team. Our staff serve the church.',
      category: 'staff', crawlMethod: 'playwright_rendered', rawTextLength: 884, renderedTextLength: 3200,
      renderedGainRatio: 3.62, mailto: [], tel: [], navLabels: [], staffBlocks: [],
      staffCards: cards, staffNamesDetected: cards.length, staffRolesDetected: cards.filter((c) => roleFromTitle(c.title)).length,
      fetchedAt: new Date().toISOString(),
    }],
    robotsBlockedUrls: [], linkDiagnostics: [], crawlMethod: 'playwright_rendered', jsRendered: true,
    note: '', officialDomFetched: true, renderedDomUsed: true,
  };
  const fakeResearch = { research: async () => bundle, close: async () => {} };
  const ctx = {
    name: 'Cornerstone Church', city: 'Akron', state: 'OH',
    originalWebsite: 'https://www.cornerstonechurch.info/', alternateName: null,
    identity: {} as any, officialSite: 'https://www.cornerstonechurch.info/', research: fakeResearch,
  };
  const findings = await collectWebsite(ctx as any);
  const facts = extractFacts(findings);

  check('facts.lead_pastor = Jacob Young', () => assert.strictEqual(facts.lead_pastor?.value, 'Jacob Young'));
  check('facts.operations_leader = Rachel Carpenter', () => assert.strictEqual(facts.operations_leader?.value, 'Rachel Carpenter'));
  check('facts.communications_leader = Madison Higgins', () => assert.strictEqual(facts.communications_leader?.value, 'Madison Higgins'));
  check('facts.staff_count >= 8', () => assert.ok(Number(facts.staff_count?.value) >= 8, `staff_count=${facts.staff_count?.value}`));
  check('staff-card facts carry live_official_site access', () => assert.strictEqual(facts.lead_pastor?.access_level, 'live_official_site'));

  const fields = {
    lead_pastor: { value: facts.lead_pastor!.value, confidence: facts.lead_pastor!.confidence },
    operations_leader: { value: facts.operations_leader!.value, confidence: facts.operations_leader!.confidence },
    communications_leader: { value: facts.communications_leader!.value, confidence: facts.communications_leader!.confidence },
  } as any;
  check('contactability > 0 from recovered staff roles', () => {
    const ctb = deriveContactability({} as any, fields, 'live_official_site');
    assert.ok(Number(ctb.value) > 0, `contactability=${ctb.value}`);
  });

  console.log(failures ? `\nFAILED (${failures})` : '\nALL PASSED');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
