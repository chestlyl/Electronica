import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import { RobotsRules } from './robots.js';
import { smartFetch } from './renderedFetch.js';
import { rolesDetected } from './staffCards.js';
import { categorizeLink, discoverOfficialSite, sleep, type Discovery } from './discover.js';
import type {
  LinkDiagnostic,
  PageContent,
  ResearchBundle,
  ResearchInput,
  ResearchProvider,
} from './types.js';

/** Upper bound on fallback path probes (minimum-coverage, not exhaustive). */
const FALLBACK_MAX_PROBES = 18;
/** Per-category probe cap so a long staff path list can't starve contact/about. */
const PER_CATEGORY_MAX_PROBES = 5;

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

/**
 * Resolve raw link pairs (href + anchor text) into absolute outbound links,
 * preserving BOTH same-site and external destinations (external hosts like
 * churchcenter.com / pushpay.com are exactly the strategic signals we need).
 * Deduped by URL; bounded so a link-heavy page can't bloat the finding.
 */
const OUTBOUND_LINK_CAP = 150;
export function resolveOutboundLinks(pairs: { href: string; text: string }[], baseUrl: string): { url: string; text: string }[] {
  const out: { url: string; text: string }[] = [];
  const seen = new Set<string>();
  let base: URL | null = null;
  try { base = new URL(baseUrl); } catch { /* unresolvable base — keep absolute hrefs only */ }
  for (const { href, text } of pairs) {
    if (/^(mailto:|tel:|javascript:|data:)/i.test(href)) continue;
    let url = '';
    try {
      const abs = base ? new URL(href, base) : new URL(href);
      abs.hash = '';
      url = abs.toString();
    } catch { continue; }
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ url, text: (text || '').slice(0, 120) });
    if (out.length >= OUTBOUND_LINK_CAP) break;
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
    // Staff/leadership pages hold their data in the JS-rendered DOM — force a
    // browser render and run the staff-card heuristic on them.
    const staffMode = category === 'staff' || category === 'leadership';
    const r = await smartFetch(url, allowRender, { forceRender: staffMode, staffMode });
    // Preserve EVERY outbound link (resolved absolute URL + anchor text) on the
    // page itself — a public field that survives the `_linkPairs` cleanup in
    // research(). Strategic-signal classification needs links from every page,
    // not just the homepage crawl-decision diagnostics. (smartFetch returns
    // same-site link pairs; resolve them and keep external destinations too.)
    const outboundLinks = resolveOutboundLinks(r.linkPairs ?? [], r.finalUrl);
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
      outboundLinks,
      staffBlocks: r.staffBlocks,
      staffCards: r.staffCards,
      staffNamesDetected: r.staffCards.length,
      staffRolesDetected: rolesDetected(r.staffCards),
      fetchedAt: new Date().toISOString(),
      _linkPairs: r.linkPairs,
    };
    if (!r.ok) pc.error = `HTTP ${r.status}`;
    if (staffMode && r.ok) {
      logger.info(`  staff render: ${url} — ${r.crawlMethod} · raw ${r.rawTextLength} → rendered ${r.renderedTextLength} (gain ×${r.gainRatio}) · names ${pc.staffNamesDetected} roles ${pc.staffRolesDetected}`);
    }
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
          if (d) {
            d.fetched = !!pc?.ok; d.textLength = pc?.ok ? (pc.text?.length ?? 0) : 0; d.hasStaffContactSignal = pc?.ok ? hasStaffContactSignal(pageSignalText(pc)) : false;
            d.crawlMethod = pc?.crawlMethod; d.rawTextLength = pc?.rawTextLength; d.gainRatio = pc?.renderedGainRatio;
            d.staffNames = pc?.staffNamesDetected; d.staffRoles = pc?.staffRolesDetected;
          }
        };
        for (const { url, category } of ordered) {
          if (pages.length >= maxPages) break;
          markFetched(url, await visit(url, category));
        }
      }

      // Minimum-evidence coverage: ensure the REQUIRED categories (staff,
      // contact, about) were attempted. Probe well-known paths for any required
      // category not already fetched via homepage links. Bounded by
      // FALLBACK_MAX_PROBES — this is minimum coverage, NOT exhaustive crawling.
      if (home?.ok) {
        const fetchedCats = new Set(pages.filter((p) => p.ok).map((p) => p.category));
        const required: { covered: () => boolean; fallbackCat: string; paths: string[] }[] = [
          // Large multi-campus sites bury leadership under /about/leaders (and use
          // /people, /meet-the-team) — probe those, not just small-church roots.
          { covered: () => fetchedCats.has('staff') || fetchedCats.has('leadership'), fallbackCat: 'staff', paths: ['/staff', '/about/leaders', '/leadership', '/about/leadership', '/leaders', '/team', '/our-team', '/about/staff', '/meet-the-team', '/people'] },
          { covered: () => fetchedCats.has('contact'), fallbackCat: 'contact', paths: ['/contact', '/connect', '/contact-us'] },
          { covered: () => fetchedCats.has('about'), fallbackCat: 'about', paths: ['/about', '/about-us', '/who-we-are'] },
          // Valuable coverage categories — probe the well-known roots when a
          // JS-injected nav hides the links from the homepage HTML.
          { covered: () => fetchedCats.has('giving'), fallbackCat: 'giving', paths: ['/give', '/giving', '/generosity'] },
          { covered: () => fetchedCats.has('sermons'), fallbackCat: 'sermons', paths: ['/sermons', '/messages', '/watch', '/media'] },
          { covered: () => fetchedCats.has('groups'), fallbackCat: 'groups', paths: ['/groups', '/small-groups', '/community'] },
          { covered: () => fetchedCats.has('locations'), fallbackCat: 'locations', paths: ['/locations', '/campuses'] },
        ];
        const already = new Set<string>(pages.flatMap((p) => [p.url, p.finalUrl]));
        let probes = 0;
        for (const req of required) {
          if (req.covered() || probes >= FALLBACK_MAX_PROBES) continue;
          let catProbes = 0;
          for (const path of req.paths) {
            if (probes >= FALLBACK_MAX_PROBES || catProbes >= PER_CATEGORY_MAX_PROBES) break;
            const url = origin + path;
            if (already.has(url)) continue;
            probes++; catProbes++;
            const category = categorizeLink(path, '') ?? req.fallbackCat;
            const pc = await visit(url, category, true); // bypass maxPages — bounded by FALLBACK_MAX_PROBES
            const signal = !!pc?.ok && hasStaffContactSignal(pageSignalText(pc));
            linkDiagnostics.push({ anchorText: '(probe)', href: path, resolvedUrl: url, sameOrigin: true, category, selected: true, fetched: !!pc?.ok, textLength: pc?.ok ? (pc.text?.length ?? 0) : 0, hasStaffContactSignal: signal, discovery: 'fallback_probe', crawlMethod: pc?.crawlMethod, rawTextLength: pc?.rawTextLength, gainRatio: pc?.renderedGainRatio, staffNames: pc?.staffNamesDetected, staffRoles: pc?.staffRolesDetected });
            if (pc?.ok) { fetchedCats.add(pc.category ?? category); already.add(pc.url); already.add(pc.finalUrl); break; } // category covered — move on
          }
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
