/**
 * Safety tests for the classifyKind relaxation + result-level identity_confidence.
 *   - 14Six: church-provided URL + exact name + church content → true_match
 *     (even with weak/undetectable ownership nav)
 *   - row-3 garbage name → no_match
 *   - forneyconstruction (vendor) → never accepted
 *   - placeofhope FL (city conflict) → never accepted; result shows best score, not 0
 *
 *   (run via `npm run test`)
 */
import assert from 'node:assert';
import { discoverWebsite } from '../research/discovery.js';
import type { ResearchInput } from '../research/types.js';

const PAD = ' We gather every week for worship and to follow Jesus together as a church family in our city. Sundays bring music, teaching, prayer, and community for all ages and backgrounds welcome here.';

const PAGES: Record<string, string> = {
  // JS-rendered church site: church content but NO give/sermons/visit nav anchors
  'stantonchurch.org': `<title>Stanton Lighthouse Community</title><h1>Stanton Lighthouse Community</h1><p>We are a church.${PAD}</p>`,
  // parachurch resource
  'farmington.cbsclass.org': `<title>Community Bible Study Farmington</title><p>Community Bible Study class.${PAD}</p>`,
  // contractor portfolio ABOUT a church
  'forneyconstruction.com': `<title>Hope City Church | Forney Construction Portfolio</title><nav><a href="/portfolio">Portfolio</a></nav><h1>Hope City Church</h1><p>This design-build project. General contractor. Completed 45,000 square feet.${PAD}</p>`,
  // a DIFFERENT "Place of Hope" in FL
  'placeofhope.org': `<title>Place of Hope Church | Palm Beach Gardens, FL</title><meta property="og:title" content="Place of Hope, Palm Beach Gardens, FL"><h1>Place of Hope</h1><p>A church in Palm Beach Gardens, FL.${PAD}</p>`,
};

const SEARCH = ['html.duckduckgo.com', 'lite.duckduckgo.com', 'www.bing.com', 'www.mojeek.com'];
let RESULTS: { url: string; title: string }[] = [];
const ddg = (rs: { url: string; title: string }[]) => rs.map((r) => `result__body<a class="result__a" href="${r.url}">${r.title}</a><a class="result__snippet">s</a>`).join('\n');
(globalThis as any).fetch = async (input: any) => {
  const url = typeof input === 'string' ? input : input.url;
  const h = new URL(url).hostname;
  if (SEARCH.includes(h)) return new Response(ddg(RESULTS), { status: 200, headers: { 'content-type': 'text/html' } });
  const p = PAGES[h] || PAGES[h.replace(/^www\./, '')];
  if (p) return new Response(p, { status: 200, headers: { 'content-type': 'text/html' } });
  return new Response('x', { status: 404, headers: { 'content-type': 'text/html' } });
};

async function run(input: ResearchInput, results: { url: string; title: string }[]) {
  RESULTS = results;
  return discoverWebsite(input);
}

let failures = 0;
function check(label: string, fn: () => void) {
  try { fn(); console.log(`  ✓ ${label}`); } catch (e) { failures++; console.log(`  ✗ ${label}: ${(e as Error).message}`); }
}

async function main() {
  console.log('discovery identity safety');

  const r2 = await run(
    { name: '14Six', city: 'Westminster', state: 'CA', originalWebsite: 'https://www.stantonchurch.org', originalPhone: null, originalEmail: null, alternateName: 'Stanton Lighthouse Community' },
    [{ url: 'https://www.stantonchurch.org', title: 'Stanton Lighthouse Community' }],
  );
  check('row-2: 14Six accepts stantonchurch.org as true_match', () => {
    assert.ok(r2.officialSite && /stantonchurch\.org/.test(r2.officialSite), `officialSite=${r2.officialSite}`);
    assert.strictEqual(r2.identityVerdict, 'true_match');
    assert.ok(r2.identity_confidence >= 65, `identity_confidence=${r2.identity_confidence}`);
  });

  const r3 = await run(
    { name: '26:16:00', city: 'Farmington', state: 'NM', originalWebsite: null, originalPhone: null, originalEmail: null, alternateName: null },
    [{ url: 'https://farmington.cbsclass.org', title: 'CBS Farmington' }],
  );
  check('row-3: garbage name remains NO MATCH', () => {
    assert.strictEqual(r3.officialSite, null);
    assert.notStrictEqual(r3.identityVerdict, 'true_match');
  });

  const r4 = await run(
    { name: 'Hope City Church', city: 'Forney', state: 'TX', originalWebsite: null, originalPhone: null, originalEmail: null, alternateName: null },
    [{ url: 'https://forneyconstruction.com/portfolio/hope-city-church-the-woodlands/', title: 'Hope City Church' }],
  );
  check('row-4: forneyconstruction.com is NOT accepted', () => {
    assert.ok(!r4.officialSite || !/forneyconstruction/.test(r4.officialSite), `officialSite=${r4.officialSite}`);
    const vendor = r4.candidates.find((c) => /forneyconstruction/.test(c.host));
    assert.ok(vendor && vendor.kind === 'vendor_reference' && vendor.identityVerdict === 'no_match', `vendor=${JSON.stringify(vendor && { kind: vendor.kind, v: vendor.identityVerdict })}`);
  });

  const rFL = await run(
    { name: 'A Place of Hope', city: 'Forney', state: 'TX', originalWebsite: null, originalPhone: null, originalEmail: null, alternateName: null },
    [{ url: 'https://placeofhope.org/outreach', title: 'Place of Hope Church' }],
  );
  check('city-conflict (FL): not accepted', () => {
    assert.ok(!rFL.officialSite, `officialSite=${rFL.officialSite}`);
  });
  check('result-level identity_confidence reports best score (not 0)', () => {
    assert.ok(rFL.identity_confidence > 0, `identity_confidence=${rFL.identity_confidence}`);
  });

  console.log(failures ? `\nFAILED (${failures})` : '\nALL PASSED');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
