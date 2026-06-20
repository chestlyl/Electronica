export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  /** Which search engine returned this result (set by multiSearch). */
  provider?: string;
}

export type CrawlMethod = 'playwright' | 'playwright_rendered' | 'fetch' | 'fetch_fallback' | 'none';

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
  staffBlocks?: string[];
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
