import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import { discoverWebsite } from './discovery.js';
import type { ResearchInput, SearchResult } from './types.js';

/**
 * Internal pages we care about, with the link keywords that identify them.
 * ORDER MATTERS: the first matching category wins. staff/leadership are listed
 * BEFORE 'about' so a deep path like `/about/leaders/` or `/about/our-team`
 * (common on large multi-campus sites) is recognized as a leadership/staff page
 * rather than swallowed by the 'about' keyword.
 */
export const PAGE_CATEGORIES: { category: string; keywords: string[] }[] = [
  { category: 'staff', keywords: ['staff', 'our-team', 'meet-the-team', 'meet-our-team', 'people'] },
  { category: 'leadership', keywords: ['leadership', 'leaders', 'elders', 'pastors', 'our-leadership', 'lead-team', 'team'] },
  { category: 'about', keywords: ['about', 'who-we-are', 'our-story', 'whoweare'] },
  { category: 'beliefs', keywords: ['belief', 'what-we-believe', 'values', 'doctrine', 'mission-vision'] },
  { category: 'contact', keywords: ['contact', 'connect', 'visit', 'plan-a-visit', 'plan-your-visit'] },
  { category: 'locations', keywords: ['location', 'campus', 'campuses', 'times', 'service-times'] },
  { category: 'ministries', keywords: ['ministr', 'groups', 'discipleship'] },
  { category: 'missions', keywords: ['mission', 'outreach', 'global', 'serve'] },
  { category: 'church-planting', keywords: ['plant', 'church-planting', 'multiply', 'multiplication'] },
  { category: 'residency', keywords: ['residency', 'internship', 'cohort', 'school-of-ministry', 'training'] },
  { category: 'partners', keywords: ['partner', 'network', 'affiliation'] },
];

/** Match a link (href + anchor text) to the first page category it fits. */
export function categorizeLink(href: string, text: string): string | null {
  const hay = `${href} ${text}`.toLowerCase();
  for (const { category, keywords } of PAGE_CATEGORIES) {
    if (keywords.some((k) => hay.includes(k))) return category;
  }
  return null;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function normalizeUrl(raw: string | null): string | null {
  if (!raw) return null;
  let u = raw.trim();
  if (!/^https?:\/\//i.test(u)) u = 'http://' + u;
  try {
    return new URL(u).toString();
  } catch {
    return null;
  }
}

/** Can we GET this URL successfully? (plain fetch, no browser) */
export async function checkReachable(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'user-agent': config.crawl.userAgent },
      signal: AbortSignal.timeout(10000),
      redirect: 'follow',
    });
    return res.ok;
  } catch {
    return false;
  }
}

export interface Discovery {
  query: string;
  searchResults: SearchResult[];
  officialSite: string | null;
  originalSiteWorks: boolean | null;
  discoveryNote: string;
}

/**
 * Shared first step for any crawler: run the multi-source discovery pipeline and
 * return the chosen official site plus context. No browser required.
 */
export async function discoverOfficialSite(input: ResearchInput): Promise<Discovery> {
  const result = await discoverWebsite(input);
  return {
    query: result.query,
    searchResults: result.searchResults,
    officialSite: result.officialSite,
    originalSiteWorks: result.originalSiteWorks,
    discoveryNote: result.note,
  };
}
