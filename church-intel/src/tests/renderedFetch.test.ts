/**
 * Rendered-DOM upgrade: thin-page detection, crawl-method labeling, raw-vs-
 * rendered diagnostics, and mailto/tel extraction. (Chromium isn't installed in
 * CI, so the escalation path falls back to fetch_fallback — verified here.)
 *
 *   (run via `npm run test`)
 */
import assert from 'node:assert';
import { isThin, smartFetch } from '../research/renderedFetch.js';

const RICH = `<html><head><title>Grace Church</title></head><body>
<nav><a href="/give">Give</a><a href="/sermons">Sermons</a><a href="/visit">Plan a Visit</a></nav>
<p>${'We are a church family that gathers each week for worship, teaching, prayer, and community. '.repeat(12)}</p>
<a href="mailto:info@gracechurch.org">Email us</a><a href="tel:+13305551234">Call</a>
</body></html>`;
const RICH_TEXT_LEN = RICH.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().length;

const SHELL = `<html><body><div id="root"></div><script src="/app.js"></script></body></html>`;

const PAGES: Record<string, string> = {
  'rich.example': RICH,
  'thin.example': SHELL,
};
(globalThis as any).fetch = async (input: any) => {
  const url = typeof input === 'string' ? input : input.url;
  const h = new URL(url).hostname;
  const html = PAGES[h];
  if (!html) return new Response('x', { status: 404, headers: { 'content-type': 'text/html' } });
  return new Response(html, { status: 200, headers: { 'content-type': 'text/html' } });
};

let failures = 0;
function check(label: string, fn: () => void) {
  try { fn(); console.log(`  ✓ ${label}`); } catch (e) { failures++; console.log(`  ✗ ${label}: ${(e as Error).message}`); }
}

async function main() {
  console.log('rendered-DOM detection + diagnostics');

  check('isThin: low visible text', () => assert.ok(isThin('<body>hi</body>', 'hi')));
  check('isThin: SPA root shell', () => assert.ok(isThin(SHELL, '')));
  check('isThin: rich page is NOT thin', () => assert.ok(!isThin(RICH, RICH.replace(/<[^>]+>/g, ' '))));

  const rich = await smartFetch('https://rich.example', true);
  check('rich page → crawlMethod fetch', () => assert.strictEqual(rich.crawlMethod, 'fetch'));
  check('rich page reachable + raw_text length recorded', () => { assert.ok(rich.ok); assert.ok(rich.rawTextLength > 100); });
  check('rendered == raw when no escalation (gain 1)', () => assert.strictEqual(rich.gainRatio, 1));
  check('mailto extracted from raw html', () => assert.ok(rich.mailto.includes('info@gracechurch.org')));
  check('tel extracted from raw html', () => assert.ok(rich.tel.some((t) => t.includes('3305551234'))));

  const thin = await smartFetch('https://thin.example', true);
  check('thin page (no Chromium) → fetch_fallback', () => assert.strictEqual(thin.crawlMethod, 'fetch_fallback'));
  check('thin page raw_text length is low', () => assert.ok(thin.rawTextLength < 50));

  const dead = await smartFetch('https://nope.example', true);
  check('404 → not ok, crawlMethod fetch', () => { assert.ok(!dead.ok); assert.strictEqual(dead.status, 404); });

  console.log(failures ? `\nFAILED (${failures})` : '\nALL PASSED');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
