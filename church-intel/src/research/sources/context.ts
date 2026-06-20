import type { DiscoveryResult } from '../discovery.js';
import type { ResearchProvider } from '../types.js';

export interface ResearchContext {
  name: string;
  city: string | null;
  state: string | null;
  originalWebsite: string | null;
  alternateName: string | null;
  identity: DiscoveryResult;
  /**
   * The effective official site to research: the identity-verified site if we
   * have one, else the claimed/original domain (which we may not be able to
   * fetch — in which case only snippet evidence is gathered and confidence is
   * capped). May be null when truly unknown.
   */
  officialSite: string | null;
  /** Used by the website collector to crawl the official site. */
  research: ResearchProvider;
}
