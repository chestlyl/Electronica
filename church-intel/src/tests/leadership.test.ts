/**
 * Leadership evidence aggregation (co-lead pastors) — Our Finest Hour regression.
 *
 * Ground truth: Dan Zirkle and Jennifer Zirkle are CO-LEAD pastors. The extractor
 * must stop treating lead_pastor as a single first-match field and return BOTH.
 *
 * PROVENANCE: the Zirkle names/titles are USER-PROVIDED ground truth; page/finding
 * structure is SYNTHETIC. Nothing here was tool-discovered.
 *
 *   (run via `npm run test`)
 */
import assert from 'node:assert';
import { makeFinding, type SourceFinding } from '../research/dossier.js';
import { aggregateLeadership, leadPastors } from '../research/extractors.js';
import { extractStaffCards } from '../research/staffCards.js';

let failures = 0;
function check(label: string, fn: () => void) {
  try { fn(); console.log(`  ✓ ${label}`); } catch (e) { failures++; console.log(`  ✗ ${label}: ${(e as Error).message}`); }
}

async function main() {
  console.log('Leadership aggregation — OFH co-lead pastors');

  // ── From a rendered staff page (staff cards: both titled "Co-Lead Pastor") ──
  const STAFF_INNERTEXT = `Our Staff

Dan Zirkle
Co-Lead Pastor

Jennifer Zirkle
Co-Lead Pastor

Mark Stiles
Worship Director`;
  const cards = extractStaffCards(STAFF_INNERTEXT);
  const staffFinding: SourceFinding = makeFinding({
    sourceType: 'staff_page', accessLevel: 'live_official_site', url: 'https://www.ofhchurch.com/staff',
    title: 'Our Staff', fetched: true, status: 200, text: 'Our Staff. Dan Zirkle Co-Lead Pastor. Jennifer Zirkle Co-Lead Pastor.',
    staffCards: cards,
  });

  const leaders = aggregateLeadership([staffFinding]);
  const leads = leadPastors(leaders);
  const leadNames = leads.map((l) => l.name).sort();

  check('extractStaffCards found both Zirkles', () => {
    const names = cards.map((c) => c.name);
    assert.ok(names.includes('Dan Zirkle') && names.includes('Jennifer Zirkle'), JSON.stringify(names));
  });
  check('both co-lead pastors captured (not first-match)', () => assert.deepStrictEqual(leadNames, ['Dan Zirkle', 'Jennifer Zirkle']));
  check('each lead carries provenance (source + confidence + evidence)', () => {
    for (const l of leads) { assert.ok(l.sourceUrl.includes('ofhchurch.com')); assert.ok(l.confidence > 0); assert.ok(/co-lead pastor/i.test(l.title) || /co-lead pastor/i.test(l.evidence)); }
  });
  check('co-lead pastor flagged isLead=true', () => assert.ok(leads.every((l) => l.isLead)));
  check('non-lead staff (Worship Director) NOT a lead pastor', () => assert.ok(!leadNames.includes('Mark Stiles')));
  check('report-style join: "Dan Zirkle; Jennifer Zirkle"', () => {
    const display = leads.map((l) => l.name).join('; ');
    assert.ok(display.includes('Dan Zirkle') && display.includes('Jennifer Zirkle') && display.includes(';'), display);
  });

  // ── From snippet/text only (no staff cards) — must still capture both ──
  const textFinding: SourceFinding = makeFinding({
    sourceType: 'search', accessLevel: 'search_snippets', url: 'https://search.example/r',
    fetched: false, status: 200, title: 'Our Finest Hour',
    snippet: 'Dan Zirkle, Co-Lead Pastor. Jennifer Zirkle, Co-Lead Pastor. Visit us in Coweta, OK.',
  });
  const fromText = leadPastors(aggregateLeadership([textFinding])).map((l) => l.name).sort();
  check('text-only path also captures both co-lead pastors', () => assert.deepStrictEqual(fromText, ['Dan Zirkle', 'Jennifer Zirkle']));

  // ── Two people sharing plain "Lead Pastor" evidence → both returned ──
  const twoLeads: SourceFinding = makeFinding({
    sourceType: 'staff_page', accessLevel: 'live_official_site', url: 'https://x/staff', fetched: true, status: 200,
    text: 'staff', staffCards: [{ name: 'Alice Doe', title: 'Lead Pastor' }, { name: 'Bob Roe', title: 'Lead Pastor' }],
  });
  check('two people sharing Lead Pastor evidence → both returned', () => {
    const names = leadPastors(aggregateLeadership([twoLeads])).map((l) => l.name).sort();
    assert.deepStrictEqual(names, ['Alice Doe', 'Bob Roe']);
  });

  console.log(failures ? `\nFAILED (${failures})` : '\nALL PASSED');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
