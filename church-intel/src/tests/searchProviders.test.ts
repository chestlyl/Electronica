/**
 * Search provider layer (Priority 3) — the API-keyed backends that let
 * reported-attendance lookups actually activate. Pure offline tests:
 *   - parseSerper / parseBrave correctly read each JSON shape,
 *   - activeProviders() gates keyed providers on env and slots them FIRST.
 * No network is touched.
 *
 *   (run via `npm run test`)
 */
import assert from 'node:assert';
import { parseSerper, parseBrave, activeProviders } from '../research/searchProviders.js';
import { config } from '../config.js';

let failures = 0;
function check(label: string, fn: () => void) {
  try { fn(); console.log(`  ✓ ${label}`); } catch (e) { failures++; console.log(`  ✗ ${label}: ${(e as Error).message}`); }
}

function main() {
  console.log('Search provider layer (API backends + gating)');

  check('parseSerper reads answerBox + organic results', () => {
    const r = parseSerper({
      answerBox: { title: 'Grace Church', link: 'https://outreach100.com/grace', answer: '5,372 attendance' },
      organic: [
        { title: 'Outreach 100', link: 'https://outreach100.com/list', snippet: 'Largest churches' },
        { title: 'no link skipped' },
      ],
    });
    assert.strictEqual(r.length, 2);
    assert.strictEqual(r[0].url, 'https://outreach100.com/grace');
    assert.strictEqual(r[0].snippet, '5,372 attendance');
    assert.strictEqual(r[1].url, 'https://outreach100.com/list');
  });

  check('parseSerper tolerates empty/garbage payloads', () => {
    assert.deepStrictEqual(parseSerper({}), []);
    assert.deepStrictEqual(parseSerper({ organic: [] }), []);
  });

  check('parseBrave reads web.results and strips description tags', () => {
    const r = parseBrave({ web: { results: [
      { title: 'Hartford DB', url: 'https://hirr.hartfordinternational.edu/x', description: 'attendance <strong>5,000</strong>' },
      { title: 'no url skipped' },
    ] } });
    assert.strictEqual(r.length, 1);
    assert.strictEqual(r[0].url, 'https://hirr.hartfordinternational.edu/x');
    assert.strictEqual(r[0].snippet, 'attendance 5,000');
  });

  // ── gating: keyed providers appear only when a key is set, and lead ──────────
  const origSerper = config.search.serperApiKey, origBrave = config.search.braveApiKey;
  check('no keys → only the 4 HTML scrapers are active', () => {
    config.search.serperApiKey = ''; config.search.braveApiKey = '';
    assert.strictEqual(activeProviders().length, 4);
  });
  check('SERPER key → 5 providers (keyed backend added ahead of scrapers)', () => {
    config.search.serperApiKey = 'test-key'; config.search.braveApiKey = '';
    assert.strictEqual(activeProviders().length, 5);
  });
  check('both keys → 6 providers active', () => {
    config.search.serperApiKey = 'a'; config.search.braveApiKey = 'b';
    assert.strictEqual(activeProviders().length, 6);
  });
  config.search.serperApiKey = origSerper; config.search.braveApiKey = origBrave;

  console.log(failures ? `\nFAILED (${failures})` : '\nALL PASSED');
  process.exit(failures ? 1 : 0);
}

main();
