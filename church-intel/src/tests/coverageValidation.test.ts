/**
 * Coverage Validation Layer — the system must KNOW the difference between
 * investigated-and-absent, discovered-and-uncrawled, and missing. Models the
 * Cross Point case (giving/sermons/groups links fired signals but the pages were
 * never crawled) and the post-Crawl-Expansion case (pages fetched).
 *
 *   (run via `npm run test`)
 */
import assert from 'node:assert';
import { validateCoverage } from '../research/coverageValidation.js';
import { makeFinding, type SourceFinding } from '../research/dossier.js';
import { detectStrategicSignals } from '../research/strategicSignals.js';
import { detectDigitalSignals } from '../research/digitalSignals.js';
import { detectTechStack } from '../research/techStack.js';

let failures = 0;
function check(label: string, fn: () => void) {
  try { fn(); console.log(`  ✓ ${label}`); } catch (e) { failures++; console.log(`  ✗ ${label}: ${(e as Error).message}`); }
}

const page = (category: string, url: string, extra: Partial<SourceFinding> = {}): SourceFinding =>
  makeFinding({ sourceType: 'official_site', accessLevel: 'live_official_site', url, fetched: true, status: 200, category, text: `${category} page content`, ...extra });

async function main() {
  console.log('Coverage Validation Layer');

  // Homepage exposes Give/Watch/Groups/Careers/Facebook links → signals fire,
  // but only home/about/staff/contact pages are actually crawled (Cross Point).
  const home = page('home', 'https://x.org/', {
    outboundLinks: [
      { url: 'https://x.org/give', text: 'Give' },
      { url: 'https://www.youtube.com/@x', text: 'Watch' },
      { url: 'https://x.org/groups', text: 'Groups' },
      { url: 'https://x.org/careers', text: 'Careers' },
      { url: 'https://www.facebook.com/x', text: 'Facebook' },
    ],
  });
  const crawled = [home, page('about', 'https://x.org/about'), page('staff', 'https://x.org/about'), page('contact', 'https://x.org/contact')];
  const signals = detectStrategicSignals(crawled);
  const rep = validateCoverage({ findings: crawled, strategicSignals: signals, techStack: detectTechStack(crawled), digital: detectDigitalSignals(crawled), campusKnown: true });

  check('required pages crawled → complete', () => {
    for (const c of ['homepage', 'about', 'staff', 'contact']) assert.ok(rep.complete.includes(c), `${c} not complete`);
  });
  check('giving link fired a signal but page uncrawled → PARTIAL (not complete)', () => {
    assert.ok(rep.partial.includes('giving'), `partial=${rep.partial.join(',')}`);
    assert.ok(!rep.complete.includes('giving'));
  });
  check('sermons/media + groups + jobs are partial (signal only)', () => {
    for (const c of ['sermons/media', 'groups', 'jobs/careers']) assert.ok(rep.partial.includes(c), `${c} not partial`);
  });
  check('social profiles found → complete', () => assert.ok(rep.complete.includes('social')));
  check('campuses known-but-uncrawled → partial', () => assert.ok(rep.partial.includes('campuses')));

  // THE point: an uncrawled category is NOT "investigated" — so Stage 3 cannot
  // turn its absence into a negative score factor.
  check('giving is NOT investigated (link-only) → score gate must not penalize', () => assert.ok(!rep.investigatedSet.has('giving')));
  check('technology is NOT investigated when platform pages were not crawled', () => {
    assert.ok(!rep.investigatedSet.has('technology'));
    assert.ok(rep.missing.includes('technology'));
  });
  check('coverage % is a sane fraction (well under 100, above 0)', () => {
    assert.ok(rep.coveragePercent > 20 && rep.coveragePercent < 80, `got ${rep.coveragePercent}`);
  });

  // ── Post-Crawl-Expansion: the giving page is now actually fetched ────────────
  const crawled2 = [...crawled, page('giving', 'https://x.org/give', { text: 'Give online via Pushpay. Ways to give.' })];
  const rep2 = validateCoverage({ findings: crawled2, strategicSignals: signals, techStack: detectTechStack(crawled2), digital: detectDigitalSignals(crawled2), campusKnown: true });
  check('after crawling the giving page → giving complete + investigated', () => {
    assert.ok(rep2.complete.includes('giving'));
    assert.ok(rep2.investigatedSet.has('giving'));
  });
  check('coverage % rises when more is investigated', () => assert.ok(rep2.coveragePercent > rep.coveragePercent, `${rep2.coveragePercent} !> ${rep.coveragePercent}`));

  console.log(failures ? `\nFAILED (${failures})` : '\nALL PASSED');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
