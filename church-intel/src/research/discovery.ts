import { logger } from '../lib/logger.js';
import { isDirectoryUrl } from './search.js';
import { multiSearch, type SearchDiagnostic } from './searchProviders.js';
import type { ResearchInput, SearchResult } from './types.js';

export type CandidateSource = 'original' | 'urlname' | 'domain_guess' | 'search';

export interface DiscoveryCandidate {
  url: string;
  host: string;
  source: CandidateSource;
  provider?: string;        // search engine, when source === 'search'
  reachable: boolean | null;
  isDirectory: boolean;
  churchLike: boolean | null;
  parked: boolean | null;
  score: number;
  accepted: boolean;
  reason: string;
}

export interface DiscoveryResult {
  query: string;
  altQuery: string | null;
  officialSite: string | null;
  method: string;                 // how the winner was chosen
  originalSiteWorks: boolean | null;
  candidates: DiscoveryCandidate[];
  searchResults: SearchResult[];
  searchDiagnostics: SearchDiagnostic[];
  note: string;
}

const CHURCH_TERMS = /church|worship|sermon|pastor|ministr|service times|gospel|congregation|nazarene|sunday|small group|discipleship/i;
const PARKED_TERMS = /domain (is )?for sale|buy this domain|this domain is parked|parked free|godaddy|sedoparking|hugedomains|namecheap|website coming soon|under construction/i;
const STOP = new Set([
  'church', 'of', 'the', 'nazarene', 'community', 'fellowship', 'a', 'at', 'in',
  'and', 'first', 'new', 'iglesia', 'el', 'la', 'de',
]);

function tokens(s: string | null | undefined): string[] {
  return (s ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

function normalizeUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let u = raw.trim();
  if (!u || /^https?:\/\/$/i.test(u)) return null;
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  try {
    return new URL(u).toString();
  } catch {
    return null;
  }
}

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

interface SiteInspection {
  reachable: boolean;
  status: number;
  finalUrl: string;
  churchLike: boolean;
  parked: boolean;
}

/** One GET that determines reachability, parked-domain, and church-like content. */
async function inspectSite(url: string): Promise<SiteInspection> {
  const out: SiteInspection = { reachable: false, status: 0, finalUrl: url, churchLike: false, parked: false };
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(10000),
      headers: { 'user-agent': BROWSER_UA, accept: 'text/html,*/*' },
    });
    out.status = res.status;
    out.finalUrl = res.url || url;
    out.reachable = res.ok;
    const ct = res.headers.get('content-type') ?? '';
    if (res.ok && /html|text/.test(ct)) {
      const html = (await res.text()).slice(0, 20000);
      const text = html.replace(/<[^>]+>/g, ' ');
      out.parked = PARKED_TERMS.test(text) || text.replace(/\s+/g, '').length < 200;
      out.churchLike = CHURCH_TERMS.test(text);
    }
  } catch {
    /* unreachable */
  }
  return out;
}

/** Run async fn over items with bounded concurrency. */
async function mapPool<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    }),
  );
  return out;
}

/** Build plausible domain guesses from the church name, city, and alt name. */
export function domainGuesses(name: string, city: string | null, altName: string | null): string[] {
  const nameTok = tokens(name);
  const cityTok = tokens(city);
  const altTok = tokens(altName);
  const slugs = new Set<string>();

  const nameSlug = nameTok.join('');
  if (nameSlug) {
    slugs.add(nameSlug);
    slugs.add(nameSlug + 'church');
    slugs.add(nameSlug + 'naz');
    slugs.add(nameSlug + 'nazarene');
    if (cityTok.length) slugs.add(nameSlug + cityTok.join(''));
  }
  // "<Name> First" style rosters → "<city>first", "<city>firstnaz"
  if (/\bfirst\b/i.test(name) && cityTok.length) {
    slugs.add(cityTok.join('') + 'first');
    slugs.add(cityTok.join('') + 'firstnaz');
    slugs.add('first' + cityTok.join(''));
  }
  if (cityTok.length) {
    slugs.add(cityTok.join('') + 'naz');
    slugs.add(cityTok.join('') + 'nazarene');
  }
  const altSlug = altTok.join('');
  if (altSlug) {
    slugs.add(altSlug);
    slugs.add(altSlug + 'church');
  }

  const tlds = ['org', 'church', 'com', 'net'];
  const domains: string[] = [];
  for (const s of slugs) {
    if (s.length < 4) continue;
    for (const tld of tlds) domains.push(`https://www.${s}.${tld}`);
  }
  return [...new Set(domains)].slice(0, 20);
}

