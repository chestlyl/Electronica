import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import { RobotsRules } from './robots.js';
import { smartFetch } from './renderedFetch.js';
import { categorizeLink, discoverOfficialSite, sleep, type Discovery } from './discover.js';
import type {
  LinkDiagnostic,
  PageContent,
  ResearchBundle,
  ResearchInput,
  ResearchProvider,
} from './types.js';

/** Well-known staff/contact paths to probe when the homepage crawl found none. */
const COMMON_STAFF_CONTACT_PATHS = ['/staff', '/team', '/leadership', '/about', '/contact', '/connect'];
const FALLBACK_MAX_PROBES = 6;

const SIGNAL_EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const SIGNAL_PHONE = /\(?\b\d{3}\)?[ .\-]\d{3}[ .\-]\d{4}\b/;
const SIGNAL_ROLE = /\b(lead|senior|associate|executive|founding)\s+pastor\b/i;
/** Does this page text hold actual staff/contact DATA (email, phone, or pastor title)? */
function hasStaffContactSignal(text: string): boolean {
  return SIGNAL_EMAIL.test(text) || SIGNAL_PHONE.test(text) || SIGNAL_ROLE.test(text);
}
const pageSignalText = (p: { title?: string; text?: string } | null | undefined) => `${p?.title ?? ''} ${p?.text ?? ''}`;

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

  private async fetchPage(url: string, category: string, allowRender: boolean): Promise<PageContent & { _linkPairs?: { href: string; text: string }[] }> {
    const r = await smartFetch(url, allowRender);
    const pc: PageContent & { _linkPairs?: { href: string; text: string }[] } = {
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
      _linkPairs: r.linkPairs,
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
    const linkDiagnostics: LinkDiagnostic[] = [];
    const maxPages = config.research.fetchMaxPages;
    const allowRender = !config.research.forceFetchFallback;

    if (officialSite) {
      const origin = new URL(officialSite).origin;
      const robots = await RobotsRules.forOrigin(origin);

      // `ignoreLimit` lets the targeted staff/contact fallback run even when the
      // category crawl has already reached maxPages (its own cap below).
      const visit = async (url: string, category: string, ignoreLimit = false): Promise<(PageContent & { _linkPairs?: { href: string; text: string }[] }) | null> => {
        if (!ignoreLimit && pages.length >= maxPages) return null;
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
        // Prioritize internal links by category, using BOTH the URL path AND the
        // visible anchor text. Many church sites use opaque paths (e.g. /o/abc123)
        // with descriptive labels ("Staff", "Connect", "Our Team"), so dropping
        // the anchor text would hide the staff/contact subpages entirely.
        const pickedCategories = new Set<string>();
        const ordered: { url: string; category: string }[] = [];
        const seen = new Set<string>();
        for (const { href, text } of home._linkPairs ?? []) {
          if (/^(mailto:|tel:|javascript:|data:)/i.test(href)) continue;
          let resolvedUrl = ''; let sameOrigin = false; let category: string | null = null; let selected = false;
          try {
            const abs = new URL(href, home.finalUrl);
            abs.hash = '';
            resolvedUrl = abs.toString();
            sameOrigin = abs.origin === origin;
            if (sameOrigin) {
              category = categorizeLink(abs.pathname, text);
              if (category && !pickedCategories.has(category)) {
                pickedCategories.add(category);
                ordered.push({ url: resolvedUrl, category });
                selected = true;
              }
            }
          } catch { /* unresolvable href */ }
          const key = resolvedUrl || `raw:${href}`;
          if (seen.has(key)) continue;
          seen.add(key);
          linkDiagnostics.push({ anchorText: text, href, resolvedUrl, sameOrigin, category, selected, fetched: false, textLength: 0, hasStaffContactSignal: false, discovery: 'homepage_link' });
        }
        const markFetched = (url: string, pc: PageContent | null) => {
          const d = linkDiagnostics.find((x) => x.resolvedUrl === url && x.discovery === 'homepage_link');
          if (d) { d.fetched = !!pc?.ok; d.textLength = pc?.ok ? (pc.text?.length ?? 0) : 0; d.hasStaffContactSignal = pc?.ok ? hasStaffContactSignal(pageSignalText(pc)) : false; }
        };
        for (const { url, category } of ordered) {
          if (pages.length >= maxPages) break;
          markFetched(url, await visit(url, category));
        }
      }

      // Targeted fallback: if NOTHING fetched so far yields staff/contact data,
      // probe well-known paths before giving up. This rescues JS-rendered nav
      // (links absent from raw HTML, e.g. /staff) and unlinked staff pages.
      const haveData = pages.some((p) => p.ok && hasStaffContactSignal(pageSignalText(p)));
      if (home?.ok && !haveData) {
        const already = new Set<string>(pages.flatMap((p) => [p.url, p.finalUrl]));
        let probes = 0;
        for (const path of COMMON_STAFF_CONTACT_PATHS) {
          if (probes >= FALLBACK_MAX_PROBES) break;
          const url = origin + path;
          if (already.has(url)) continue;
          probes++;
          const category = categorizeLink(path, '') ?? 'contact';
          const pc = await visit(url, category, true); // bypass maxPages — bounded by FALLBACK_MAX_PROBES
          const signal = !!pc?.ok && hasStaffContactSignal(pageSignalText(pc));
          linkDiagnostics.push({ anchorText: '(probe)', href: path, resolvedUrl: url, sameOrigin: true, category, selected: true, fetched: !!pc?.ok, textLength: pc?.ok ? (pc.text?.length ?? 0) : 0, hasStaffContactSignal: signal, discovery: 'fallback_probe' });
          if (signal) break; // found staff/contact data — stop probing
        }
      }

      for (const p of pages) delete (p as PageContent & { _linkPairs?: unknown })._linkPairs;
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
      linkDiagnostics,
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
