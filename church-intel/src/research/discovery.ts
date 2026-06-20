import { logger } from '../lib/logger.js';
import { isDirectoryUrl } from './search.js';
import { multiSearch, type SearchDiagnostic } from './searchProviders.js';
import { smartFetch } from './renderedFetch.js';
import type { ResearchInput, SearchResult } from './types.js';

export type CandidateSource = 'original' | 'urlname' | 'domain_guess' | 'search';
export type CandidateKind =
  | 'official_church'      // an individual church's own website
  | 'denom_directory'      // denominational/association directory listing this church
  | 'general_directory'    // yelp/facebook/yellowpages etc.
  | 'resource'             // parachurch / bible-study / sermon resource — not a church
  | 'vendor_reference'     // contractor/architect/builder/vendor page ABOUT a church
  | 'media_reference'      // news/media article ABOUT a church
  | 'unknown';
export type LocationStatus = 'match' | 'conflict' | 'unknown';
export type IdentityVerdict = 'true_match' | 'uncertain' | 'no_match';

export interface DiscoveryCandidate {
  url: string;
  host: string;
  source: CandidateSource;
  provider?: string;
  reachable: boolean | null;
  isDirectory: boolean;
  churchLike: boolean | null;
  parked: boolean | null;
  kind: CandidateKind;
  nameMatch: number;            // 0..1 fraction of distinctive name tokens matched
  nameFull: boolean;            // every distinctive token matched (exact-ish)
  cityStatus: LocationStatus;   // does the candidate place itself in THIS city/state?
  identity_confidence: number;  // 0..100 — "this is THE site for THIS church"
  identityVerdict: IdentityVerdict;
  score: number;                // == identity_confidence (sort key)
  accepted: boolean;
  reason: string;
}

export interface DiscoveryResult {
  query: string;
  altQuery: string | null;
  officialSite: string | null;
  identity_confidence: number;     // winner's, 0 when NO MATCH
  identityVerdict: IdentityVerdict;
  method: string;
  originalSiteWorks: boolean | null;
  candidates: DiscoveryCandidate[];
  searchResults: SearchResult[];
  searchDiagnostics: SearchDiagnostic[];
  note: string;
}

/** Accept a candidate as the official site only at/above this identity score. */
const ACCEPT_THRESHOLD = 65;
const UNCERTAIN_THRESHOLD = 45;

const CHURCH_TERMS = /church|worship|sermon|pastor|ministr|service times|gospel|congregation|nazarene|sunday|small group|discipleship/i;
const PARKED_TERMS = /domain (is )?for sale|buy this domain|this domain is parked|parked free|godaddy|sedoparking|hugedomains|namecheap|website coming soon|under construction/i;
const OWN_CHURCH_MARKERS = /plan (your|a) visit|service times|what to expect|join us (this )?sunday|our (church|services|pastor)|give online|i'?m new|connect card|weekend services/gi;
// Church-OWNED navigation/links — present when the church runs the site itself.
const NAV_CHURCH_ITEMS = /\b(give|giving|donate|tithe|sermons?|messages|watch ?(live)?|plan (your|a) visit|i'?m new|im new|ministr(y|ies)|small ?groups?|life ?groups?|connect|next steps|events|prayer requests?|service times|what to expect|our beliefs|new here)\b/i;
const RESOURCE_HOSTS = [
  'cbsclass.org', 'communitybiblestudy.org', 'bsfinternational.org', 'biblestudyfellowship.org',
  'sermonaudio.com', 'sermonindex.net', 'gotquestions.org', 'biblegateway.com', 'youversion.com',
  'blogspot.com', 'wordpress.com', 'patheos.com',
];
// Vendors describe a church project; they do not REPRESENT the church.
const VENDOR_HOST = /construct|builder|contractor|architect|engineer|roofing|hvac|interior|consult(ing|ants?)?|realty|realestate|signage|landscap|plumb|electric|paving|millwork|cabinetry|flooring|concrete|drywall|glass|steel|mechanical|integrat|designbuild|avsystems|soundsystem|propertie?s/i;
const VENDOR_CONTENT = /portfolio|case stud|our (work|projects)|completed (project|in|the)|general contractor|design[- ]build|scope of work|square feet|sq\.? ?ft|project (gallery|profile|details)|we (built|designed|constructed|completed)|client[:s]|architectural/i;
const VENDOR_PATH = /\/portfolio\/|\/projects?\/|\/our-work\/|\/work\/|\/case-stud/i;
const MEDIA_HOST = /(^|\.)(news|tribune|times|herald|gazette|chronicle|journal|patch|cbs|abc|nbc|fox|click2houston|communityimpact|press|magazine|dailymail|guardian|reuters|apnews|axios|patheos)/i;
const MEDIA_CONTENT = /staff (writer|reporter)|by [a-z]+ [a-z]+, (staff|correspondent)|published (on|at)|read more|subscribe to (our )?newsletter|advertisement|all rights reserved.*(news|media)|originally appeared/i;
const MEDIA_PATH = /\/news\/|\/article\/|\/story\/|\/stories\/|\/20\d\d\/\d\d\//;
const STOP = new Set([
  'church', 'of', 'the', 'nazarene', 'community', 'fellowship', 'a', 'at', 'in',
  'and', 'first', 'new', 'iglesia', 'el', 'la', 'de', 'ministries', 'ministry',
]);
const STATE_ABBR = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC',
]);

