import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import { RobotsRules } from './robots.js';
import { smartFetch } from './renderedFetch.js';
import { categorizeLink, discoverOfficialSite, sleep, type Discovery } from './discover.js';
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
 * Render-aware crawler: plain HTTP fetch, escalating per-page to a headless
 * browser (Playwright) when the fetch output is thin/JS-rendered. Extracts
 * visible text, links, mailto/tel, nav labels, and staff-card blocks, with
 * crawl-method + raw-vs-rendered diagnostics. Honors robots.txt + polite delays.
 */
export class FetchResearch implements ResearchProvider {
  async close(): Promise<void> {}

  private async fetchPage(url: string, category: string, allowRender: boolean): Promise<PageContent & { _links?: string[] }> {
    const r = await smartFetch(url, allowRender);
    const pc: PageContent & { _links?: string[] } = {
      url,
      finalUrl: r.finalUrl,
      ok: r.ok,
      status: r.status,
      title: r.title,
      text: r.text.slice(0, 12000),
      category,
      crawlMethod: r.crawlMethod,
      rawTextLength: r.rawTextLength,
      renderedTextLength: r.renderedTextLength,
      renderedGainRatio: r.gainRatio,
      mailto: r.mailto,
      tel: r.tel,
      navLabels: r.navLabels,
      staffBlocks: r.staffBlocks,
      fetchedAt: new Date().toISOString(),
      _links: r.links,
    };
    if (!r.ok) pc.error = `HTTP ${r.status}`;
    return pc;
  }

  async research(input: ResearchInput): Promise<ResearchBundle> {
    // Reuse an already-resolved official site (skip a redundant discovery pass).
    const disc: Discovery = input.preResolvedOfficialSite
      ? { query: [input.name, input.city, input.state].filter(Boolean).join(' '), searchResults: [], officialSite: input.preResolvedOfficialSite, originalSiteWorks: null, discoveryNote: 'official site reused from dossier identity (discovery skipped)' }
      : await discoverOfficialSite(input);
    const { query, searchResults, officialSite, originalSiteWorks, discoveryNote } = disc;

    const pages: PageContent[] = [];
    const robotsBlockedUrls: string[] = [];
    const maxPages = config.research.fetchMaxPages;
    const allowRender = !config.research.forceFetchFallback;

    if (officialSite) {
      const origin = new URL(officialSite).origin;
      const robots = await RobotsRules.forOrigin(origin);

      const visit = async (url: string, category: string): Promise<(PageContent & { _links?: string[] }) | null> => {
        if (pages.length >= maxPages) return null;
        if (!robots.isAllowed(url)) {
          robotsBlockedUrls.push(url);
          return null;
        }
        const pc = await this.fetchPage(url, category, allowRender);
        pages.push(pc);
        await sleep(config.crawl.delayMs); // polite rate limit
        return pc;
      };

      const home = await visit(officialSite, 'home');
      if (home?.ok) {
        // Prioritize internal links by category (from the rendered/raw links).
        const pickedCategories = new Set<string>();
        const ordered: { url: string; category: string }[] = [];
        for (const href of home._links ?? []) {
          if (/^(mailto:|tel:|javascript:|data:)/i.test(href)) continue;
          try {
            const abs = new URL(href, home.finalUrl);
            if (abs.origin !== origin) continue;
            abs.hash = '';
            const cat = categorizeLink(abs.pathname, '');
            if (!cat || pickedCategories.has(cat)) continue;
            pickedCategories.add(cat);
            ordered.push({ url: abs.toString(), category: cat });
          } catch { /* ignore */ }
        }
        for (const { url, category } of ordered) {
          if (pages.length >= maxPages) break;
          await visit(url, category);
        }
      }
      for (const p of pages) delete (p as PageContent & { _links?: string[] })._links;
    } else {
      logger.warn(`no official site found for "${input.name}"`);
    }

    const renderedDomUsed = pages.some((p) => p.crawlMethod === 'playwright_rendered');
    const officialDomFetched = pages.some((p) => p.ok);
    const home = pages[0];
    const note = renderedDomUsed
      ? 'Official site rendered with a headless browser (Playwright); dynamic content captured.'
      : officialDomFetched
        ? 'Crawled via plain HTTP fetch (content was not JS-rendered).'
        : 'Could not fetch the official site DOM; evidence is from snippets/third-party sources only.';

    return {
      query,
      searchResults,
      officialSite,
      originalSiteWorks,
      pages,
      robotsBlockedUrls,
      crawlMethod: renderedDomUsed ? 'playwright_rendered' : officialDomFetched ? 'fetch' : 'fetch_fallback',
      jsRendered: renderedDomUsed,
      note,
      discoveryNote,
      officialDomFetched,
      renderedDomUsed,
      rawTextLength: home?.rawTextLength,
      renderedTextLength: home?.renderedTextLength,
      renderedGainRatio: home?.renderedGainRatio,
    };
  }
}
