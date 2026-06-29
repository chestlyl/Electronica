/**
 * Tech-stack detection — the WHOLE digital stack from the church's OWN evidence.
 * Proves: website-builder fingerprinting (Squarespace served from the church's
 * own domain), streaming platforms (YouTube), real platforms from official
 * outbound links (Church Center, Pushpay), AND that owned-gating drops
 * vendor/comparison pages (Subsplash/Tithely) that aren't the church's stack.
 *
 *   (run via `npm run test`)
 */
import assert from 'node:assert';
import { detectTechStack } from '../research/techStack.js';
import { makeFinding, type SourceFinding } from '../research/dossier.js';

let failures = 0;
function check(label: string, fn: () => void) {
  try { fn(); console.log(`  ✓ ${label}`); } catch (e) { failures++; console.log(`  ✗ ${label}: ${(e as Error).message}`); }
}

const OFFICIAL = 'theonecity.org';
const findings: SourceFinding[] = [
  // the church's OWN Squarespace homepage, linking to its real platforms
  makeFinding({
    sourceType: 'official_site', accessLevel: 'live_official_site', url: `https://www.${OFFICIAL}/`, fetched: true, status: 200, category: 'home',
    title: 'One City Church | Nashville',
    text: 'One City Church. <div class="header-menu header-menu--folder-list" data-current-styles="{ layout : navCenter }"> Give Watch Groups',
    outboundLinks: [
      { url: 'https://onecitynashville.churchcenter.com/calendar', text: 'Events' },
      { url: 'https://pushpay.com/g/theonecityal', text: 'Give' },
      { url: 'https://www.youtube.com/@WeAreOneCity', text: 'Watch Sermons' },
    ],
  }),
  // third-party VENDOR / comparison pages — NOT the church's stack
  makeFinding({ sourceType: 'search', accessLevel: 'search_snippets', url: 'https://www.subsplash.com/compare/subsplash-vs-planning-center', fetched: false, status: 200, snippet: 'Subsplash vs Planning Center — church app comparison.' }),
  makeFinding({ sourceType: 'search', accessLevel: 'search_snippets', url: 'https://www.tithe.ly/blog/best-church-giving', fetched: false, status: 200, snippet: 'Tithely best church giving apps.' }),
  // a different same-name church
  makeFinding({ sourceType: 'search', accessLevel: 'search_snippets', url: 'https://www.onecitychurchlancaster.com/', fetched: false, status: 200, snippet: 'One City Church Lancaster.' }),
];

function main() {
  console.log('Tech-stack detection (whole stack, owned-gated)');

  const gated = detectTechStack(findings, OFFICIAL);
  const names = gated.map((h) => h.platform_name);
  const cats = new Set(gated.map((h) => h.category));

  check('website platform fingerprinted from the church\'s own markup → Squarespace', () => {
    assert.ok(names.includes('Squarespace'), `got ${names.join(', ')}`);
    assert.ok(cats.has('Website'));
  });
  check('real platforms from official outbound links → Church Center + Pushpay', () => {
    assert.ok(names.some((n) => /Church Center|Planning Center/.test(n)), 'ChMS missing');
    assert.ok(names.includes('Pushpay'), 'Pushpay missing');
    assert.ok(cats.has('ChMS') && cats.has('Giving'));
  });
  check('streaming platform → YouTube (Streaming)', () => {
    assert.ok(names.includes('YouTube'), `got ${names.join(', ')}`);
    assert.ok(cats.has('Streaming'));
  });
  check('vendor/comparison + other-church pages are NOT in the stack (Subsplash/Tithely dropped)', () => {
    assert.ok(!names.includes('Subsplash'), 'Subsplash leaked from vendor page');
    assert.ok(!names.includes('Tithely'), 'Tithely leaked from vendor page');
  });

  // Without owned-gating, the vendor pages WOULD contaminate the stack — proving
  // the gate is doing the work.
  check('ungated detection would include the vendor Subsplash (gate is load-bearing)', () => {
    const ungated = detectTechStack(findings).map((h) => h.platform_name);
    assert.ok(ungated.includes('Subsplash'), 'expected contamination without the official-host gate');
  });

  console.log(failures ? `\nFAILED (${failures})` : '\nALL PASSED');
  process.exit(failures ? 1 : 0);
}

main();
