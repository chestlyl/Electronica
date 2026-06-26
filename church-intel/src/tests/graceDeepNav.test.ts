/**
 * Regression: large multi-campus churches that bury leadership under a DEEP path
 * (`/about/leaders/`) rather than a small-church root (`/staff`, `/leadership`).
 *
 * Modeled on the publicly-observable structure of Grace Church (Bath, OH /
 * gracechurches.org), found via web search: its leadership lives at
 * `/about/leaders/` and campuses sit on per-campus subdomains. The STAFF NAMES
 * and CONTACTS below are SYNTHETIC fixture values — only the URL structure is
 * real; nothing here was tool-discovered about actual Grace staff.
 *
 * Guards two bugs that previously made such sites yield no staff (→ unknown
 * attendance, since the attendance pattern keys off staff):
 *   1. categorizeLink tagged `/about/leaders` as 'about' (because 'about' was
 *      checked before 'leadership') — the leadership page was never recognized.
 *   2. the fallback probe list only knew small-church roots, so a JS-injected
 *      nav left `/about/leaders` undiscoverable.
 *
 *   (run via `npm run test`)
 */
import assert from 'node:assert';

// Deterministic + fast: no Playwright, no robots fetch, no polite delay.
process.env.FORCE_FETCH_FALLBACK = 'true';
process.env.RESPECT_ROBOTS = 'false';
process.env.CRAWL_DELAY_MS = '0';

// Homepage links to leadership ONLY via the deep /about/leaders path.
const HOME = `<html><head><title>Grace Church</title></head><body>
<nav>
  <a href="/">Home</a>
  <a href="/about">About</a>
  <a href="/about/leaders">Leaders</a>
  <a href="/locations">Campuses</a>
  <a href="/contact">Contact</a>
</nav>
<p>Grace Church is a multi-campus church serving northeast Ohio across our Bath,
Norton, Barberton, and Medina campuses. Join us this weekend for worship and
teaching as one church in many locations.</p>
</body></html>`;
const LEADERS = `<html><head><title>Leaders</title></head><body>
<h1>Our Lead Team</h1>
<p>Jordan Vale is the Lead Pastor of Grace Church.</p>
<p>Morgan Diaz serves as the Executive Pastor, and Avery Boone is the Pastor of
Family Ministries. Reach the office at office@graceexample.org or (330) 555-0100.</p>
</body></html>`;
const ABOUT = `<html><head><title>About</title></head><body>
<h1>About Grace Church</h1><p>Grace Church began in 1955 and has grown into a
multi-campus family across the region.</p></body></html>`;

// Scenario B: JS-injected nav — homepage raw HTML has no subpage links at all,
// so /about/leaders is reachable ONLY via the widened fallback probe list.
const HOME_JS = `<html><head><title>Grace Church</title></head><body>
<div id="root"></div>
<noscript>Grace Church — a multi-campus church in northeast Ohio.</noscript>
</body></html>`;

const SITES: Record<string, string> = {
  'gracechurches.org/': HOME,
  'gracechurches.org/about': ABOUT,
  'gracechurches.org/about/leaders': LEADERS,
  'jsnav.gracechurches.org/': HOME_JS,
  'jsnav.gracechurches.org/about/leaders': LEADERS,
};

(globalThis as any).fetch = async (input: any) => {
  const url = typeof input === 'string' ? input : input.url;
  const u = new URL(url);
  const html = SITES[`${u.host}${u.pathname}`];
  if (html == null) return new Response('not found', { status: 404, headers: { 'content-type': 'text/html' } });
  return new Response(html, { status: 200, headers: { 'content-type': 'text/html' } });
};

let failures = 0;
function check(label: string, fn: () => void) {
  try { fn(); console.log(`  ✓ ${label}`); } catch (e) { failures++; console.log(`  ✗ ${label}: ${(e as Error).message}`); }
}