function tokens(s: string | null | undefined): string[] {
  return (s ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

/**
 * Distinctive tokens used for identity matching: alphabetic, length >= 3.
 * This excludes numeric junk from non-identifying names (e.g. "26:16:00"),
 * which should yield NO MATCH rather than matching on stray digits.
 */
function distinctiveTokens(s: string | null | undefined): string[] {
  return tokens(s).filter((t) => t.length >= 3 && /[a-z]/.test(t));
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}
function pathOf(url: string): string {
  try {
    return new URL(url).pathname.toLowerCase();
  } catch {
    return '';
  }
}
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
  identityText: string;   // title + og:site_name/title + h1 + meta description (original case)
  bodyText: string;       // visible text (lowercased)
  churchLike: boolean;
  ownershipSignals: number; // distinct church-owned nav/first-person markers (0..n)
  parked: boolean;
}

function firstMatch(re: RegExp, html: string): string {
  const m = html.match(re);
  return m ? m[1] : '';
}

/**
 * One render-aware fetch: reachability, parked check, church content, identity
 * text, and church-OWNED signals. Escalates to a rendered browser when allowed
 * (church-provided URLs) so JS-rendered sites' nav/content are visible.
 */
async function inspectSite(url: string, allowRender: boolean): Promise<SiteInspection> {
  const out: SiteInspection = {
    reachable: false, status: 0, finalUrl: url, identityText: '', bodyText: '',
    churchLike: false, ownershipSignals: 0, parked: false,
  };
  try {
    const r = await smartFetch(url, allowRender);
    out.status = r.status;
    out.finalUrl = r.finalUrl;
    out.reachable = r.ok;
    if (r.ok && (r.rawHtml || r.text)) {
      out.identityText = r.identityText || firstMatch(/<title[^>]*>([\s\S]*?)<\/title>/i, r.rawHtml);
      const text = r.text;
      out.bodyText = text.toLowerCase().slice(0, 20000);
      out.parked = PARKED_TERMS.test(text) || text.replace(/\s/g, '').length < 200;
      out.churchLike = CHURCH_TERMS.test(text);

      // Church-OWNED signals: nav/link items the church runs itself + first-person
      // markers. Use rendered nav labels when available, else parse raw anchors.
      const navHits = new Set<string>();
      const navSource = r.navLabels.length ? r.navLabels : [...r.rawHtml.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)].map((m) => m[1].replace(/<[^>]+>/g, ' ').trim());
      for (const label of navSource) {
        const hit = label.match(NAV_CHURCH_ITEMS);
        if (hit) navHits.add(hit[0].toLowerCase().replace(/\s+/g, ' ').trim());
      }
      const firstPerson = text.match(OWN_CHURCH_MARKERS)?.length ?? 0;
      out.ownershipSignals = navHits.size + Math.min(firstPerson, 3);
    }
  } catch {
    /* unreachable */
  }
  return out;
}

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
    if (cityTok.length && cityTok.join('') !== nameSlug) slugs.add(nameSlug + cityTok.join(''));
  }
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

// ── identity helpers ────────────────────────────────────────────────────────

