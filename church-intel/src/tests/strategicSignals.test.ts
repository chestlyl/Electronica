/**
 * Strategic Signal layer — deterministic evidence collection (no score change).
 *
 * Verifies that outbound links / anchor text / hosts / page keywords are
 * captured, classified into the 16 strategic categories, preserved through the
 * finding model, mapped to the five strategic dimensions, and surfaced in
 * website-first order. Uses OFH (Our Finest Hour) evidence.
 *
 *   (run via `npm run test`)
 */
import assert from 'node:assert';
import {
  detectStrategicSignals,
  dimensionCounts,
  CATEGORY_DIMENSIONS,
  type StrategicSignal,
  type SignalCategory,
} from '../research/strategicSignals.js';
import { resolveOutboundLinks } from '../research/fetchCrawler.js';
import { makeFinding, type SourceFinding } from '../research/dossier.js';

let failures = 0;
function check(label: string, fn: () => void) {
  try { fn(); console.log(`  ✓ ${label}`); } catch (e) { failures++; console.log(`  ✗ ${label}: ${(e as Error).message}`); }
}
const has = (sigs: StrategicSignal[], cat: SignalCategory) => sigs.some((s) => s.category === cat);
const ofCat = (sigs: StrategicSignal[], cat: SignalCategory) => sigs.filter((s) => s.category === cat);