/** Score a candidate 0..100 (discovery ranking only — NOT the church scores). */
function scoreCandidate(c: DiscoveryCandidate, nameTok: string[], cityTok: string[]): { score: number; accepted: boolean; reason: string } {
  if (c.isDirectory) return { score: 5, accepted: false, reason: 'directory/social host — not an official church site' };
  if (c.reachable === false) return { score: 0, accepted: false, reason: 'unreachable (no HTTP 2xx)' };
  if (c.parked) return { score: 2, accepted: false, reason: 'parked / for-sale / placeholder domain' };

  let score = 0;
  const reasons: string[] = [];
  const base: Record<CandidateSource, number> = { original: 55, urlname: 45, domain_guess: 40, search: 38 };
  score += base[c.source];
  reasons.push(`source=${c.source}(+${base[c.source]})`);

  const host = c.host;
  let tokenHits = 0;
  for (const t of [...nameTok, ...cityTok]) if (t.length > 2 && host.includes(t)) tokenHits++;
  const tokenBonus = Math.min(tokenHits * 6, 24);
  if (tokenBonus) { score += tokenBonus; reasons.push(`host matches name/city ×${tokenHits}(+${tokenBonus})`); }

  if (/\.(org|church)$/.test(host)) { score += 8; reasons.push('.org/.church(+8)'); }
  if (/naz/.test(host)) { score += 4; reasons.push('nazarene hint(+4)'); }

  if (c.reachable) { score += 10; reasons.push('reachable(+10)'); }
  if (c.churchLike) { score += 18; reasons.push('church content detected(+18)'); }
  else if (c.churchLike === false && c.reachable) { score -= 8; reasons.push('no church content(-8)'); }

  score = Math.max(0, Math.min(100, score));
  // Unreachable / parked candidates already returned above, so only score gates here.
  const accepted = score >= 45;
  return { score, accepted, reason: reasons.join(', ') };
}

/**
 * Discover the official church website from multiple sources, in priority order:
 *   1. website_original from the spreadsheet (verified reachable)
 *   2. urlname field (if it is/looks like a URL)
 *   3. direct domain guesses from name + city (+ alt name)
 *   4. multi-provider web search
 * Returns ranked candidates with accept/reject reasons and rich diagnostics.
 */
