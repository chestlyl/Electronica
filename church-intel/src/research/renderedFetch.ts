import { chromium, type Browser } from 'playwright';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import { chromiumInstalled } from './browser.js';
import type { CrawlMethod } from './types.js';

export interface RenderedResult {
  url: string;
  finalUrl: string;
  ok: boolean;
  status: number;
  crawlMethod: CrawlMethod;       // fetch | fetch_fallback | playwright_rendered | none
  title: string;
  identityText: string;           // title + og + h1 + meta description (from raw html)
  text: string;                   // best visible text (rendered if escalated, else raw)
  rawHtml: string;                // initial fetch html (for meta extraction)
  rawTextLength: number;
  renderedTextLength: number;
  gainRatio: number;              // rendered / raw text length
  links: string[];
  linkPairs: { href: string; text: string }[];   // href + visible anchor text (for categorization)
  mailto: string[];
  tel: string[];
  buttons: string[];
  navLabels: string[];
  staffBlocks: string[];
}

// ── shared rendering browser (separate from the discovery crawler's) ─────────
let browser: Browser | null = null;
async function getBrowser(): Promise<Browser> {
  if (!browser) browser = await chromium.launch({ headless: config.crawl.headless });
  return browser;
}
export async function closeRenderBrowser(): Promise<void> {
  await browser?.close().catch(() => {});
  browser = null;
}

