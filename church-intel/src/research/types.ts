export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export type CrawlMethod = 'playwright' | 'fetch_fallback' | 'none';

export interface PageContent {
  url: string;
  finalUrl: string;
  ok: boolean;
  status: number;
  title: string;
  text: string;        // readable, truncated text content
  category: string;    // home | about | staff | beliefs | contact | ...
  crawlMethod: CrawlMethod;
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
  /** Human-readable note when research was degraded or failed. */
  note?: string;
}

export interface ResearchInput {
  name: string;
  city: string | null;
  state: string | null;
  originalWebsite: string | null;
  originalPhone: string | null;
  originalEmail: string | null;
}

export interface ResearchProvider {
  research(input: ResearchInput): Promise<ResearchBundle>;
  close(): Promise<void>;
}
