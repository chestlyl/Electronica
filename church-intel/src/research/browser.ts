import { chromium, type Browser, type BrowserContext } from 'playwright';
import { existsSync } from 'node:fs';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import { RobotsRules } from './robots.js';
import {
  PAGE_CATEGORIES,
  discoverOfficialSite,
  sleep,
  type Discovery,
} from './discover.js';
import type {
  PageContent,
  ResearchBundle,
  ResearchInput,
  ResearchProvider,
} from './types.js';

/** True if Playwright's Chromium browser is actually installed on disk. */
export function chromiumInstalled(): boolean {
  try {
    const p = chromium.executablePath();
    return !!p && existsSync(p);
  } catch {
    return false;
  }
}

export class PlaywrightResearch implements ResearchProvider {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;

  private async ctx(): Promise<BrowserContext> {
    if (!this.browser) {
      this.browser = await chromium.launch({ headless: config.crawl.headless });
      this.context = await this.browser.newContext({
        userAgent: config.crawl.userAgent,
        ignoreHTTPSErrors: true,
      });
      this.context.setDefaultNavigationTimeout(config.crawl.pageTimeoutMs);
    }
    return this.context!;
  }

  async close(): Promise<void> {
    await this.context?.close().catch(() => {});
    await this.browser?.close().catch(() => {});
    this.browser = null;
    this.context = null;
  }

  private async fetchPage(url: string, category: string): Promise<PageContent> {
    const ctx = await this.ctx();
    const page = await ctx.newPage();
    const base: PageContent = {
      url,
      finalUrl: url,
      ok: false,
      status: 0,
      title: '',
      text: '',
      category,
      crawlMethod: 'playwright',
      fetchedAt: new Date().toISOString(),
    };
    try {
      const resp = await page.goto(url, { waitUntil: 'domcontentloaded' });
      base.status = resp?.status() ?? 0;
      base.finalUrl = page.url();
      base.ok = !!resp && resp.ok();
      base.title = await page.title().catch(() => '');
      const text = await page.evaluate(() => {
        const drop = document.querySelectorAll('script,style,noscript,svg,nav,footer header');
        drop.forEach((e) => e.remove());
        return (document.body?.innerText || '').replace(/\n{2,}/g, '\n').trim();
      });
      base.text = text.slice(0, 12000);
      return base;
    } catch (err) {
      base.error = (err as Error).message;
      return base;
    } finally {
      await page.close().catch(() => {});
    }
  }

  /** From a homepage, collect candidate internal links bucketed by category. */
  private async discoverInternalLinks(home: PageContent, origin: string): Promise<Map<string, string>> {
    const picked = new Map<string, string>(); // category -> url
    const ctx = await this.ctx();
    const page = await ctx.newPage();
    try {
      await page.goto(home.finalUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
      const links: { href: string; text: string }[] = await page.evaluate(() =>
        Array.from(document.querySelectorAll('a[href]')).map((a) => ({
          href: (a as HTMLAnchorElement).href,
          text: (a.textContent || '').toLowerCase().trim(),
        })),
      );
      for (const { category, keywords } of PAGE_CATEGORIES) {
        if (picked.has(category)) continue;
        const hit = links.find((l) => {
          let sameHost = false;
          try {
            sameHost = new URL(l.href).origin === origin;
          } catch {
            return false;
          }
          if (!sameHost) return false;
          const hay = (l.href + ' ' + l.text).toLowerCase();
          return keywords.some((k) => hay.includes(k));
        });
        if (hit) picked.set(category, hit.href.split('#')[0]);
      }
    } catch (err) {
      logger.debug(`link discovery failed: ${(err as Error).message}`);
    } finally {
      await page.close().catch(() => {});
    }
    return picked;
  }

  async research(input: ResearchInput): Promise<ResearchBundle> {
    // Reuse an already-resolved official site (skip a redundant discovery pass).
    const disc: Discovery = input.preResolvedOfficialSite
      ? { query: [input.name, input.city, input.state].filter(Boolean).join(' '), searchResults: [], officialSite: input.preResolvedOfficialSite, originalSiteWorks: null, discoveryNote: 'official site reused from dossier identity (discovery skipped)' }
      : await discoverOfficialSite(input);
    const { query, searchResults, officialSite, originalSiteWorks, discoveryNote } = disc;

    const pages: PageContent[] = [];
    const robotsBlockedUrls: string[] = [];

    if (officialSite) {
      const origin = new URL(officialSite).origin;
      const robots = await RobotsRules.forOrigin(origin);

      const visit = async (url: string, category: string) => {
        if (pages.length >= config.crawl.maxPagesPerSite) return;
        if (!robots.isAllowed(url)) {
          robotsBlockedUrls.push(url);
          return;
        }
        const pc = await this.fetchPage(url, category);
        pages.push(pc);
        await sleep(config.crawl.delayMs); // polite rate limit
      };

      await visit(officialSite, 'home');
      const home = pages[0];
      if (home?.ok) {
        const internal = await this.discoverInternalLinks(home, origin);
        for (const [category, url] of internal) {
          if (pages.length >= config.crawl.maxPagesPerSite) break;
          await visit(url, category);
        }
      }
    } else {
      logger.warn(`no official site found for "${input.name}"`);
    }

    return {
      query,
      searchResults,
      officialSite,
      originalSiteWorks,
      pages,
      robotsBlockedUrls,
      crawlMethod: 'playwright',
      jsRendered: true,
      discoveryNote,
    };
  }
}
