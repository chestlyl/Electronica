/**
 * Regression: contact recovery for sites whose nav uses opaque URL paths with
 * descriptive anchor text (e.g. Cornerstone Church).
 *
 * Guards against the rendered-DOM-upgrade regression where link categorization
 * dropped anchor text (`categorizeLink(pathname, '')`) and the staff/connect
 * subpages were no longer crawled — nulling lead_pastor / office_email /
 * office_phone. Verifies:
 *   1. the homepage ALONE lacks Jacob Young / connect email / phone,
 *   2. the staff & connect subpages are reachable ONLY via anchor text
 *      (their URL paths are opaque: /o/<hash>),
 *   3. the crawler follows those links, and
 *   4. extractFacts recovers Jacob Young, connect@cornerstonechurch.info,
 *      330.644.3937.
 * Scenario B: JS-injected nav — the homepage raw HTML has no subpage links at
 * all, so /staff is reachable only via the targeted fallback probe (mirrors the
 * real https://www.cornerstonechurch.info/staff). Verifies the probe fetches it
 * and extractFacts recovers the same contacts; and that per-link crawl
 * diagnostics are recorded either way.
 *
 * Plus a snippet-fallback case: when no subpages exist, snippet evidence still
 * yields the contacts (snippet beats null).
 *
 *   (run via `npm run test`)
 */
import assert from 'node:assert';

// Deterministic + fast: no Playwright, no robots fetch, no polite delay.
process.env.FORCE_FETCH_FALLBACK = 'true';
process.env.RESPECT_ROBOTS = 'false';
process.env.CRAWL_DELAY_MS = '0';

const ORIGIN = 'https://cornerstonechurch.info';
const HOME = `<html><head><title>Cornerstone Church</title></head><body>
<nav>
  <a href="/o/4821">Home</a>
  <a href="/o/7f3a">Our Staff</a>
  <a href="/o/9c2d">Connect</a>
  <a href="/o/1a0b">About</a>
</nav>
<p>Welcome to Cornerstone Church in Akron, Ohio. We gather every Sunday for
worship, teaching, and community. Whether you are new to faith or have followed
Jesus for years, there is a place for you here at Cornerstone. Join us this
weekend and discover what God is doing in our church family.</p>
</body></html>`;
// Opaque path, contact only reachable by following the "Our Staff" / "Connect"
// anchor TEXT — the URL path carries no keyword.
const STAFF = `<html><head><title>Our Staff</title></head><body>
<h1>Meet Our Team</h1>
<p>Jacob Young is the Lead Pastor of Cornerstone Church.</p>
</body></html>`;
const CONNECT = `<html><head><title>Connect</title></head><body>
<h1>Connect With Us</h1>
<p>Email us at connect@cornerstonechurch.info or call 330.644.3937.</p>
</body></html>`;
const ABOUT = `<html><head><title>About</title></head><body>
<h1>About Cornerstone</h1><p>Cornerstone Church was planted in 1998.</p>
</body></html>`;

// ── Scenario B: JS-injected nav. The homepage raw HTML contains NO subpage
// links at all (nav is built by JS); /staff is reachable ONLY by probing the
// well-known path. Mirrors the real https://www.cornerstonechurch.info/staff.
const HOME_JS = `<html><head><title>Cornerstone Church</title></head><body>
<div id="root"></div>
<noscript>Welcome to Cornerstone Church in Akron.</noscript>
</body></html>`;
const STAFF_JS = `<html><head><title>Our Staff</title></head><body>
<h1>Our Staff</h1>
<p>Jacob Young is the Lead Pastor. Email connect@cornerstonechurch.info or call 330.644.3937.</p>
</body></html>`;

