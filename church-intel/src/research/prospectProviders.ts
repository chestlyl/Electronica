import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import { multiSearch } from './searchProviders.js';
import { sleep } from './discover.js';
import type { AreaQuery, ChurchCandidate, ProspectProvider } from './prospect.js';

/**
 * Live enumeration providers for area prospecting. Network-bound — these run in
 * the real CLI; the prospect.ts orchestration is tested offline with mocks.
 */

// Pull "City, ST" out of a Google formatted_address (".. City, ST 44333, USA").
function parseCityState(addr: string): { city: string | null; state: string | null } {
  const m = addr.match(/,\s*([A-Za-z .'-]+),\s*([A-Z]{2})\s*\d{0,5}/);
  return m ? { city: m[1].trim(), state: m[2] } : { city: null, state: null };
}

/**
 * Google Places Text Search — the primary, structured enumerator. Returns
 * name + address (no website; the dossier pipeline resolves the site from
 * name+city). Paginates up to 3 pages (60 results). Requires a Places API key.
 */
export function googlePlacesProvider(apiKey = config.prospect.googlePlacesApiKey): ProspectProvider {
  return {
    name: 'google_places',
    async enumerate(area: AreaQuery): Promise<ChurchCandidate[]> {
      if (!apiKey) throw new Error('GOOGLE_PLACES_API_KEY not set');
      const q = `churches in ${area.metro}${area.state ? `, ${area.state}` : ''}${area.denomination ? ` ${area.denomination}` : ''}`;
      const out: ChurchCandidate[] = [];
      let pageToken: string | undefined;
      for (let page = 0; page < 3; page++) {
        const url = new URL('https://maps.googleapis.com/maps/api/place/textsearch/json');
        url.searchParams.set('query', q);
        url.searchParams.set('type', 'church');
        url.searchParams.set('key', apiKey);
        if (pageToken) url.searchParams.set('pagetoken', pageToken);
        const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
        const data = (await res.json()) as { status: string; results?: any[]; next_page_token?: string; error_message?: string };
        if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
          throw new Error(`Places ${data.status}${data.error_message ? `: ${data.error_message}` : ''}`);
        }
        for (const r of data.results ?? []) {
          const { city, state } = parseCityState(r.formatted_address ?? '');
          out.push({ name: r.name, city, state: state ?? (area.state ?? null), website: null, address: r.formatted_address ?? null, sources: ['google_places'] });
        }
        if (!data.next_page_token) break;
        pageToken = data.next_page_token;
        await sleep(2000); // Places requires a short delay before next_page_token is valid
      }
      logger.info(`google_places: ${out.length} churches for "${q}"`);
      return out;
    },
  };
}

// A church-like title (so we don't harvest blog posts / news from search results).
const CHURCH_TITLE = /\b(church|chapel|tabernacle|cathedral|fellowship|assembly|ministries|worship\s+center|congregation)\b/i;
const TITLE_TRAILER = /\s*[|\-–—:·].*$/; // strip "… - Home", "… | Welcome"

/**
 * Search/directory enumerator — best-effort harvest of church names from web
 * search result titles (and directory listings). Noisier than Places; used to
 * catch churches Places misses. The orchestration dedupes the union.
 */
export function searchDirectoryProvider(): ProspectProvider {
  return {
    name: 'search_directory',
    async enumerate(area: AreaQuery): Promise<ChurchCandidate[]> {
      const queries = [
        `churches in ${area.metro}${area.state ? ` ${area.state}` : ''}`,
        `${area.denomination ? `${area.denomination} ` : ''}churches ${area.metro}${area.state ? ` ${area.state}` : ''} directory`,
      ];
      const seen = new Set<string>();
      const out: ChurchCandidate[] = [];
      for (const q of queries) {
        const { results } = await multiSearch(q, { limit: 20 });
        for (const r of results) {
          const title = (r.title ?? '').replace(TITLE_TRAILER, '').trim();
          if (!CHURCH_TITLE.test(title) || title.length < 5 || title.length > 60) continue;
          const key = title.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          let website: string | null = null;
          try { const u = new URL(r.url); website = `${u.protocol}//${u.hostname}`; } catch { /* ignore */ }
          out.push({ name: title, city: null, state: area.state ?? null, website, address: null, sources: ['search_directory'] });
        }
        await sleep(300);
      }
      logger.info(`search_directory: ${out.length} candidate churches`);
      return out;
    },
  };
}
