import { logger } from '../lib/logger.js';
import { config } from '../config.js';
import type { SearchResult } from './types.js';

/**
 * Search engines challenge non-browser User-Agents (DuckDuckGo returns HTTP 202
 * with an empty body for our crawler UA). Search requests therefore use a
 * realistic browser UA. This is only for *reading public search results*, not
 * for crawling church sites (which use the configured polite crawler UA).
 */
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const TIMEOUT_MS = 15000;

export interface SearchDiagnostic {
  provider: string;
  status: number;
  resultCount: number;
  ok: boolean;
  note?: string;
}

export interface ProviderOutcome {
  results: SearchResult[];
  diagnostic: SearchDiagnostic;
}

function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeUddg(href: string): string {
  const m = href.match(/[?&]uddg=([^&]+)/);
  if (m) return decodeURIComponent(m[1]);
  if (href.startsWith('//')) return 'https:' + href;
  return href;
}

async function get(url: string, init?: RequestInit): Promise<{ status: number; body: string }> {
  const res = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { 'user-agent': BROWSER_UA, accept: 'text/html,application/xhtml+xml', 'accept-language': 'en-US,en;q=0.9' },
    ...init,
  });
  return { status: res.status, body: await res.text() };
}

// ── Provider: DuckDuckGo HTML (POST avoids the 202 challenge) ───────────────
async function ddgHtml(query: string): Promise<ProviderOutcome> {
  const provider = 'duckduckgo-html';
  try {
    const { status, body } = await get('https://html.duckduckgo.com/html/', {
      method: 'POST',
      headers: {
        'user-agent': BROWSER_UA,
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'text/html',
      },
      body: `q=${encodeURIComponent(query)}&kl=us-en`,
    });
    const results: SearchResult[] = [];
    for (const block of body.split('result__body').slice(1)) {
      const linkM = block.match(/result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
      if (!linkM) continue;
      const url = decodeUddg(linkM[1]);
      const title = stripTags(linkM[2]);
      const snipM = block.match(/result__snippet"[^>]*>([\s\S]*?)<\/a>/);
      results.push({ url, title, snippet: snipM ? stripTags(snipM[1]) : '' });
    }
    return { results, diagnostic: { provider, status, resultCount: results.length, ok: results.length > 0 } };
  } catch (err) {
    return { results: [], diagnostic: { provider, status: 0, resultCount: 0, ok: false, note: (err as Error).message } };
  }
}

// ── Provider: DuckDuckGo Lite ───────────────────────────────────────────────
async function ddgLite(query: string): Promise<ProviderOutcome> {
  const provider = 'duckduckgo-lite';
  try {
    const { status, body } = await get('https://lite.duckduckgo.com/lite/', {
      method: 'POST',
      headers: {
        'user-agent': BROWSER_UA,
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'text/html',
      },
      body: `q=${encodeURIComponent(query)}&kl=us-en`,
    });
    const results: SearchResult[] = [];
    const re = /<a[^>]*class="result-link"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) !== null) {
      results.push({ url: decodeUddg(m[1]), title: stripTags(m[2]), snippet: '' });
    }
    return { results, diagnostic: { provider, status, resultCount: results.length, ok: results.length > 0 } };
  } catch (err) {
    return { results: [], diagnostic: { provider, status: 0, resultCount: 0, ok: false, note: (err as Error).message } };
  }
}

// ── Provider: Bing HTML ─────────────────────────────────────────────────────
async function bing(query: string): Promise<ProviderOutcome> {
  const provider = 'bing';
  try {
    const { status, body } = await get(
      `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=10&setlang=en-us`,
    );
    const results: SearchResult[] = [];
    const re = /<li class="b_algo"[\s\S]*?<h2>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) !== null) {
      results.push({ url: m[1], title: stripTags(m[2]), snippet: '' });
    }
    return { results, diagnostic: { provider, status, resultCount: results.length, ok: results.length > 0 } };
  } catch (err) {
    return { results: [], diagnostic: { provider, status: 0, resultCount: 0, ok: false, note: (err as Error).message } };
  }
}

// ── Provider: Mojeek (independent index, bot-friendly) ──────────────────────
async function mojeek(query: string): Promise<ProviderOutcome> {
  const provider = 'mojeek';
  try {
    const { status, body } = await get(`https://www.mojeek.com/search?q=${encodeURIComponent(query)}`);
    const results: SearchResult[] = [];
    const re = /<a[^>]*class="ob"[^>]*href="([^"]+)"[\s\S]*?<a[^>]*class="title"[^>]*href="[^"]+"[^>]*>([\s\S]*?)<\/a>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) !== null) {
      results.push({ url: m[1], title: stripTags(m[2]), snippet: '' });
    }
    // Fallback parse if the markup shifts: any result title link.
    if (results.length === 0) {
      const re2 = /<a class="title"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
      let m2: RegExpExecArray | null;
      while ((m2 = re2.exec(body)) !== null) {
        results.push({ url: m2[1], title: stripTags(m2[2]), snippet: '' });
      }
    }
    return { results, diagnostic: { provider, status, resultCount: results.length, ok: results.length > 0 } };
  } catch (err) {
    return { results: [], diagnostic: { provider, status: 0, resultCount: 0, ok: false, note: (err as Error).message } };
  }
}