async function main() {
  console.log('Grace deep-nav leadership recovery (/about/leaders categorization + probe)');

  const { categorizeLink } = await import('../research/discover.js');
  const { FetchResearch } = await import('../research/fetchCrawler.js');
  const { collectWebsite } = await import('../research/sources/website.js');
  const { extractFacts } = await import('../research/extractors.js');

  // (1) categorization: the core bug fix — /about/leaders is leadership, not about.
  check('categorizeLink: /about/leaders → leadership (NOT about)', () => assert.strictEqual(categorizeLink('/about/leaders', 'Leaders'), 'leadership'));
  check('categorizeLink: /about/our-team → staff', () => assert.strictEqual(categorizeLink('/about/our-team', 'Our Team'), 'staff'));
  check('categorizeLink: plain /about still → about (regression)', () => assert.strictEqual(categorizeLink('/about', 'About'), 'about'));
  check('categorizeLink: /people → staff', () => assert.strictEqual(categorizeLink('/people', 'Our People'), 'staff'));
  // Crawl Expansion: giving / sermons / groups / jobs are now first-class pages.
  check('categorizeLink: /give → giving', () => assert.strictEqual(categorizeLink('/give', 'Give'), 'giving'));
  check('categorizeLink: /messages → sermons', () => assert.strictEqual(categorizeLink('/messages', 'Watch Messages'), 'sermons'));
  check('categorizeLink: /groups → groups (not ministries)', () => assert.strictEqual(categorizeLink('/groups', 'Groups'), 'groups'));
  check('categorizeLink: /careers → jobs', () => assert.strictEqual(categorizeLink('/careers', 'Careers'), 'jobs'));
  check('categorizeLink: /ministries → ministries (groups moved out)', () => assert.strictEqual(categorizeLink('/ministries', 'Ministries'), 'ministries'));

  // (2)+(3) homepage anchor → /about/leaders selected, crawled, mined
  const ctx = {
    name: 'Grace Church', city: 'Bath', state: 'OH',
    originalWebsite: 'https://gracechurches.org/', alternateName: null,
    identity: {} as any, officialSite: 'https://gracechurches.org/',
    research: new FetchResearch(),
  };
  const findings = await collectWebsite(ctx as any);
  const home = findings.find((f) => new URL(f.url).pathname === '/');
  const diag = home?.linkDiagnostics ?? [];

  check('leaders link categorized as leadership + selected', () => {
    const d = diag.find((x) => x.href === '/about/leaders');
    assert.ok(d, 'no /about/leaders diagnostic');
    assert.strictEqual(d!.category, 'leadership');
    assert.ok(d!.selected && d!.fetched);
  });
  check('/about/leaders page is in the crawled findings', () => assert.ok(findings.some((f) => new URL(f.url).pathname === '/about/leaders')));
  const facts = extractFacts(findings);
  check('lead_pastor recovered = Jordan Vale', () => assert.strictEqual(facts.lead_pastor?.value, 'Jordan Vale'));
  check('office_email recovered from leaders page', () => assert.strictEqual(facts.office_email?.value, 'office@graceexample.org'));

  // Scenario B: JS nav → /about/leaders reached only via the widened probe list
  const ctxB = {
    name: 'Grace Church', city: 'Bath', state: 'OH',
    originalWebsite: 'https://jsnav.gracechurches.org/', alternateName: null,
    identity: {} as any, officialSite: 'https://jsnav.gracechurches.org/',
    research: new FetchResearch(),
  };
  const findingsB = await collectWebsite(ctxB as any);
  const homeB = findingsB.find((f) => new URL(f.url).pathname === '/');
  const diagB = homeB?.linkDiagnostics ?? [];
  check('B: homepage exposed no crawlable subpage links (JS nav)', () => assert.ok(!diagB.some((d) => d.discovery === 'homepage_link' && d.selected)));
  check('B: /about/leaders reached via fallback probe', () => {
    const probe = diagB.find((d) => d.discovery === 'fallback_probe' && d.href === '/about/leaders');
    assert.ok(probe, 'no /about/leaders probe recorded');
    assert.ok(probe!.fetched);
  });
  const factsB = extractFacts(findingsB);
  check('B: lead_pastor recovered via probe = Jordan Vale', () => assert.strictEqual(factsB.lead_pastor?.value, 'Jordan Vale'));

  console.log(failures ? `\nFAILED (${failures})` : '\nALL PASSED');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
