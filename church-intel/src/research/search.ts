import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import type { SearchResult } from './types.js';

const DIRECTORY_HOSTS = [
  'facebook.com', 'instagram.com', 'twitter.com', 'x.com', 'youtube.com',
  'yelp.com', 'yellowpages.com', 'mapquest.com', 'tripadvisor.com',
  'churchfinder.com', 'uschurch.org', 'find-a-church', 'wikipedia.org',
  'linkedin.com', 'ein.org', 'causeiq.com', 'tiktok.com',
  // church-listing / review / tax-record directories (NOT a church's own site)
  'joinmychurch.com', 'faithstreet.com', 'churchangel.com', 'alluschurches.com',
  'unitedstateschurches.com', 'christianchurchsearch.com', 'taxexemptworld.com',
  'guidestar.org', 'propublica.org', 'manta.com',
];

// Generic listing hosts: "<place>churches.com/org/net" (plural) — e.g.
// oklahomachurches.com, alluschurches.com. Individual churches are virtually
// always singular ("...church.com"), so the plural form signals a directory.
const DIRECTORY_HOST_RE = /[a-z]churches\.(com|org|net)$/i;

export function isDirectoryUrl(url: string): boolean {
  try {
    const h = new URL(url).hostname.replace(/^www\./, '');
    return DIRECTORY_HOSTS.some((d) => h.includes(d)) || DIRECTORY_HOST_RE.test(h);
  } catch {
    return true;
  }
}

function decodeDuckUrl(href: string): string {
  // DuckDuckGo HTML wraps targets like /l/?uddg=<encoded>
  const m = href.match(/[?&]uddg=([^&]+)/);
  if (m) return decodeURIComponent(m[1]);
  if (href.startsWith('//')) return 'https:' + href;
  return href;
}

/**
 * Lightweight web search via the DuckDuckGo HTML endpoint (no API key, polite).
 * Returns ranked results; official-looking sites can be prioritized by caller.
 */
export async function webSearch(query: string, limit = 10): Promise<SearchResult[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  try {
    const res = await fetch(url, {
      headers: {
        'user-agent': config.crawl.userAgent,
        accept: 'text/html',
      },
      signal: AbortSignal.timeout(config.crawl.pageTimeoutMs),
    });
    if (!res.ok) {
      logger.warn(`search failed (${res.status}) for "${query}"`);
      return [];
    }
    const html = await res.text();
    return parseDuckHtml(html, limit);
  } catch (err) {
    logger.warn(`search error for "${query}": ${(err as Error).message}`);
    return [];
  }
}

function parseDuckHtml(html: string, limit: number): SearchResult[] {
  const results: SearchResult[] = [];
  const blocks = html.split('result__body');
  for (const block of blocks.slice(1)) {
    const linkM = block.match(/result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!linkM) continue;
    const url = decodeDuckUrl(linkM[1]);
    const title = stripTags(linkM[2]);
    const snipM = block.match(/result__snippet"[^>]*>([\s\S]*?)<\/a>/) ||
      block.match(/result__snippet"[^>]*>([\s\S]*?)<\/div>/);
    const snippet = snipM ? stripTags(snipM[1]) : '';
    if (url && title) results.push({ url, title, snippet });
    if (results.length >= limit) break;
  }
  return results;
}

function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Pick the most likely OFFICIAL church website from search results,
 * preferring non-directory domains and name/location matches.
 */
export function pickOfficialSite(
  results: SearchResult[],
  churchName: string,
): string | null {
  const nameTokens = churchName
    .toLowerCase()
    .replace(/church of the nazarene|church|the|of|community|fellowship/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2);

  const scored = results
    .filter((r) => !isDirectoryUrl(r.url))
    .map((r) => {
      let score = 0;
      const host = (() => {
        try {
          return new URL(r.url).hostname.toLowerCase();
        } catch {
          return '';
        }
      })();
      for (const t of nameTokens) if (host.includes(t)) score += 3;
      if (/\.(org|church)$/.test(host)) score += 2;
      if (/nazarene|naz/.test(host)) score += 1;
      return { url: r.url, score };
    })
    .sort((a, b) => b.score - a.score);

  return scored.length && scored[0].score > 0 ? scored[0].url : (results.find((r) => !isDirectoryUrl(r.url))?.url ?? null);
}