export async function discoverWebsite(input: ResearchInput): Promise<DiscoveryResult> {
  const query = [input.name, input.city, input.state, 'church'].filter(Boolean).join(' ');
  const altName = input.alternateName ?? null;
  const altQuery = altName ? [altName, input.city, input.state, 'church'].filter(Boolean).join(' ') : null;
  const nameTok = tokens(input.name);
  const cityTok = tokens(input.city);

  logger.info(`discover: "${query}"${altQuery ? ` | alt: "${altQuery}"` : ''}`);

  const seen = new Set<string>();
  const seeds: { url: string; source: CandidateSource; provider?: string }[] = [];
  const add = (url: string | null, source: CandidateSource, provider?: string) => {
    const n = normalizeUrl(url);
    if (!n) return;
    const key = `${hostOf(n)}|${source}`;
    if (seen.has(hostOf(n))) return; // one candidate per host
    seen.add(hostOf(n));
    seeds.push({ url: n, source, provider });
  };

  // 1. original website
  add(input.originalWebsite, 'original');

  // 2. urlname — only when it actually looks like a URL/domain
  if (altName && /\.[a-z]{2,}(\/|$)/i.test(altName) && /^[\w.\-/:]+$/.test(altName.trim())) {
    add(altName, 'urlname');
  }

  // 3. domain guesses
  const guesses = domainGuesses(input.name, input.city, altName);

  // 4. search (primary query; alt query only if primary is thin)
  const primary = await multiSearch(query, { limit: 12, minHosts: 5 });
  let searchDiagnostics = primary.diagnostics;
  let searchResults = primary.results;
  if (searchResults.filter((r) => !isDirectoryUrl(r.url)).length < 2 && altQuery) {
    const alt = await multiSearch(altQuery, { limit: 8, minHosts: 4 });
    searchDiagnostics = [...searchDiagnostics, ...alt.diagnostics];
    const have = new Set(searchResults.map((r) => r.url));
    searchResults = [...searchResults, ...alt.results.filter((r) => !have.has(r.url))];
  }
  for (const r of searchResults) add(r.url, 'search', providerForUrl(r, searchResults));

  // Probe seeds + the most promising domain guesses. Guesses are probed
  // separately (bounded) so we don't fire 20 requests when search already won.
  const guessSeeds = guesses
    .filter((g) => !seen.has(hostOf(g)))
    .slice(0, 12)
    .map((url) => ({ url, source: 'domain_guess' as CandidateSource }));

  const allSeeds = [...seeds, ...guessSeeds];
  const inspections = await mapPool(allSeeds, 5, (s) => inspectSite(s.url));

  const candidates: DiscoveryCandidate[] = allSeeds.map((s, idx) => {
    const ins = inspections[idx];
    const c: DiscoveryCandidate = {
      url: ins.finalUrl || s.url,
      host: hostOf(s.url),
      source: s.source,
      provider: (s as any).provider,
      reachable: ins.reachable,
      isDirectory: isDirectoryUrl(s.url),
      churchLike: ins.reachable ? ins.churchLike : null,
      parked: ins.reachable ? ins.parked : null,
      score: 0,
      accepted: false,
      reason: '',
    };
    const { score, accepted, reason } = scoreCandidate(c, nameTok, cityTok);
    c.score = score;
    c.accepted = accepted;
    c.reason = reason;
    return c;
  });

  candidates.sort((a, b) => b.score - a.score);

  const original = candidates.find((c) => c.source === 'original');
  const originalSiteWorks = original ? original.reachable : input.originalWebsite ? false : null;

  const winner = candidates.find((c) => c.accepted) ?? null;
  const officialSite = winner?.url ?? null;
  const method = winner
    ? `${winner.source}${winner.provider ? `:${winner.provider}` : ''} (score ${winner.score})`
    : 'none';

  // Log candidates + reasons.
  logger.info(`discover: ${candidates.length} candidates, chose ${officialSite ?? 'NONE'} via ${method}`);
  for (const c of candidates.slice(0, 8)) {
    const flag = c.accepted ? '✓' : '✗';
    logger.info(`  ${flag} [${String(c.score).padStart(3)}] ${c.source.padEnd(12)} ${c.url} — ${c.reason}`);
  }

  const note = winner
    ? `Official site chosen via ${method}: reachable=${winner.reachable}, churchContent=${winner.churchLike}, domainMatch=${nameTok.some((t) => winner.host.includes(t))}.`
    : `No official website confidently identified. ${searchResults.length === 0 ? 'Search returned no results (engines may be blocked or rate-limited).' : 'Only directory/social or unreachable candidates were found.'}`;

  return {
    query,
    altQuery,
    officialSite,
    method,
    originalSiteWorks,
    candidates,
    searchResults,
    searchDiagnostics,
    note,
  };
}

function providerForUrl(r: SearchResult, _all: SearchResult[]): string | undefined {
  return (r as SearchResult & { provider?: string }).provider;
}
