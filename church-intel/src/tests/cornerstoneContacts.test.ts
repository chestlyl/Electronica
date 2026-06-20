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
 * Scenario C: the /contact page exposes email/phone ONLY via mailto:/tel: links
 * (not in visible text), so the text-regex extractor misses them; the fallback
 * folds the crawler's structured finding.fields into office_email/office_phone,
 * preserving the finding's access level, and contactability becomes > 0. Plus a
 * rule-5 check that a higher-confidence text email is not overwritten.
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

// ── Scenario C: contacts exposed ONLY via mailto:/tel: links (no literal
// email/phone in the visible text). Mirrors the real /contact page.
const HOME_C = `<html><head><title>Cornerstone Church</title></head><body>
<nav><a href="/staff">Our Staff</a><a href="/contact">Contact</a></nav>
<p>Welcome to Cornerstone Church in Akron, Ohio. We gather Sundays at 9 and 11 AM
for worship and teaching as a church family in our city.</p></body></html>`;
const STAFF_C = `<html><head><title>Our Staff</title></head><body>
<div class="staff-card"><h3>Jacob Young</h3><p>Lead Pastor</p></div></body></html>`;
const CONTACT_C = `<html><head><title>Contact</title></head><body>
<h1>Get In Touch</h1><p>We would love to hear from you. Stop by this weekend.</p>
<a href="mailto:connect@cornerstonechurch.info">Email Us</a>
<a href="tel:+13306443937">Call Us</a></body></html>`;

// Keyed by host+path so the scenarios don't collide.
const SITES: Record<string, string> = {
  'cornerstonechurch.info/': HOME,
  'cornerstonechurch.info/o/7f3a': STAFF,
  'cornerstonechurch.info/o/9c2d': CONNECT,
  'cornerstonechurch.info/o/1a0b': ABOUT,
  'www.cornerstonechurch.info/': HOME_JS,
  'www.cornerstonechurch.info/staff': STAFF_JS,
  'c.cornerstonechurch.info/': HOME_C,
  'c.cornerstonechurch.info/staff': STAFF_C,
  'c.cornerstonechurch.info/contact': CONTACT_C,
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

  // ── Scenario C: mailto/tel-only contact page → fallback fills facts ───────
  const { deriveContactability } = await import('../research/calibrationSet.js');
  const ctxC = {
    name: 'Cornerstone Church', city: 'Akron', state: 'OH',
    originalWebsite: 'https://c.cornerstonechurch.info/', alternateName: null,
    identity: {} as any,
    officialSite: 'https://c.cornerstonechurch.info/',
    research: new FetchResearch(),
  };
  const findingsC = await collectWebsite(ctxC as any);
  const contactC = findingsC.find((f) => new URL(f.url).pathname === '/contact');
  check('C: /contact page crawled', () => assert.ok(contactC));
  check('C: visible text does NOT contain the email/phone (mailto/tel only)',
    () => assert.ok(!(contactC?.text ?? '').includes('connect@cornerstonechurch.info') && !(contactC?.text ?? '').includes('3306443937')));
  check('C: crawler captured email/phone into finding.fields',
    () => assert.ok(contactC!.fields.some((x) => x.field_name === 'email') && contactC!.fields.some((x) => x.field_name === 'phone')));
  const factsC = extractFacts(findingsC);
  check('C: fallback fills office_email from mailto field', () => assert.strictEqual(factsC.office_email?.value, 'connect@cornerstonechurch.info'));
  check('C: fallback fills office_phone from tel field', () => assert.strictEqual(factsC.office_phone?.value, '+13306443937'));
  check('C: office_email preserves access level from the finding', () => assert.strictEqual(factsC.office_email?.access_level, 'live_official_site'));
  check('C: contactability score > 0 with recovered contacts', () => {
    const fields = { office_email: { value: factsC.office_email!.value, confidence: factsC.office_email!.confidence }, office_phone: { value: factsC.office_phone!.value, confidence: factsC.office_phone!.confidence }, lead_pastor: { value: factsC.lead_pastor?.value ?? null, confidence: 50 } } as any;
    const ctb = deriveContactability({} as any, fields, 'live_official_site');
    assert.ok(Number(ctb.value) > 0, `contactability=${ctb.value}`);
  });

  // Rule 5: a higher-confidence text-derived email is NOT overwritten by a
  // lower-confidence structured field on the same finding.
  const mixed = makeFinding({
    sourceType: 'official_site', accessLevel: 'live_official_site', url: 'https://c.cornerstonechurch.info/about',
    title: 'About', fetched: true, status: 200,
    text: 'For ministry questions email office@cornerstonechurch.info anytime.',
    fields: [{ field_name: 'email', value: 'noreply@vendor.example', confidence: 30, evidence_text: 'mailto', source_url: 'https://c.cornerstonechurch.info/about', source_type: 'official_site', access_level: 'live_official_site' }],
  });
  const factsMix = extractFacts([mixed]);
  check('rule 5: higher-confidence text email beats low-confidence mailto field',
    () => assert.strictEqual(factsMix.office_email?.value, 'office@cornerstonechurch.info'));

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