function nameMatch(identityText: string, host: string, primaryTok: string[], altTok: string[]): { ratio: number; full: boolean } {
  const idLower = identityText.toLowerCase();
  const score = (toks: string[]): number => {
    if (!toks.length) return 0;
    let hit = 0;
    for (const t of toks) {
      const inText = t.length >= 3 && new RegExp(`\\b${escapeRe(t)}`).test(idLower);
      const inHost = t.length >= 3 && host.includes(t);
      if (inText || inHost) hit++;
    }
    return hit / toks.length;
  };
  const rp = score(primaryTok);
  const ra = score(altTok);
  const ratio = Math.max(rp, ra);
  const full = (primaryTok.length > 0 && rp === 1) || (altTok.length > 0 && ra === 1);
  return { ratio, full };
}

function findStates(rawIdentityText: string): Set<string> {
  const states = new Set<string>();
  const re = /,\s*([A-Z]{2})\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rawIdentityText)) !== null) {
    if (STATE_ABBR.has(m[1])) states.add(m[1]);
  }
  return states;
}

function locationStatus(ins: SiteInspection, city: string | null, state: string | null): LocationStatus {
  const c = (city ?? '').toLowerCase();
  if (c.length >= 4) {
    const hay = `${ins.identityText.toLowerCase()} ${ins.bodyText}`;
    if (new RegExp(`\\b${escapeRe(c)}\\b`).test(hay)) return 'match';
  }
  const states = findStates(ins.identityText);
  if (state && states.size > 0 && !states.has(state.toUpperCase())) return 'conflict';
  return 'unknown';
}

function classifyKind(host: string, path: string, ins: SiteInspection, ratio: number, isDir: boolean, source: CandidateSource, nameFull: boolean): CandidateKind {
  if (RESOURCE_HOSTS.some((h) => host === h || host.endsWith('.' + h))) return 'resource';

  // Vendor: contractor/architect/builder/etc. describing a church PROJECT.
  // Host keyword is decisive; otherwise require portfolio-style content + path.
  if (VENDOR_HOST.test(host) || (VENDOR_CONTENT.test(ins.bodyText) && VENDOR_PATH.test(path))) {
    return 'vendor_reference';
  }
  // Media/news article ABOUT a church.
  if (MEDIA_HOST.test(host) || (MEDIA_CONTENT.test(ins.bodyText) && MEDIA_PATH.test(path))) {
    return 'media_reference';
  }
  if (isDir) return 'general_directory';

  const dirPath = /church-directory|\/directory\/|find-a-church|\/churches?\//i.test(path);
  const denomHost = /(naz|nazarene|umc|sbc|district|presbytery|diocese|conference|assembliesofgod|\bag\.org|\.cog\.)/i.test(host);
  if (dirPath || (denomHost && ratio > 0)) return 'denom_directory';

  // A site is the church's OWN site if it carries church-owned signals
  // (give/sermons/visit/ministries nav, first-person markers) OR if it is a
  // church-provided URL / an exact name match to a church-like site. Ownership
  // signals are not always detectable on JS-rendered sites, so provenance +
  // exact name can also establish identity — vendor/media/resource/directory
  // are already excluded above, and city-conflict / name-mismatch are penalized
  // downstream.
  const churchProvided = source === 'original' || source === 'urlname';
  if (ins.ownershipSignals >= 2) return 'official_church';
  if (ins.churchLike && (churchProvided || nameFull)) return 'official_church';
  return 'unknown';
}

interface IdentityEval {
  identity: number;
  verdict: IdentityVerdict;
  reason: string;
}

/**
 * Identity-first scoring. Answers "is this the website for THIS church?",
 * not merely "is this a church website?". Heavily rewards name + city +
 * denominational-directory confirmation; penalizes name mismatch, city-only
 * matches, resources, and generic directories.
 */
