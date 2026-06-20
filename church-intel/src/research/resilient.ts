import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import { PlaywrightResearch, chromiumInstalled } from './browser.js';
import { FetchResearch } from './fetchCrawler.js';
import type { ResearchBundle, ResearchInput, ResearchProvider } from './types.js';

export interface ResilientOptions {
  /** Force the fetch fallback even when Chromium is installed. */
  forceFetch?: boolean;
}

/**
 * Research provider that degrades gracefully:
 *   1. Playwright (full JS rendering) when Chromium is installed
 *   2. Fetch fallback (plain HTTP) when Chromium is missing / Playwright fails
 *   3. If both yield nothing, returns an empty bundle with crawlMethod="none"
 *      so the orchestrator can record a review-queue item explaining why.
 */
export class ResilientResearch implements ResearchProvider {
  private playwright: PlaywrightResearch | null = null;
  private fetchProvider = new FetchResearch();
  private forceFetch: boolean;
  private warnedNoBrowser = false;

  constructor(opts: ResilientOptions = {}) {
    this.forceFetch = opts.forceFetch ?? config.research.forceFetchFallback;
  }

  private pw(): PlaywrightResearch {
    if (!this.playwright) this.playwright = new PlaywrightResearch();
    return this.playwright;
  }

  async research(input: ResearchInput): Promise<ResearchBundle> {
    const okCount = (b: ResearchBundle) => b.pages.filter((p) => p.ok).length;

    if (this.forceFetch) {
      logger.info('research: forced fetch fallback mode');
      return this.fetchProvider.research(input);
    }

    if (!chromiumInstalled()) {
      if (!this.warnedNoBrowser) {
        logger.warn(
          'Playwright Chromium not installed — using fetch fallback ' +
            '(no JS rendering). Run `npx playwright install chromium` for full crawling.',
        );
        this.warnedNoBrowser = true;
      }
      return this.fetchProvider.research(input);
    }

    try {
      const bundle = await this.pw().research(input);
      if (bundle.officialSite && okCount(bundle) === 0) {
        logger.warn('Playwright produced no readable pages; retrying with fetch fallback');
        const fb = await this.fetchProvider.research(input);
        return okCount(fb) > 0 ? fb : bundle;
      }
      return bundle;
    } catch (err) {
      logger.warn(`Playwright failed (${(err as Error).message}); using fetch fallback`);
      return this.fetchProvider.research(input);
    }
  }

  async close(): Promise<void> {
    await this.playwright?.close();
    await this.fetchProvider.close();
  }
}
