import { multiSearch } from '../searchProviders.js';
import {
  makeFinding,
  type ExtractedField,
  type SourceFinding,
  type SourceType,
} from '../dossier.js';
import type { ResearchContext } from './context.js';
import type { SearchResult } from '../types.js';
import type { EvidenceAccessLevel } from '../../types.js';

function host(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; }
}
function path(url: string): string {
  try { return new URL(url).pathname.toLowerCase(); } catch { return ''; }
}

const VENDOR_HOST = /construct|builder|contractor|architect|engineer|roofing|hvac|consult(ing|ants?)|realty|realestate|signage|millwork|cabinetry|propertie?s/i;
const MEDIA_HOST = /(^|\.)(news|tribune|times|herald|gazette|chronicle|journal|patch|cbs|abc|nbc|fox|communityimpact|press|magazine|reuters|apnews|axios)/i;
const BROKER = /zoominfo|rocketreach|apollo\.io|signalhire|leadiq|contactout/i;

interface Klass { sourceType: SourceType; accessLevel: EvidenceAccessLevel; reliability: number }

/**
 * Classify a search result. Per the locked decision we do NOT fetch social /
 * job / directory pages, so the access level is `search_snippets` for everything
 * (except vendor refs). The semantic source type and a per-type reliability are
 * still recorded — this is what keeps the dossier confidence honestly capped at
 * 65 when the official DOM was never retrieved.
 */
function classify(url: string, officialHost: string | null): Klass {
  const h = host(url);
  const p = path(url);
  const snip = (sourceType: SourceType, reliability: number): Klass => ({ sourceType, accessLevel: 'search_snippets', reliability });
  if (officialHost && h === officialHost) return snip('official_site', 0.62); // church's own words, but only a snippet
  if (/youtube\.com|youtu\.be/.test(h)) return snip('youtube', 0.55);
  if (/facebook\.com/.test(h)) return snip('facebook', 0.55);
  if (/instagram\.com/.test(h)) return snip('instagram', 0.55);
  if (/linkedin\.com/.test(h)) return snip('linkedin', 0.55);
  if (BROKER.test(h)) return snip('linkedin', 0.35);
  if (/ministryjobs|churchstaffing|indeed\.com|ziprecruiter|vanderbloemen/.test(h)) return snip('job_posting', 0.6);
  if (/maps\.apple|google\.[a-z.]+\/maps|mapquest/.test(h + p)) return snip('maps', 0.6);
  if (/yelp|yellowpages|churchfinder|wheree|uschurch|findachurch/.test(h)) return snip('church_directory', 0.55);
  if (/church-directory|\/directory\/|find-a-church/.test(p) || /(naz|nazarene|umc|sbc|district|presbytery|diocese|conference)/.test(h)) return snip('denom_directory', 0.65);
  if (VENDOR_HOST.test(h)) return { sourceType: 'vendor_reference', accessLevel: 'vendor_reference', reliability: 0.2 };
  if (MEDIA_HOST.test(h)) return snip('news_media', 0.5);
  return snip('search', 0.5);
}

const FOLLOWERS = /([\d][\d,.]*\s*[KkMm]?)\s+(followers|subscribers|likes)/i;
const PHONE = /\(?\b\d{3}\)?[ .\-]\d{3}[ .\-]\d{4}\b/;
const PASTOR_TITLE = /\b(lead|senior|associate|executive|founding)\s+pastor\b/i;
const ADDRESS = /\b\d{2,6}\s+[A-Z][A-Za-z0-9 .]+\b(?:Rd|Road|St|Street|Ave|Avenue|Blvd|Dr|Drive|Lane|Ln|Way|Hwy|Pkwy)\b/;

function extract(klass: Klass, url: string, text: string): ExtractedField[] {
  const fields: ExtractedField[] = [];
  const add = (field_name: string, value: string | number | null, confidence: number, ev: string) =>
    fields.push({ field_name, value, confidence, evidence_text: ev, source_url: url, source_type: klass.sourceType, access_level: klass.accessLevel });

  const f = text.match(FOLLOWERS);
  if (f) {
    const key = klass.sourceType === 'instagram' ? 'instagram_followers'
      : klass.sourceType === 'facebook' ? 'facebook_followers'
      : klass.sourceType === 'youtube' ? 'youtube_subscribers' : 'social_followers';
    add(key, f[1].trim(), 55, f[0]);
  }
  const pt = text.match(PASTOR_TITLE);
  if (pt) add('lead_pastor_title_mention', pt[0], 45, text.slice(0, 160));
  const ph = text.match(PHONE);
  if (ph) add('phone', ph[0], 50, text.slice(0, 120));
  const ad = text.match(ADDRESS);
  if (ad) add('address', ad[0], 45, text.slice(0, 160));
  return fields;
}

/**
 * Snippet-based multi-source collector. Per the locked design decision, social,
 * staff, LinkedIn, job, directory, news and vendor evidence are gathered from
 * SEARCH SNIPPETS (no login-gated scraping). Each result becomes a finding with
 * the correct source type + access level + light regex-extracted fields.
 */
export async function collectSnippets(ctx: ResearchContext): Promise<SourceFinding[]> {
  const officialHost = ctx.officialSite ? host(ctx.officialSite) : null;
  const base = [ctx.name, ctx.city, ctx.state].filter(Boolean).join(' ');
  const queries = [
    `${base} church`,
    officialHost ? `site:${officialHost}` : `${ctx.name} ${ctx.city ?? ''} pastor`,
    `${base} pastor staff leadership`,
    `${base} attendance members weekly`,
    `${base} youtube facebook instagram app giving livestream`,
    `${base} jobs hiring pastor position`,
  ].filter((q): q is string => !!q && q.trim().length > 3);

  const byUrl = new Map<string, SearchResult>();
  for (const q of queries) {
    const { results } = await multiSearch(q, { limit: 8, minHosts: 6 });
    for (const r of results) if (!byUrl.has(r.url)) byUrl.set(r.url, r);
  }

  const findings: SourceFinding[] = [];
  for (const r of byUrl.values()) {
    const klass = classify(r.url, officialHost);
    const text = `${r.title} ${r.snippet}`.trim();
    const finding = makeFinding({
      sourceType: klass.sourceType,
      accessLevel: klass.accessLevel,
      url: r.url,
      title: r.title,
      fetched: false,
      status: 200,
      snippet: r.snippet,
      fields: extract(klass, r.url, text),
    });
    finding.reliability = klass.reliability;
    findings.push(finding);
  }
  return findings;
}