function evaluateIdentity(
  c: DiscoveryCandidate,
  hasUsableName: boolean,
): IdentityEval {
  // Hard gates.
  if (c.reachable === false) return { identity: 0, verdict: 'no_match', reason: 'unreachable (no HTTP 2xx)' };
  if (c.parked) return { identity: 0, verdict: 'no_match', reason: 'parked / placeholder domain' };
  if (!hasUsableName) {
    return { identity: 0, verdict: 'no_match', reason: 'church name is non-identifying (e.g. blank/garbage) — identity cannot be proven' };
  }
  // A page ABOUT a church is not a church. Vendor/media references can NEVER be
  // a true_match no matter how well the name/city line up.
  if (c.kind === 'vendor_reference') {
    return { identity: 15, verdict: 'no_match', reason: 'vendor/contractor page DESCRIBING a church project — does not represent the church (disqualified)' };
  }
  if (c.kind === 'media_reference') {
    return { identity: 15, verdict: 'no_match', reason: 'news/media article ABOUT a church — does not represent the church (disqualified)' };
  }

  let id = 0;
  const r: string[] = [];

  if (c.source === 'original' || c.source === 'urlname') { id += 40; r.push('church-provided URL(+40)'); }

  if (c.nameFull) { id += 45; r.push('exact name match(+45)'); }
  else if (c.nameMatch >= 0.5) { id += 22; r.push(`partial name match ${(c.nameMatch * 100) | 0}%(+22)`); }
  else { id -= 40; r.push('name does NOT match candidate(-40)'); }

  if (c.cityStatus === 'match') { id += 25; r.push('city match(+25)'); }
  else if (c.cityStatus === 'conflict') { id -= 30; r.push('candidate is in a DIFFERENT city/state(-30)'); }
  else r.push('city unconfirmed(0)');

  switch (c.kind) {
    case 'official_church': id += 15; r.push('official church website(+15)'); break;
    case 'denom_directory': id += 25; r.push('denominational directory confirmation(+25)'); break;
    case 'general_directory': id -= 10; r.push('general directory/social(-10)'); break;
    case 'resource': id -= 30; r.push('church resource, not a church(-30)'); break;
    default: id -= 5; r.push('unclassified / not church-owned(-5)');
  }

  if (c.reachable) { id += 5; r.push('reachable(+5)'); }
  if (c.churchLike) { id += 5; r.push('church content(+5)'); }

  // Identity can only be PROVEN by the church's own site or a directory that
  // confirms it. Anything else (a page that merely mentions the church) is
  // capped below the acceptance bar — NO MATCH beats a false positive.
  if (c.kind !== 'official_church' && c.kind !== 'denom_directory') {
    id = Math.min(id, UNCERTAIN_THRESHOLD - 1);
    r.push('not a church-owned site or directory → capped (cannot be true_match)');
  }

  id = Math.max(0, Math.min(100, id));
  const verdict: IdentityVerdict = id >= ACCEPT_THRESHOLD ? 'true_match' : id >= UNCERTAIN_THRESHOLD ? 'uncertain' : 'no_match';
  return { identity: id, verdict, reason: r.join(', ') };
}

/**
 * Discover the official church website with identity verification.
 * Returns the best candidate ONLY if its identity is confidently proven
 * (>= 65); otherwise officialSite is null (NO MATCH preferred over a confident
 * false positive).
 */
