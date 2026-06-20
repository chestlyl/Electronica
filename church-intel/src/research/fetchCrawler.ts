import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import { RobotsRules } from './robots.js';
import { categorizeLink, discoverOfficialSite, sleep } from './discover.js';
import type {
  PageContent,
  ResearchBundle,
  ResearchInput,
  ResearchProvider,
} from './types.js';

const ENTITIES: Record<string, string> = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'",
  '&#x27;': "'", '&nbsp;': ' ', '&rsquo;': '’', '&lsquo;': '‘',
  '&mdash;': '—', '&ndash;': '–',
};

function decodeEntities(s: string): string {
  return s.replace(/&[#a-z0-9]+;/gi, (m) => ENTITIES[m.toLowerCase()] ?? m);
}

/** Strip a full HTML document down to readable visible text. */
export function extractText(html: string): string {
  const body = html.replace(/[\s\S]*?<body[^>]*>/i, '').replace(/<\/body>[\s\S]*$/i, '') || html;
  const cleaned = body
    .replace(/<(script|style|noscript|template|svg)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(cleaned).replace(/\s+/g, ' ').trim();
}

export function extractTitle(html: string): string {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decodeEntities(m[1]).replace(/\s+/g, ' ').trim() : '';
}

/** Extract internal links (href + anchor text), resolved against the page URL. */
export function extractLinks(html: string, baseUrl: string): { href: string; text: string }[] {
  const out: { href: string; text: string }[] = [];
  const re = /<a\b[^>]*href=["']([^"'#?][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    return out;
  }
  while ((m = re.exec(html)) !== null) {
    let href = m[1];
    if (/^(mailto:|tel:|javascript:|data:)/i.test(href)) continue;
    try {
      const abs = new URL(href, base);
      abs.hash = '';
      if (abs.origin !== base.origin) continue; // same-site only
      const text = decodeEntities(m[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
      out.push({ href: abs.toString(), text });
    } catch {
      /* ignore malformed */
    }
  }
  return out;
}

/** Heuristic: did we get a JS-only shell with no real content? */
function looksJsOnly(html: string, text: string): boolean {
  if (text.length > 400) return false;
  return /enable javascript|please enable js|id=["']root["']|id=["']app["']|__NEXT_DATA__/i.test(html);
}

/**
 * Fetch-based fallback crawler. No browser required: plain HTTP, visible-text
 * extraction, keyword-prioritized internal links, robots.txt, polite delays.
 * Marks every page crawl_method = "fetch_fallback" and flags missing JS render.
 */
export class FetchResearch implements ResearchProvider {
  async close(): Promise<void> {}

  private async fetchPage(url: string, category: string): Promise<PageContent> {
    const base: PageContent = {
      url,
      finalUrl: url,
      ok: false,
      status: 0,
      title: '',
      text: '',
      category,
      crawlMethod: 'fetch_fallback',
      fetchedAt: new Date().toISOString(),
    };
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': config.crawl.userAgent, accept: 'text/html,*/*' },
        redirect: 'follow',
        signal: AbortSignal.timeout(config.crawl.pageTimeoutMs),
      });
      base.status = res.status;
      base.finalUrl = res.url || url;
      base.ok = res.ok;
      const ct = res.headers.get('content-type') ?? '';
      if (!res.ok || !/html|text/.test(ct)) {
        if (!res.ok) base.error = `HTTP ${res.status}`;
        else base.error = `non-html content-type: ${ct}`;
        return base;
      }
      const html = await res.text();
      base.title = extractTitle(html);
      base.text = extractText(html).slice(0, 12000);
      (base as PageContent & { _html?: string })._html = html; // transient, for link discovery
      return base;
    } catch (err) {
      base.error = (err as Error).message;
      return base;
    }
  }

  async research(input: ResearchInput): Promise<ResearchBundle> {
    const { query, searchResults, officialSite, originalSiteWorks } =
      await discoverOfficialSite(input);

    const pages: PageContent[] = [];
    const robotsBlockedUrls: string[] = [];
    const maxPages = config.research.fetchMaxPages;
    let jsWarning = false;

    if (officialSite) {
      const origin = new URL(officialSite).origin;
      const robots = await RobotsRules.forOrigin(origin);

      const visit = async (url: string, category: string): Promise<PageContent | null> => {
        if (pages.length >= maxPages) return null;
        if (!robots.isAllowed(url)) {
          robotsBlockedUrls.push(url);
          return null;
        }
        const pc = await this.fetchPage(url, category);
        pages.push(pc);
        await sleep(config.crawl.delayMs); // polite rate limit
        return pc;
      };

      const home = await visit(officialSite, 'home');
      if (home?.ok) {
        const html = (home as PageContent & { _html?: string })._html ?? '';
        if (looksJsOnly(html, home.text)) jsWarning = true;

        // Prioritize internal links by category; one best link per category.
        const links = extractLinks(html, home.finalUrl);
        const pickedCategories = new Set<string>();
        const ordered: { url: string; category: string }[] = [];
        for (const l of links) {
          const cat = categorizeLink(l.href, l.text);
          if (!cat || pickedCategories.has(cat)) continue;
          pickedCategories.add(cat);
          ordered.push({ url: l.href, category: cat });
        }
        for (const { url, category } of ordered) {
          if (pages.length >= maxPages) break;
          await visit(url, category);
        }
      }
      // Clean up transient html before returning.
      for (const p of pages) delete (p as PageContent & { _html?: string })._html;
    } else {
      logger.warn(`no official site found for "${input.name}" (fetch fallback)`);
    }

    const note =
      'Crawled with the plain-HTTP fetch fallback (no JavaScript rendering). ' +
      (jsWarning
        ? 'The homepage appears to be a JavaScript-rendered app, so dynamic content may be missing.'
        : 'Dynamic/JS-injected content may be missing.');

    return {
      query,
      searchResults,
      officialSite,
      originalSiteWorks,
      pages,
      robotsBlockedUrls,
      crawlMethod: 'fetch_fallback',
      jsRendered: false,
      note,
    };
  }
}