// Keyed by host+path so the two scenarios (bare host vs www host) don't collide.
const SITES: Record<string, string> = {
  'cornerstonechurch.info/': HOME,
  'cornerstonechurch.info/o/7f3a': STAFF,
  'cornerstonechurch.info/o/9c2d': CONNECT,
  'cornerstonechurch.info/o/1a0b': ABOUT,
  'www.cornerstonechurch.info/': HOME_JS,
  'www.cornerstonechurch.info/staff': STAFF_JS,
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
  console.log('Cornerstone contact recovery (anchor-text link categorization + snippet fallback)');

  const { FetchResearch } = await import('../research/fetchCrawler.js');
  const { collectWebsite } = await import('../research/sources/website.js');
  const { extractFacts } = await import('../research/extractors.js');
  const { makeFinding } = await import('../research/dossier.js');

  const ctx = {
    name: 'Cornerstone Church', city: 'Akron', state: 'OH',
    originalWebsite: `${ORIGIN}/`, alternateName: null,
    identity: {} as any,
    officialSite: `${ORIGIN}/`,
    research: new FetchResearch(),
  };

  const findings = await collectWebsite(ctx as any);

  // (2)+(3) the opaque-path subpages were discovered via anchor text and crawled
  check('staff subpage crawled (opaque path, found via "Our Staff" text)',
    () => assert.ok(findings.some((f) => f.url.includes('/o/7f3a'))));
  check('connect subpage crawled (opaque path, found via "Connect" text)',
    () => assert.ok(findings.some((f) => f.url.includes('/o/9c2d'))));

  // (1) homepage alone must NOT contain the contacts
  const home = findings.find((f) => new URL(f.url).pathname === '/');
  check('homepage finding exists', () => assert.ok(home));
  check('homepage text lacks the lead pastor name', () => assert.ok(!(home?.text ?? '').includes('Jacob Young')));
  check('homepage text lacks the office email', () => assert.ok(!(home?.text ?? '').includes('connect@cornerstonechurch.info')));

  // Crawl link diagnostics are recorded on the home finding
  const diag = home?.linkDiagnostics ?? [];
  check('link diagnostics captured for homepage', () => assert.ok(diag.length >= 3));
  check('diagnostics show "Our Staff" link selected + fetched + signal', () => {
    const staffLink = diag.find((d) => d.anchorText === 'Our Staff');
    assert.ok(staffLink, 'no Our Staff diagnostic');
    assert.strictEqual(staffLink!.category, 'staff');
    assert.ok(staffLink!.selected && staffLink!.fetched);
    assert.ok(staffLink!.hasStaffContactSignal);
  });
  check('diagnostics show "Home" link not selected (no category)', () => {
    const h = diag.find((d) => d.anchorText === 'Home');
    assert.ok(h && !h.selected && h.category == null);
  });

  // (4) extractFacts recovers all three from the crawled subpages
  const facts = extractFacts(findings);
  check('lead_pastor recovered = Jacob Young', () => assert.strictEqual(facts.lead_pastor?.value, 'Jacob Young'));
  check('office_email recovered = connect@cornerstonechurch.info', () => assert.strictEqual(facts.office_email?.value, 'connect@cornerstonechurch.info'));
  check('office_phone recovered = 330.644.3937', () => assert.strictEqual(facts.office_phone?.value, '330.644.3937'));

  // ── Scenario B: /staff only reachable via the fallback probe ──────────────
  const ctxB = {
    name: 'Cornerstone Church', city: 'Akron', state: 'OH',
    originalWebsite: 'https://www.cornerstonechurch.info/', alternateName: null,
    identity: {} as any,
    officialSite: 'https://www.cornerstonechurch.info/',
    research: new FetchResearch(),
  };
  const findingsB = await collectWebsite(ctxB as any);
  const homeB = findingsB.find((f) => new URL(f.url).pathname === '/');
  const diagB = homeB?.linkDiagnostics ?? [];

  check('B: homepage exposed no crawlable subpage links (JS nav)',
    () => assert.ok(!diagB.some((d) => d.discovery === 'homepage_link' && d.selected)));
  check('B: /staff reached via fallback probe (fetched)', () => {
    const probe = diagB.find((d) => d.discovery === 'fallback_probe' && d.href === '/staff');
    assert.ok(probe, 'no /staff probe recorded');
    assert.ok(probe!.fetched && probe!.hasStaffContactSignal);
  });
  check('B: /staff page is in the crawled findings',
    () => assert.ok(findingsB.some((f) => new URL(f.url).pathname === '/staff')));
  const factsB = extractFacts(findingsB);
  check('B: lead_pastor recovered via probe = Jacob Young', () => assert.strictEqual(factsB.lead_pastor?.value, 'Jacob Young'));
  check('B: office_email recovered via probe', () => assert.strictEqual(factsB.office_email?.value, 'connect@cornerstonechurch.info'));
  check('B: office_phone recovered via probe', () => assert.strictEqual(factsB.office_phone?.value, '330.644.3937'));

  // Snippet fallback: a thin live homepage + snippet evidence → contacts survive.
  const homepageOnly = makeFinding({
    sourceType: 'official_site', accessLevel: 'live_official_site', url: `${ORIGIN}/`,
    title: 'Cornerstone Church', fetched: true, status: 200,
    text: 'Welcome to Cornerstone Church. Service times are Sundays at 10am.',
  });
  const snippet = makeFinding({
    sourceType: 'search', accessLevel: 'search_snippets', url: 'https://search.example/r',
    title: 'Cornerstone Church', fetched: false, status: 200,
    snippet: 'Jacob Young is the Lead Pastor. Email connect@cornerstonechurch.info or call 330.644.3937.',
  });
  snippet.reliability = 0.5;
  const ff = extractFacts([homepageOnly, snippet]);
  check('snippet fallback: lead_pastor from snippet when homepage thin', () => assert.strictEqual(ff.lead_pastor?.value, 'Jacob Young'));
  check('snippet fallback: office_email from snippet', () => assert.strictEqual(ff.office_email?.value, 'connect@cornerstonechurch.info'));
  check('snippet fallback: office_phone from snippet', () => assert.strictEqual(ff.office_phone?.value, '330.644.3937'));

  console.log(failures ? `\nFAILED (${failures})` : '\nALL PASSED');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
