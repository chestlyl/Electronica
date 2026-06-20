import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import { chromiumInstalled } from './browser.js';
import { FetchResearch } from './fetchCrawler.js';
import { closeRenderBrowser } from './renderedFetch.js';
import type { ResearchBundle, ResearchInput, ResearchProvider } from './types.js';

export interface ResilientOptions {
  /** Force plain fetch — never escalate to a rendered browser. */
  forceFetch?: boolean;
}

/**
 * Render-aware research provider. Uses the FetchResearch crawler, which fetches
 * each page and escalates to a headless browser (Playwright) per-page only when
 * the plain-fetch output is thin/JS-rendered. When Chromium is missing (or
 * forceFetch), it stays on plain fetch and labels pages fetch/fetch_fallback.
 */
export class ResilientResearch implements ResearchProvider {
  private fetchProvider = new FetchResearch();
  private warnedNoBrowser = false;

  constructor(opts: ResilientOptions = {}) {
    if (opts.forceFetch) config.research.forceFetchFallback = true;
  }

  async research(input: ResearchInput): Promise<ResearchBundle> {
    if (!chromiumInstalled() && !config.research.forceFetchFallback && !this.warnedNoBrowser) {
      logger.warn(
        'Playwright Chromium not installed — JS-rendered sites will be thin. ' +
          'Run `npx playwright install chromium` to enable rendered crawling.',
      );
      this.warnedNoBrowser = true;
    }
    return this.fetchProvider.research(input);
  }

  async close(): Promise<void> {
    await this.fetchProvider.close();
    await closeRenderBrowser();
  }
}
