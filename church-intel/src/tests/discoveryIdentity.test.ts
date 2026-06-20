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
  // a GENERIC "Christ Church" (different church) — shares only the token "christ"
  // with "Christ's Community Church"; has church-owned nav but NOT the full name
  // phrase and NOT the target city.
  'christchurch.org': `<title>Christ Church</title><h1>Christ Church</h1><p>We are a church. Plan your visit. Give online. Sermons.${PAD}</p>`,
  // the REAL church (church-provided URL, exact name phrase, target city)
  'cccaz.org': `<title>Christ's Community Church | Glendale, AZ</title><h1>Christ's Community Church</h1><p>A church in Glendale, AZ. Plan your visit. Give online. Sermons.${PAD}</p>`,
  // Our Finest Hour — the church's OWN site (church-owned domain, Coweta OK)
  'ofhchurch.com': `<title>Our Finest Hour Church | Coweta, OK</title><nav><a href="/give">Give</a><a href="/sermons">Sermons</a><a href="/visit">Plan a Visit</a></nav><h1>Our Finest Hour Church</h1><p>We are a church in Coweta, OK. Plan your visit. Give online. Sermons.${PAD}</p>`,
  // a general-directory LISTING of the same church — must NOT be taken for the church
  'oklahomachurches.com': `<title>Our Finest Hour - Oklahoma Churches Directory</title><h1>Our Finest Hour</h1><p>Directory listing for Our Finest Hour, a church in Coweta, OK. Browse and find churches near you.${PAD}</p>`,
  // THE ACTUAL OFH FAILURE: a funeral-home OBITUARY that MENTIONS the church (name
  // even in the title) but is NOT the church's own site — no church-owned nav, no
  // first-person church markers. It must never be crowned as the official church.
  'brownfamilycares.com': `<title>Our Finest Hour Church Service — Elverta Griffin Obituary | Brown Family Cares</title><nav><a href="/obituaries">Obituaries</a><a href="/flowers">Send Flowers</a><a href="/preplanning">Plan a Funeral</a></nav><h1>Elverta Griffin</h1><p>A funeral service for Elverta Griffin of Coweta, OK will be held at Our Finest Hour Church. Brown Family Cares is honored to serve the family. Send flowers or share a memory.</p>`,
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

  // Generic Christ-domain (search-discovered) must NOT become true_match for
  // "Christ's Community Church": no exact phrase, no city, not church-provided.
  const rGeneric = await run(
    { name: "Christ's Community Church", city: 'Glendale', state: 'AZ', originalWebsite: null, originalPhone: null, originalEmail: null, alternateName: null },
    [{ url: 'https://christchurch.org', title: 'Christ Church' }],
  );
  check('generic christchurch.org is NOT true_match (single generic token)', () => {
    assert.ok(!rGeneric.officialSite, `officialSite=${rGeneric.officialSite}`);
    const g = rGeneric.candidates.find((c) => /christchurch\.org/.test(c.host));
    assert.ok(g && g.identityVerdict !== 'true_match', `verdict=${g?.identityVerdict} id=${g?.identity_confidence}`);
    assert.ok(g && !g.nameStrong, 'single generic token should not be a strong name match');
  });

  // The REAL church still matches via church-provided URL + exact phrase + city,
  // and beats the generic decoy.
  const rReal = await run(
    { name: "Christ's Community Church", city: 'Glendale', state: 'AZ', originalWebsite: 'https://cccaz.org', originalPhone: null, originalEmail: null, alternateName: null },
    [{ url: 'https://christchurch.org', title: 'Christ Church' }],
  );
  check('real cccaz.org (provided + phrase + city) IS true_match', () => {
    assert.ok(rReal.officialSite && /cccaz\.org/.test(rReal.officialSite), `officialSite=${rReal.officialSite}`);
    assert.strictEqual(rReal.identityVerdict, 'true_match');
    const real = rReal.candidates.find((c) => /cccaz\.org/.test(c.host));
    assert.ok(real && real.namePhrase && real.cityStatus === 'match', `phrase=${real?.namePhrase} city=${real?.cityStatus}`);
  });

  // Our Finest Hour: the church-owned domain must win over the directory listing.
  const ofhResults = [
    { url: 'https://www.oklahomachurches.com/our-finest-hour-coweta', title: 'Our Finest Hour - Oklahoma Churches' },
    { url: 'https://www.ofhchurch.com/', title: 'Our Finest Hour Church' },
  ];
  const rOFH = await run(
    { name: 'Our Finest Hour', city: 'Coweta', state: 'OK', originalWebsite: null, originalPhone: null, originalEmail: null, alternateName: null },
    ofhResults,
  );
  check('OFH: ofhchurch.com becomes officialSite (church-owned beats directory)', () => {
    assert.ok(rOFH.officialSite && /ofhchurch\.com/.test(rOFH.officialSite), `officialSite=${rOFH.officialSite}`);
    assert.strictEqual(rOFH.identityVerdict, 'true_match');
  });
  check('OFH: oklahomachurches.com is general_directory, supporting only', () => {
    const dir = rOFH.candidates.find((c) => /oklahomachurches/.test(c.host));
    assert.ok(dir && dir.kind === 'general_directory', `kind=${dir?.kind}`);
    assert.notStrictEqual(dir?.identityVerdict, 'true_match');
  });

  // THE OFH FAILURE (regression): a funeral-home obituary mentioning the church —
  // even with the church name in its <title> — must NOT outrank the church's own
  // domain. Only ownership verification (church-owned nav / first-person markers on
  // its own site) may crown a winner; a mention can't. Before the ownership-gate
  // architecture this obituary was selected as official_church @ identity 95.
  const rObit = await run(
    { name: 'Our Finest Hour', city: 'Coweta', state: 'OK', originalWebsite: null, originalPhone: null, originalEmail: null, alternateName: null },
    [
      { url: 'https://www.brownfamilycares.com/obituaries/Elverta-Griffin', title: 'Our Finest Hour Church Service — Elverta Griffin Obituary' },
      { url: 'https://www.ofhchurch.com/', title: 'Our Finest Hour Church' },
    ],
  );
  check('OFH-obituary: ofhchurch.com (ownership-verified) is the official site', () => {
    assert.ok(rObit.officialSite && /ofhchurch\.com/.test(rObit.officialSite), `officialSite=${rObit.officialSite}`);
    assert.strictEqual(rObit.identityVerdict, 'true_match');
  });
  check('OFH-obituary: brownfamilycares.com is REJECTED as a church-owned property', () => {
    const obit = rObit.candidates.find((c) => /brownfamilycares/.test(c.host));
    assert.ok(obit, 'obituary candidate missing');
    assert.strictEqual(obit!.ownershipVerified, false);
    assert.notStrictEqual(obit!.kind, 'official_church');
    assert.notStrictEqual(obit!.identityVerdict, 'true_match');
  });
  check('OFH-obituary: the ownership-verified winner is the church domain', () => {
    const win = rObit.candidates.find((c) => c.accepted);
    assert.ok(win && /ofhchurch\.com/.test(win.host) && win.ownershipVerified, `winner=${win?.host} verified=${win?.ownershipVerified}`);
  });

  // If ONLY a directory exists, discovery returns no official site (not the directory).
  const rDirOnly = await run(
    { name: 'Our Finest Hour', city: 'Coweta', state: 'OK', originalWebsite: null, originalPhone: null, originalEmail: null, alternateName: null },
    [{ url: 'https://www.oklahomachurches.com/our-finest-hour-coweta', title: 'Our Finest Hour - Oklahoma Churches' }],
  );
  check('OFH: directory-only → NO official site (directory is not the church)', () => {
    assert.ok(!rDirOnly.officialSite, `officialSite=${rDirOnly.officialSite}`);
    const dir = rDirOnly.candidates.find((c) => /oklahomachurches/.test(c.host));
    assert.ok(dir && dir.kind === 'general_directory' && dir.identityVerdict !== 'true_match');
  });

  console.log(failures ? `\nFAILED (${failures})` : '\nALL PASSED');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