// ── Provider: Serper.dev (Google results as JSON) ───────────────────────────
// Pure parser, exported so it can be unit-tested without a network call.
export function parseSerper(json: unknown): SearchResult[] {
  const j = json as { organic?: { title?: string; link?: string; snippet?: string }[]; answerBox?: { title?: string; link?: string; snippet?: string; answer?: string } };
  const out: SearchResult[] = [];
  const ab = j.answerBox;
  if (ab?.link) out.push({ title: ab.title ?? '', url: ab.link, snippet: ab.snippet ?? ab.answer ?? '' });
  for (const r of j.organic ?? []) if (r.link) out.push({ title: r.title ?? '', url: r.link, snippet: r.snippet ?? '' });
  return out;
}
async function serper(query: string): Promise<ProviderOutcome> {
  const provider = 'serper';
  try {
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST', signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'X-API-KEY': config.search.serperApiKey, 'content-type': 'application/json' },
      body: JSON.stringify({ q: query, num: 10, gl: 'us', hl: 'en' }),
    });
    const status = res.status;
    if (!res.ok) return { results: [], diagnostic: { provider, status, resultCount: 0, ok: false, note: `HTTP ${status}` } };
    const results = parseSerper(await res.json());
    return { results, diagnostic: { provider, status, resultCount: results.length, ok: results.length > 0 } };
  } catch (err) {
    return { results: [], diagnostic: { provider, status: 0, resultCount: 0, ok: false, note: (err as Error).message } };
  }
}

// ── Provider: Brave Search API (JSON) ────────────────────────────────────────
export function parseBrave(json: unknown): SearchResult[] {
  const j = json as { web?: { results?: { title?: string; url?: string; description?: string }[] } };
  const out: SearchResult[] = [];
  for (const r of j.web?.results ?? []) if (r.url) out.push({ title: r.title ?? '', url: r.url, snippet: stripTags(r.description ?? '') });
  return out;
}
async function brave(query: string): Promise<ProviderOutcome> {
  const provider = 'brave';
  try {
    const res = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=10`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'X-Subscription-Token': config.search.braveApiKey, accept: 'application/json' },
    });
    const status = res.status;
    if (!res.ok) return { results: [], diagnostic: { provider, status, resultCount: 0, ok: false, note: `HTTP ${status}` } };
    const results = parseBrave(await res.json());
    return { results, diagnostic: { provider, status, resultCount: results.length, ok: results.length > 0 } };
  } catch (err) {
    return { results: [], diagnostic: { provider, status: 0, resultCount: 0, ok: false, note: (err as Error).message } };
  }
}

type Provider = (q: string) => Promise<ProviderOutcome>;
const SCRAPER_PROVIDERS: Provider[] = [ddgHtml, ddgLite, bing, mojeek];

/**
 * Active providers in priority order. API-keyed backends (reliable JSON) lead;
 * the HTML scrapers follow as a keyless fallback. Read at call time so a key set
 * after module load is still honored.
 */
export function activeProviders(): Provider[] {
  const keyed: Provider[] = [];
  if (config.search.serperApiKey) keyed.push(serper);
  if (config.search.braveApiKey) keyed.push(brave);
  return [...keyed, ...SCRAPER_PROVIDERS];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Query multiple search engines in turn, aggregating de-duped results and
 * per-provider diagnostics. Stops early once enough distinct hosts are found.
 */
export async function multiSearch(
  query: string,
  opts: { limit?: number; minHosts?: number } = {},
): Promise<{ results: SearchResult[]; diagnostics: SearchDiagnostic[] }> {
  const limit = opts.limit ?? 12;
  const minHosts = opts.minHosts ?? 5;
  const diagnostics: SearchDiagnostic[] = [];
  const byUrl = new Map<string, SearchResult>();

  for (const provider of activeProviders()) {
    const { results, diagnostic } = await provider(query);
    diagnostics.push(diagnostic);
    for (const r of results) {
      if (!r.url.startsWith('http')) continue;
      if (!byUrl.has(r.url)) byUrl.set(r.url, { ...r, provider: diagnostic.provider });
    }
    const distinctHosts = new Set([...byUrl.values()].map((r) => hostOf(r.url)));
    logger.debug(`search[${diagnostic.provider}] status=${diagnostic.status} results=${diagnostic.resultCount}`);
    if (distinctHosts.size >= minHosts) break;
    await sleep(300);
  }

  return { results: [...byUrl.values()].slice(0, limit), diagnostics };
}
