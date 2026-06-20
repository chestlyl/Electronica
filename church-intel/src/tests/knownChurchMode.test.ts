/**
 * Known-church vs market-discovery mode (workflow/product-mode behavior).
 *
 * Known-church mode anchors on the PROVIDED url and never runs broad discovery,
 * so a third-party page (funeral obituary, directory, vendor, article) can never
 * be substituted as the official site. Market-discovery mode is unchanged.
 *
 *   (run via `npm run test`)
 */
import assert from 'node:assert';
import { discoverWebsite } from '../research/discovery.js';
import { requireCalibrationUrl, KNOWN_CHURCH_URL_REQUIRED } from '../research/calibrationSet.js';
import type { ResearchInput } from '../research/types.js';

const PAD = ' We gather every week for worship and to follow Jesus together as a church family in our city.';
const PAGES: Record<string, string> = {
  'ofhchurch.com': `<title>Our Finest Hour Church | Broken Arrow, OK</title><nav><a href="/give">Give</a><a href="/sermons">Sermons</a><a href="/visit">Plan a Visit</a></nav><h1>Our Finest Hour Church</h1><p>We are a church in Broken Arrow, OK. Plan your visit. Give online. Sermons.${PAD}</p>`,
  'brownfamilycares.com': `<title>Elverta Griffin Obituary | Brown Family Cares</title><nav><a href="/obituaries">Obituaries</a></nav><h1>Elverta Griffin</h1><p>Funeral service at Our Finest Hour Church.</p>`,
  'oklahomachurches.com': `<title>Our Finest Hour - Oklahoma Churches Directory</title><h1>Our Finest Hour</h1><p>Directory listing for Our Finest Hour.${PAD}</p>`,
  'parkedsite.com': `<title>Domain for sale</title><p>buy this domain</p>`,
};
const SEARCH = ['html.duckduckgo.com', 'lite.duckduckgo.com', 'www.bing.com', 'www.mojeek.com'];
let RESULTS: { url: string; title: string }[] = [];
const ddg = (rs: { url: string; title: string }[]) => rs.map((r) => `result__body<a class="result__a" href="${r.url}">${r.title}</a><a class="result__snippet">s</a>`).join('\n');
(globalThis as any).fetch = async (input: any) => {
  const url = typeof input === 'string' ? input : input.url;
  const h = new URL(url).hostname;
  if (SEARCH.includes(h)) return new Response(ddg(RESULTS), { status: 200, headers: { 'content-type': 'text/html' } });
  const p = PAGES[h] || PAGES[h.replace(/^www\./, '')];
  return p ? new Response(p, { status: 200, headers: { 'content-type': 'text/html' } }) : new Response('x', { status: 404, headers: { 'content-type': 'text/html' } });
};

let failures = 0;
function check(label: string, fn: () => void | Promise<void>) {
  return Promise.resolve().then(fn).then(() => console.log(`  ✓ ${label}`)).catch((e) => { failures++; console.log(`  ✗ ${label}: ${(e as Error).message}`); });
}
const base: ResearchInput = { name: 'Our Finest Hour', city: 'Broken Arrow', state: 'OK', originalWebsite: null, originalPhone: null, originalEmail: null, alternateName: null };

async function main() {
  console.log('known-church vs market-discovery mode');

  // Known-church mode with the provided church URL — must anchor on it and NOT
  // even consider third-party pages, even when they appear in (ignored) search.
  RESULTS = [{ url: 'https://www.brownfamilycares.com/obituaries/Elverta-Griffin', title: 'Our Finest Hour Church Service — Obituary' }, { url: 'https://www.oklahomachurches.com/our-finest-hour', title: 'Our Finest Hour - Directory' }];
  const known = await discoverWebsite({ ...base, originalWebsite: 'https://www.ofhchurch.com/', mode: 'known_church' });
  await check('known: input_mode is known_church', () => assert.strictEqual(known.inputMode, 'known_church'));
  await check('known: officialSite is the provided ofhchurch.com', () => assert.ok(known.officialSite && /ofhchurch\.com/.test(known.officialSite), `officialSite=${known.officialSite}`));
  await check('known: website_verification_status = verified', () => assert.strictEqual(known.websiteVerificationStatus, 'verified'));
  await check('known: NEVER selects the funeral obituary', () => assert.ok(!known.officialSite || !/brownfamilycares/.test(known.officialSite)));
  await check('known: NEVER selects the directory', () => assert.ok(!known.officialSite || !/oklahomachurches/.test(known.officialSite)));
  await check('known: did not run broad discovery (only the provided URL was a candidate)', () => {
    assert.strictEqual(known.candidates.length, 1);
    assert.ok(/ofhchurch\.com/.test(known.candidates[0].host));
  });

  // Known-church mode where the provided URL is NOT church-owned → unverified,
  // and we do NOT substitute another site.
  const bad = await discoverWebsite({ ...base, originalWebsite: 'https://www.brownfamilycares.com/obituaries/Elverta-Griffin', mode: 'known_church' });
  await check('known: non-church provided URL → website_unverified', () => assert.strictEqual(bad.websiteVerificationStatus, 'unverified'));
  await check('known: unverified keeps provided URL as anchor (no substitute)', () => assert.ok(bad.officialSite && /brownfamilycares/.test(bad.officialSite)));
  await check('known: unverified explains why', () => assert.match(bad.note, /website_unverified/i));

  // Known-church mode with NO url → clear failure message, no discovery.
  const noUrl = await discoverWebsite({ ...base, originalWebsite: null, mode: 'known_church' });
  await check('known: missing URL → unverified + required-URL message', () => {
    assert.strictEqual(noUrl.websiteVerificationStatus, 'unverified');
    assert.ok(!noUrl.officialSite);
    assert.match(noUrl.note, /requires an official website URL/i);
  });
  await check('requireCalibrationUrl throws the exact message when url missing', () => {
    assert.throws(() => requireCalibrationUrl({ id: 'x', name: 'X', city: null, state: null, url: null }), new RegExp(KNOWN_CHURCH_URL_REQUIRED.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.strictEqual(requireCalibrationUrl({ id: 'x', name: 'X', city: null, state: null, url: 'https://x.org' }), 'https://x.org');
  });

  // Market-discovery mode remains separate: broad discovery still runs and the
  // church-owned domain wins over the directory/obituary.
  RESULTS = [{ url: 'https://www.brownfamilycares.com/obituaries/Elverta-Griffin', title: 'Our Finest Hour Church Service — Obituary' }, { url: 'https://www.ofhchurch.com/', title: 'Our Finest Hour Church' }];
  const market = await discoverWebsite({ ...base, originalWebsite: null, mode: 'market_discovery' });
  await check('market: input_mode is market_discovery', () => assert.strictEqual(market.inputMode, 'market_discovery'));
  await check('market: still discovers ofhchurch.com as official site', () => assert.ok(market.officialSite && /ofhchurch\.com/.test(market.officialSite), `officialSite=${market.officialSite}`));
  await check('market: obituary rejected', () => { const o = market.candidates.find((c) => /brownfamilycares/.test(c.host)); assert.ok(o && o.identityVerdict !== 'true_match'); });

  console.log(failures ? `\nFAILED (${failures})` : '\nALL PASSED');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