export async function discoverWebsite(input: ResearchInput): Promise<DiscoveryResult> {
  const query = [input.name, input.city, input.state, 'church'].filter(Boolean).join(' ');
  const altName = input.alternateName ?? null;
  const altQuery = altName ? [altName, input.city, input.state, 'church'].filter(Boolean).join(' ') : null;
  const primaryTok = distinctiveTokens(input.name);
  const altTok = distinctiveTokens(altName);
  const hasUsableName = primaryTok.length + altTok.length > 0;

  logger.info(`discover: "${query}"${altQuery ? ` | alt: "${altQuery}"` : ''}${hasUsableName ? '' : '  [WARN non-identifying name]'}`);

  const seen = new Set<string>();
  const seeds: { url: string; source: CandidateSource; provider?: string }[] = [];
  const add = (url: string | null, source: CandidateSource, provider?: string) => {
    const n = normalizeUrl(url);
    if (!n) return;
    const h = hostOf(n);
    if (!h || seen.has(h)) return;
    seen.add(h);
    seeds.push({ url: n, source, provider });
  };

  add(input.originalWebsite, 'original');
  if (altName && /\.[a-z]{2,}(\/|$)/i.test(altName) && /^[\w.\-/:]+$/.test(altName.trim())) {
    add(altName, 'urlname');
  }

  const guesses = domainGuesses(input.name, input.city, altName);

  const primary = await multiSearch(query, { limit: 12, minHosts: 5 });
  let searchDiagnostics = primary.diagnostics;
  let searchResults = primary.results;
  if (searchResults.filter((r) => !isDirectoryUrl(r.url)).length < 2 && altQuery) {
    const alt = await multiSearch(altQuery, { limit: 8, minHosts: 4 });
    searchDiagnostics = [...searchDiagnostics, ...alt.diagnostics];
    const have = new Set(searchResults.map((r) => r.url));
    searchResults = [...searchResults, ...alt.results.filter((r) => !have.has(r.url))];
  }
  for (const r of searchResults) add(r.url, 'search', r.provider);

  const guessSeeds = guesses
    .filter((g) => !seen.has(hostOf(g)))
    .slice(0, 12)
    .map((url) => ({ url, source: 'domain_guess' as CandidateSource, provider: undefined as string | undefined }));

  const allSeeds = [...seeds, ...guessSeeds];
  // Render-escalate only church-provided URLs (bounded cost); rank everything
  // else with plain fetch.
  const inspections = await mapPool(allSeeds, 5, (s) => inspectSite(s.url, s.source === 'original' || s.source === 'urlname'));

  const candidates: DiscoveryCandidate[] = allSeeds.map((s, idx) => {
    const ins = inspections[idx];
    const host = hostOf(s.url);
    const path = pathOf(s.url);
    const isDir = isDirectoryUrl(s.url);
    const nm = nameMatch(ins.identityText || host, host, primaryTok, altTok);
    const cityStatus = ins.reachable ? locationStatus(ins, input.city, input.state) : 'unknown';
    const kind = ins.reachable ? classifyKind(host, path, ins, nm.ratio, isDir, s.source, nm.full) : 'unknown';

    const c: DiscoveryCandidate = {
      url: ins.finalUrl || s.url,
      host,
      source: s.source,
      provider: s.provider,
      reachable: ins.reachable,
      isDirectory: isDir,
      churchLike: ins.reachable ? ins.churchLike : null,
      parked: ins.reachable ? ins.parked : null,
      kind,
      nameMatch: Math.round(nm.ratio * 100) / 100,
      nameFull: nm.full,
      cityStatus,
      identity_confidence: 0,
      identityVerdict: 'no_match',
      score: 0,
      accepted: false,
      reason: '',
    };
    const ev = evaluateIdentity(c, hasUsableName);
    c.identity_confidence = ev.identity;
    c.identityVerdict = ev.verdict;
    c.score = ev.identity;
    c.accepted = ev.verdict === 'true_match';
    c.reason = ev.reason;
    return c;
  });

  candidates.sort((a, b) => b.identity_confidence - a.identity_confidence);

  const original = candidates.find((c) => c.source === 'original');
  const originalSiteWorks = original ? original.reachable : input.originalWebsite ? false : null;

  const winner = candidates.find((c) => c.accepted) ?? null;
  const best = candidates[0] ?? null;
  const officialSite = winner?.url ?? null;
  // On NO MATCH, report the best candidate's score (not a misleading 0) so the
  // dossier shows how close discovery got.
  const identity_confidence = winner ? winner.identity_confidence : (best?.identity_confidence ?? 0);
  const identityVerdict: IdentityVerdict = winner ? 'true_match' : best ? best.identityVerdict : 'no_match';
  const method = winner
    ? `${winner.source}${winner.provider ? `:${winner.provider}` : ''}/${winner.kind} (identity ${winner.identity_confidence})`
    : 'none';

  logger.info(`discover: ${candidates.length} candidates, ${officialSite ? `MATCH ${officialSite}` : 'NO MATCH'} via ${method}`);
  for (const c of candidates.slice(0, 8)) {
    logger.info(`  ${c.accepted ? '✓' : '✗'} [id ${String(c.identity_confidence).padStart(3)}] ${c.identityVerdict.padEnd(11)} ${c.source}/${c.kind} ${c.url}`);
    logger.info(`        name=${c.nameMatch}${c.nameFull ? '(full)' : ''} city=${c.cityStatus} — ${c.reason}`);
  }

  const note = winner
    ? `IDENTITY ${winner.identity_confidence}/100 (${winner.kind}) — name ${winner.nameFull ? 'fully matches' : `${(winner.nameMatch * 100) | 0}%`}, city ${winner.cityStatus}. This is the site for THIS church.`
    : !hasUsableName
      ? 'NO MATCH — the church name is non-identifying (blank/garbage), so no website can be confidently tied to this specific church. Routed to manual review.'
      : best
        ? `NO confident match. Best candidate ${best.url} scored identity ${best.identity_confidence} (${best.identityVerdict}: ${best.reason}). Preferring NO MATCH over a false positive.`
        : 'NO MATCH — no reachable candidates found.';

  return {
    query, altQuery, officialSite, identity_confidence, identityVerdict, method,
    originalSiteWorks, candidates, searchResults, searchDiagnostics, note,
  };
}