function visibleText(html: string): string {
  return html
    .replace(/<(script|style|noscript|template|svg)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[#a-z0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function firstMatch(re: RegExp, html: string): string {
  const m = html.match(re);
  return m ? m[1].replace(/\s+/g, ' ').trim() : '';
}
/** Extract <a> href + visible anchor text from raw HTML (resolution happens later). */
function rawLinkPairs(html: string): { href: string; text: string }[] {
  const out: { href: string; text: string }[] = [];
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const href = m[1];
    if (/^(javascript:|data:)/i.test(href)) continue;
    const text = m[2].replace(/<[^>]+>/g, ' ').replace(/&[#a-z0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();
    out.push({ href, text });
  }
  return out;
}
function identityFromHtml(html: string): string {
  return [
    firstMatch(/<title[^>]*>([\s\S]*?)<\/title>/i, html),
    firstMatch(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i, html),
    firstMatch(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i, html),
    firstMatch(/<h1[^>]*>([\s\S]*?)<\/h1>/i, html).replace(/<[^>]+>/g, ' '),
    firstMatch(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i, html),
  ].join(' | ').replace(/\s+/g, ' ').trim();
}

/**
 * Does the raw HTML already expose the nav/contact/staff signals we'd use to
 * crawl further? If so, a plain fetch is enough (no need to render). If a short
 * page lacks ALL of these, its nav is probably JS-injected and we should render.
 */
function hasNavContactSignals(html: string): boolean {
  const h = html.toLowerCase();
  if (h.includes('mailto:') || h.includes('tel:')) return true;
  return /\b(staff|team|leadership|elders?|pastors?|contact|connect|about|visit|ministr|campus|locations?|sermons?)\b/.test(h);
}

/** Heuristics: is the plain-fetch output thin / JS-rendered (needs a real browser)? */
export function isThin(html: string, text: string): boolean {
  if (text.length < 600) return true;                                   // low visible text
  if (/<div[^>]+id=["'](root|app|__next|__nuxt)["']/i.test(html) && text.length < 1500) return true; // SPA shell
  const scripts = (html.match(/<script\b/gi) || []).length;
  const anchors = (html.match(/<a\b/gi) || []).length;
  if (scripts >= 8 && anchors < 5) return true;                          // script-heavy, missing nav links
  if (/please enable javascript|you need to enable javascript|enable js to/i.test(html)) return true;
  // Conservative escalation: a short homepage (<1500 chars) whose raw HTML
  // exposes NO staff/contact/nav signals likely has JS-injected navigation —
  // render it so the staff/contact subpages remain discoverable. Pages that
  // already carry those signals are crawled fine via plain fetch.
  if (text.length < 1500 && !hasNavContactSignals(html)) return true;
  return false;
}

async function render(url: string): Promise<Partial<RenderedResult> & { ok: boolean; status: number; finalUrl: string; text: string; title: string }> {
  const ctx = await (await getBrowser()).newContext({ userAgent: config.crawl.userAgent, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  page.setDefaultNavigationTimeout(config.crawl.pageTimeoutMs);
  try {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {}); // network idle when possible
    await page.evaluate(async () => {                                    // scroll to trigger lazy content
      for (let y = 0; y < document.body.scrollHeight; y += 700) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 70)); }
      window.scrollTo(0, 0);
    }).catch(() => {});
    await page.waitForTimeout(300);
    const data = await page.evaluate(() => {
      const text = (document.body?.innerText || '').replace(/\s+/g, ' ').trim();
      const anchors = Array.from(document.querySelectorAll('a[href]')) as HTMLAnchorElement[];
      const links = anchors.map((a) => a.href);
      const linkPairs = anchors.map((a) => ({ href: a.href, text: (a.textContent || '').replace(/\s+/g, ' ').trim() }));
      const mailto = links.filter((h) => h.startsWith('mailto:')).map((h) => decodeURIComponent(h.replace(/^mailto:/, '').split('?')[0]));
      const tel = links.filter((h) => h.startsWith('tel:')).map((h) => h.replace(/^tel:/, ''));
      const buttons = Array.from(document.querySelectorAll('button,[role=button],a.button,.btn,.button')).map((b) => (b.textContent || '').trim()).filter(Boolean).slice(0, 40);
      const navLabels = Array.from(document.querySelectorAll('nav a, header a, [class*=nav i] a, [class*=menu i] a')).map((a) => (a.textContent || '').trim()).filter(Boolean).slice(0, 80);
      const staffBlocks = Array.from(document.querySelectorAll('[class*=staff i],[class*=team i],[class*=leader i],[class*=person i],[class*=member i],[class*=pastor i]')).map((e) => (e.textContent || '').replace(/\s+/g, ' ').trim()).filter((t) => t.length > 4 && t.length < 220).slice(0, 40);
      return { text, links, linkPairs, mailto, tel, buttons, navLabels, staffBlocks, title: document.title };
    });
    return { ok: !!resp && resp.ok(), status: resp?.status() ?? 0, finalUrl: page.url(), ...data };
  } finally {
    await page.close().catch(() => {});
    await ctx.close().catch(() => {});
  }
}

/**
 * Fetch a URL as text; if the plain-fetch output is thin/JS-rendered, escalate to
 * a real browser (Playwright) and use the rendered DOM. Returns the text plus
 * link/contact/nav/staff extractions and crawl-method diagnostics.
 */
export async function smartFetch(url: string, allowRender: boolean): Promise<RenderedResult> {
  const out: RenderedResult = {
    url, finalUrl: url, ok: false, status: 0, crawlMethod: 'fetch', title: '', identityText: '',
    text: '', rawHtml: '', rawTextLength: 0, renderedTextLength: 0, gainRatio: 1,
    links: [], linkPairs: [], mailto: [], tel: [], buttons: [], navLabels: [], staffBlocks: [],
  };
  let rawOk = false;
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(config.crawl.pageTimeoutMs),
      headers: { 'user-agent': config.crawl.userAgent, accept: 'text/html,*/*' },
    });
    out.status = res.status; out.finalUrl = res.url || url; out.ok = res.ok;
    const ct = res.headers.get('content-type') ?? '';
    if (res.ok && /html|text/.test(ct)) {
      out.rawHtml = (await res.text()).slice(0, 80000);
      rawOk = true;
    }
  } catch {
    /* network error — may still succeed via a real browser */
  }
  const rawText = rawOk ? visibleText(out.rawHtml) : '';
  out.text = rawText;
  out.rawTextLength = rawText.length;
  out.renderedTextLength = rawText.length;
  if (rawOk) {
    out.title = firstMatch(/<title[^>]*>([\s\S]*?)<\/title>/i, out.rawHtml);
    out.identityText = identityFromHtml(out.rawHtml);
    const rawLinks = [...out.rawHtml.matchAll(/href=["']([^"']+)["']/gi)].map((m) => m[1]);
    out.links = rawLinks;
    out.linkPairs = rawLinkPairs(out.rawHtml);
    out.mailto = rawLinks.filter((h) => h.startsWith('mailto:')).map((h) => decodeURIComponent(h.replace(/^mailto:/, '').split('?')[0]));
    out.tel = rawLinks.filter((h) => h.startsWith('tel:')).map((h) => h.replace(/^tel:/, ''));
  }

  // Escalate when the fetch was thin OR blocked/empty (a real browser often
  // bypasses bot blocks and renders JS content).
  const needsRender = !rawOk || isThin(out.rawHtml, rawText);
  if (needsRender && allowRender && chromiumInstalled() && !config.research.forceFetchFallback) {
    try {
      const r = await render(out.finalUrl);
      out.crawlMethod = 'playwright_rendered';
      out.ok = r.ok || out.ok;
      out.status = r.status || out.status;
      out.finalUrl = r.finalUrl || out.finalUrl;
      out.text = r.text || rawText;
      out.title = r.title || out.title;
      out.renderedTextLength = out.text.length;
      out.gainRatio = out.rawTextLength > 0 ? Math.round((out.text.length / out.rawTextLength) * 100) / 100 : (out.text.length > 0 ? 99 : 1);
      if (r.links?.length) out.links = r.links;
      if (r.linkPairs?.length) out.linkPairs = r.linkPairs;
      if (r.mailto?.length) out.mailto = r.mailto;
      if (r.tel?.length) out.tel = r.tel;
      out.buttons = r.buttons ?? [];
      out.navLabels = r.navLabels ?? [];
      out.staffBlocks = r.staffBlocks ?? [];
      return out;
    } catch (e) {
      logger.debug(`render escalation failed for ${url}: ${(e as Error).message}`);
      out.crawlMethod = rawOk ? 'fetch_fallback' : 'fetch';
      return out;
    }
  }
  out.crawlMethod = !rawOk ? 'fetch' : isThin(out.rawHtml, rawText) ? 'fetch_fallback' : 'fetch';
  return out;
}
