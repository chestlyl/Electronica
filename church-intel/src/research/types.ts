import type { StaffCard } from './staffCards.js';

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  /** Which search engine returned this result (set by multiSearch). */
  provider?: string;
}

export type CrawlMethod = 'playwright' | 'playwright_rendered' | 'fetch' | 'fetch_fallback' | 'none';

/**
 * Per-link crawl decision trace for a homepage (and fallback probes). Surfaced
 * in calibration diagnostics to answer "why was/wasn't this page crawled?".
 */
export interface LinkDiagnostic {
  anchorText: string;          // visible link text ('(probe)' for fallback paths)
  href: string;                // raw href as discovered (or the probed path)
  resolvedUrl: string;         // absolute resolved URL ('' if unresolvable)
  sameOrigin: boolean;         // same host as the official site?
  category: string | null;     // categorizeLink(path, anchorText) result
  selected: boolean;           // chosen for crawl
  fetched: boolean;            // actually fetched with HTTP 2xx
  textLength: number;          // extracted visible text length (rendered; 0 if not fetched)
  hasStaffContactSignal: boolean; // page text held email / phone / pastor-title
  discovery: 'homepage_link' | 'fallback_probe';
  // staff-page render diagnostics (populated for staff/leadership pages)
  crawlMethod?: CrawlMethod;
  rawTextLength?: number;
  gainRatio?: number;
  staffNames?: number;
  staffRoles?: number;
}

export interface PageContent {
  url: string;
  finalUrl: string;
  ok: boolean;
  status: number;
  title: string;
  text: string;        // readable, truncated text content
  category: string;    // home | about | staff | beliefs | contact | ...
  crawlMethod: CrawlMethod;
  // rendered-DOM diagnostics (in-memory only)
  rawTextLength?: number;
  renderedTextLength?: number;
  renderedGainRatio?: number;
  mailto?: string[];
  tel?: string[];
  navLabels?: string[];
  /** Outbound links (resolved absolute URL + visible anchor text) — preserved for
   *  strategic-signal classification (not just the homepage crawl decisions). */
  outboundLinks?: { url: string; text: string }[];
  staffBlocks?: string[];
  staffCards?: StaffCard[];          // {name,title} pairs from staff/leadership pages
  staffNamesDetected?: number;
  staffRolesDetected?: number;
  error?: string;
  fetchedAt: string;
}

/** Everything one research pass gathered for a church, shared across agents. */
export interface ResearchBundle {
  query: string;
  searchResults: SearchResult[];
  officialSite: string | null;
  originalSiteWorks: boolean | null;
  pages: PageContent[];
  robotsBlockedUrls: string[];
  /** Per-link crawl decision trace from the homepage + fallback probes. */
  linkDiagnostics?: LinkDiagnostic[];
  /** How the page text was obtained. */
  crawlMethod: CrawlMethod;
  /** False when a non-JS fetch crawler was used (dynamic content may be missed). */
  jsRendered: boolean;
  /** Rendered-DOM diagnostics for the official homepage (in-memory only). */
  officialDomFetched?: boolean;
  renderedDomUsed?: boolean;
  rawTextLength?: number;
  renderedTextLength?: number;
  renderedGainRatio?: number;
  /** Human-readable note when research was degraded or failed. */
  note?: string;
  /** How the official site was discovered (provenance for the agents). */
  discoveryNote?: string;
}

export interface ResearchInput {
  name: string;
  city: string | null;
  state: string | null;
  originalWebsite: string | null;
  originalPhone: string | null;
  originalEmail: string | null;
  /** Alternate church name / "Url Name" seed value, used to aid discovery. */
  alternateName: string | null;
  /**
   * known_church: anchor on the provided URL; do NOT run broad web discovery.
   * market_discovery: search/nominate/verify candidate domains. Defaults to
   * known_church when a website is provided, else market_discovery.
   */
  mode?: 'known_church' | 'market_discovery';
  /**
   * When set, the crawler skips its own discovery pass and crawls this site
   * directly. Used during enrich so discovery runs once (in the dossier
   * identity step) instead of twice.
   */
  preResolvedOfficialSite?: string | null;
}

export interface ResearchProvider {
  research(input: ResearchInput): Promise<ResearchBundle>;
  close(): Promise<void>;
}