async function main() {
  console.log('Strategic Signal layer — deterministic evidence collection');

  // ── resolveOutboundLinks preserves external + internal links, dedups ──────
  check('resolveOutboundLinks resolves relative + keeps external links', () => {
    const out = resolveOutboundLinks([
      { href: '/give', text: 'Give' },
      { href: 'https://pushpay.com/g/ofh', text: 'Donate' },
      { href: 'mailto:x@y.com', text: 'Email' }, // dropped
      { href: '/give', text: 'Give' },            // dup → dropped
    ], 'https://www.ofhchurch.com/');
    const urls = out.map((o) => o.url);
    assert.ok(urls.includes('https://www.ofhchurch.com/give'));
    assert.ok(urls.includes('https://pushpay.com/g/ofh'));
    assert.ok(!urls.some((u) => u.startsWith('mailto:')));
    assert.strictEqual(urls.length, 2); // dedup + mailto dropped
  });

  // ── category → dimension mapping matches the product examples ─────────────
  check('Church Center (church_management) → digital_maturity, organizational_capacity, contactability', () =>
    assert.deepStrictEqual(CATEGORY_DIMENSIONS.church_management, ['digital_maturity', 'organizational_capacity', 'contactability']));
  check('Pushpay (giving) → digital_maturity, organizational_capacity', () =>
    assert.deepStrictEqual(CATEGORY_DIMENSIONS.giving, ['digital_maturity', 'organizational_capacity']));
  check('job posting (jobs_hiring) → growth, organizational_capacity, change_readiness', () =>
    assert.deepStrictEqual(CATEGORY_DIMENSIONS.jobs_hiring, ['growth_orientation', 'organizational_capacity', 'change_readiness']));
  check('residency (internship_residency) → growth, organizational_capacity, change_readiness', () =>
    assert.deepStrictEqual(CATEGORY_DIMENSIONS.internship_residency, ['growth_orientation', 'organizational_capacity', 'change_readiness']));
  check('podcast → digital_maturity, growth_orientation', () =>
    assert.deepStrictEqual(CATEGORY_DIMENSIONS.podcast, ['digital_maturity', 'growth_orientation']));
  check('school_academy → organizational_capacity, growth_orientation', () =>
    assert.deepStrictEqual(CATEGORY_DIMENSIONS.school_academy, ['organizational_capacity', 'growth_orientation']));
  check('newsletter_email (Mailchimp) → digital_maturity, contactability', () =>
    assert.deepStrictEqual(CATEGORY_DIMENSIONS.newsletter_email, ['digital_maturity', 'contactability']));
  check('network_affiliation → change_readiness, growth_orientation', () =>
    assert.deepStrictEqual(CATEGORY_DIMENSIONS.network_affiliation, ['change_readiness', 'growth_orientation']));

  // ── OFH dossier: official website with preserved outbound links ───────────
  const home: SourceFinding = makeFinding({
    sourceType: 'official_site', accessLevel: 'live_official_site',
    url: 'https://www.ofhchurch.com/', title: 'Our Finest Hour Church', fetched: true, status: 200,
    text: 'Welcome. We are a Church of the Nazarene. Listen to our weekly podcast. Our pastoral residency develops leaders.',
    outboundLinks: [
      { url: 'https://our-finest-hour-church.churchcenter.com/giving', text: 'Give' },
      { url: 'https://our-finest-hour-church.churchcenter.com/groups', text: 'Groups' },
      { url: 'https://our-finest-hour-church.churchcenter.com/calendar', text: 'Calendar' },
      { url: 'https://our-finest-hour-church.churchcenter.com/people/forms/929885', text: 'Forms' },
      { url: 'https://pushpay.com/g/ofh', text: 'Donate' },
      { url: 'https://www.youtube.com/@ofhchurch', text: 'Watch' },
      { url: 'https://www.facebook.com/ofhchurch', text: 'Facebook' },
      { url: 'https://open.spotify.com/show/ofh', text: 'Podcast' },
      { url: 'https://www.ofhchurch.com/contact', text: 'Contact' },
      { url: 'https://ofhchurch.us1.list-manage.com/subscribe', text: 'Newsletter' },
    ],
    linkDiagnostics: [
      { anchorText: 'Give', href: '/give', resolvedUrl: 'https://pushpay.com/g/ofh', sameOrigin: false, category: 'contact', selected: false, fetched: false, textLength: 0, hasStaffContactSignal: false, discovery: 'homepage_link' },
    ],
  });
  // An OUTSIDE source (search snippet) — should enrich AFTER website evidence.
  const snippet: SourceFinding = makeFinding({
    sourceType: 'search', accessLevel: 'search_snippets',
    url: 'https://www.churchfinder.com/our-finest-hour', title: 'OFH directory listing', fetched: false, status: 200,
    snippet: 'Our Finest Hour Church runs a Christian academy and is hiring — now hiring a worship leader.',
  });

  const sigs = detectStrategicSignals([home, snippet]);

  // (A) captured + classified
  check('church_management captured (Church Center host)', () => assert.ok(has(sigs, 'church_management')));
  check('giving captured (Pushpay + Church Center giving)', () => assert.ok(has(sigs, 'giving')));
  check('groups captured (anchor "Groups")', () => assert.ok(has(sigs, 'groups')));
  check('events_calendar captured (anchor "Calendar")', () => assert.ok(has(sigs, 'events_calendar')));
  check('forms_workflows captured (Forms / contact workflow)', () => assert.ok(has(sigs, 'forms_workflows')));
  check('livestream_video captured (YouTube)', () => assert.ok(has(sigs, 'livestream_video')));
  check('social_media captured (Facebook)', () => assert.ok(has(sigs, 'social_media')));
  check('podcast captured (Spotify host + page text)', () => assert.ok(has(sigs, 'podcast')));
  check('newsletter_email captured (Mailchimp list-manage)', () => assert.ok(has(sigs, 'newsletter_email')));
  check('internship_residency captured (page text "residency")', () => assert.ok(has(sigs, 'internship_residency')));
  check('network_affiliation captured (page text "Church of the Nazarene")', () => assert.ok(has(sigs, 'network_affiliation')));
  check('school_academy captured (outside snippet "Christian academy")', () => assert.ok(has(sigs, 'school_academy')));
  check('jobs_hiring captured (outside snippet "now hiring")', () => assert.ok(has(sigs, 'jobs_hiring')));

  // (B) preserved evidence on each signal (anchor / source / destination / host / access)
  check('every signal preserves source_page, destination_url, host, access_level, confidence', () => {
    for (const s of sigs) {
      assert.ok(s.source_page, `missing source_page for ${s.category}`);
      assert.ok(s.destination_url, `missing destination_url for ${s.category}`);
      assert.ok(s.host, `missing host for ${s.category}`);
      assert.ok(s.access_level, `missing access_level for ${s.category}`);
      assert.ok(s.confidence > 0, `bad confidence for ${s.category}`);
      assert.deepStrictEqual(s.dimensions, CATEGORY_DIMENSIONS[s.category]);
    }
  });
  check('church_management signal points at the churchcenter host', () => {
    const cm = ofCat(sigs, 'church_management')[0];
    assert.match(cm.host, /churchcenter\.com$/);
    assert.strictEqual(cm.access_level, 'live_official_site');
  });

  // (C) website-first ordering: live official site signals lead the outside ones
  check('website-first: first signal is live_official_site evidence', () =>
    assert.strictEqual(sigs[0].access_level, 'live_official_site'));
  check('website-first: outside (search_snippet) signals come AFTER website signals', () => {
    const firstSnippetIdx = sigs.findIndex((s) => s.access_level === 'search_snippets');
    const lastSiteIdx = sigs.map((s) => s.access_level).lastIndexOf('live_official_site');
    assert.ok(firstSnippetIdx === -1 || firstSnippetIdx > lastSiteIdx, 'a snippet signal preceded a website signal');
  });

  // (D) five-dimension summary counts
  const dim = dimensionCounts(sigs);
  check('dimension counts populated for all five dimensions', () => {
    assert.ok(dim.digital_maturity > 0);
    assert.ok(dim.growth_orientation > 0);
    assert.ok(dim.change_readiness > 0);
    assert.ok(dim.organizational_capacity > 0);
    assert.ok(dim.contactability > 0);
  });

  // ── OFH regression: the exact live Church Center form URL → strategic signal ─
  const ofhForm: SourceFinding = makeFinding({
    sourceType: 'search', accessLevel: 'search_snippets',
    url: 'https://our-finest-hour-church.churchcenter.com/people/forms/929885',
    title: 'Our Finest Hour Church, Inc.', fetched: false, status: 200,
    snippet: 'Calendar Give Groups Log in.',
  });
  const ofhSigs = detectStrategicSignals([ofhForm]);
  check('OFH form URL alone → church_management strategic signal', () => {
    const cm = ofCat(ofhSigs, 'church_management')[0];
    assert.ok(cm);
    assert.ok(cm.destination_url.includes('our-finest-hour-church.churchcenter.com'));
    assert.deepStrictEqual(cm.dimensions, ['digital_maturity', 'organizational_capacity', 'contactability']);
  });

  console.log(failures ? `\nFAILED (${failures})` : '\nALL PASSED');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
