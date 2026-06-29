import type { SourceFinding } from './dossier.js';

/**
 * Deterministic church-technology platform detection — hostname mapping ONLY, no
 * AI inference. Classifies every fetched URL and outbound link by hostname into a
 * known platform, with a category, confidence, and the evidence URL.
 */
export type PlatformCategory = 'ChMS' | 'Giving' | 'App' | 'Communication' | 'Email' | 'Website' | 'Streaming' | 'Other';

export interface PlatformHit {
  platform_name: string;
  category: PlatformCategory;
  confidence: number;   // 0..100 (deterministic host match → high)
  evidence_url: string;
}

// host suffix → platform. Matched against the URL's hostname only.
const TABLE: { host: RegExp; platform: string; category: PlatformCategory; confidence: number }[] = [
  { host: /(^|\.)churchcenter\.com$|(^|\.)churchcenteronline\.com$/i, platform: 'Church Center / Planning Center', category: 'ChMS', confidence: 95 },
  { host: /(^|\.)planningcenteronline\.com$|(^|\.)planningcenter\.com$|(^|\.)planning\.center$/i, platform: 'Planning Center', category: 'ChMS', confidence: 95 },
  { host: /(^|\.)pushpay\.com$/i, platform: 'Pushpay', category: 'Giving', confidence: 95 },
  { host: /(^|\.)subsplash\.com$|(^|\.)subspla\.sh$/i, platform: 'Subsplash', category: 'App', confidence: 95 },
  { host: /(^|\.)tithe\.ly$|(^|\.)tithely\.com$/i, platform: 'Tithely', category: 'Giving', confidence: 95 },
  { host: /(^|\.)breezechms\.com$/i, platform: 'Breeze', category: 'ChMS', confidence: 95 },
  { host: /(^|\.)realm\.org$|(^|\.)onrealm\.org$|(^|\.)realmchurch\.com$/i, platform: 'ACS Realm', category: 'ChMS', confidence: 90 },
  { host: /(^|\.)flocknote\.com$/i, platform: 'Flocknote', category: 'Communication', confidence: 95 },
  { host: /(^|\.)mailchimp\.com$|(^|\.)mailchimpsites\.com$|(^|\.)list-manage\.com$/i, platform: 'Mailchimp', category: 'Email', confidence: 90 },
  { host: /(^|\.)squarespace\.com$|(^|\.)squarespace-cdn\.com$|(^|\.)sqsp\.net$/i, platform: 'Squarespace', category: 'Website', confidence: 90 },
  { host: /(^|\.)wixsite\.com$|(^|\.)wix\.com$|(^|\.)wixstatic\.com$/i, platform: 'Wix', category: 'Website', confidence: 85 },
  // extras (deterministic, useful — not in the required list)
  { host: /(^|\.)givelify\.com$/i, platform: 'Givelify', category: 'Giving', confidence: 95 },
  { host: /(^|\.)easytithe\.com$/i, platform: 'EasyTithe', category: 'Giving', confidence: 90 },
  { host: /(^|\.)givebutter\.com$/i, platform: 'Givebutter', category: 'Giving', confidence: 90 },
  { host: /(^|\.)ccbchurch\.com$/i, platform: 'Church Community Builder', category: 'ChMS', confidence: 90 },
  { host: /(^|\.)wordpress\.(?:com|org)$/i, platform: 'WordPress', category: 'Website', confidence: 80 },
  { host: /(^|\.)webflow\.io$|(^|\.)webflow\.com$/i, platform: 'Webflow', category: 'Website', confidence: 82 },
  { host: /(^|\.)weebly\.com$/i, platform: 'Weebly', category: 'Website', confidence: 80 },
  // streaming / media platforms (the church's OWN channels, gated to owned evidence)
  { host: /(^|\.)youtube\.com$|(^|\.)youtu\.be$/i, platform: 'YouTube', category: 'Streaming', confidence: 80 },
  { host: /(^|\.)vimeo\.com$/i, platform: 'Vimeo', category: 'Streaming', confidence: 80 },
  { host: /(^|\.)resi\.io$|(^|\.)resi\.media$/i, platform: 'Resi', category: 'Streaming', confidence: 88 },
  { host: /(^|\.)boxcast\.com$|(^|\.)boxcast\.tv$/i, platform: 'BoxCast', category: 'Streaming', confidence: 88 },
  { host: /(^|\.)churchonlineplatform\.com$/i, platform: 'Church Online Platform', category: 'Streaming', confidence: 88 },
];

// Website builders leave a fingerprint in the served HTML/markup even when the
// site is on the church's OWN domain (no platform host to match). Detected from
// the official page text only.
const WEBSITE_FINGERPRINTS: { platform: string; re: RegExp; confidence: number }[] = [
  { platform: 'Squarespace', re: /squarespace|sqsp\.net|squarespace-cdn|static1\.squarespace|header-menu--folder-list|data-current-styles/i, confidence: 88 },
  { platform: 'Wix', re: /\bwix\.com\b|wixstatic|wixsite|_wix|wix-warmup/i, confidence: 85 },
  { platform: 'Webflow', re: /\.webflow\.io|data-wf-page|data-wf-site|webflow\.com/i, confidence: 82 },
  { platform: 'WordPress', re: /wp-content|wp-includes|\/wp-json\b|\bwordpress\b/i, confidence: 80 },
  { platform: 'Weebly', re: /\bweebly\b|editmysite/i, confidence: 78 },
  { platform: 'Wordpress (Divi/Elementor)', re: /et_pb_|elementor-/i, confidence: 72 },
];

function hostOf(url: string): string {
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/** Deterministically classify a single URL/host into a known platform (or null). */
export function classifyPlatform(url: string): { platform: string; category: PlatformCategory; confidence: number } | null {
  const h = hostOf(url);
  if (!h) return null;
  for (const e of TABLE) if (e.host.test(h)) return { platform: e.platform, category: e.category, confidence: e.confidence };
  return null;
}

// URLs and bare hostnames embedded in text/links.
const URL_RE = /\bhttps?:\/\/[^\s"'<>)]+|\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s"'<>)]*)?/gi;

/** Every fetched URL + outbound link + URL embedded in the evidence text. */
function candidateUrls(findings: SourceFinding[]): string[] {
  const out: string[] = [];
  for (const f of findings) {
    if (f.url) out.push(f.url);
    for (const d of f.linkDiagnostics ?? []) { if (d.resolvedUrl) out.push(d.resolvedUrl); else if (d.href) out.push(d.href); }
    for (const l of f.outboundLinks ?? []) { if (l.url) out.push(l.url); }
    for (const x of f.fields) {
      if (x.source_url) out.push(x.source_url);
      if (typeof x.value === 'string' && /^https?:\/\//i.test(x.value)) out.push(x.value);
    }
    const text = `${f.title ?? ''} ${(f.fetched ? f.text : f.snippet) ?? ''}`;
    for (const m of text.matchAll(URL_RE)) out.push(m[0]);
  }
  return out;
}

/** A finding is the church's OWN evidence: its official domain, or a page that
 *  earned live_official_site. (When officialHost is unknown, everything counts.) */
function isOwnedFinding(f: SourceFinding, officialHost: string): boolean {
  if (!officialHost) return true;
  const h = hostOf(f.url);
  return h === officialHost || h.endsWith(`.${officialHost}`) || f.accessLevel === 'live_official_site';
}

/** Website builder fingerprint from the official page HTML/text (one platform). */
function detectWebsitePlatform(ownedFindings: SourceFinding[]): PlatformHit | null {
  const blob = ownedFindings
    .filter((f) => f.fetched || f.accessLevel === 'live_official_site')
    .map((f) => `${f.title ?? ''} ${f.text ?? ''}`)
    .join('\n');
  if (!blob.trim()) return null;
  for (const fp of WEBSITE_FINGERPRINTS) {
    if (fp.re.test(blob)) {
      const evidence_url = ownedFindings.find((f) => f.fetched)?.url ?? ownedFindings[0]?.url ?? '';
      return { platform_name: fp.platform, category: 'Website', confidence: fp.confidence, evidence_url };
    }
  }
  return null;
}

/**
 * Detect the church's technology stack. When `officialHost` is supplied, the
 * stack is built ONLY from the church's own evidence (its domain + the
 * destinations its pages link to) — so third-party vendor/comparison pages and
 * other same-name churches never inject phantom platforms. A website-builder
 * fingerprint is read from the official page markup (catches Squarespace/Wix/etc.
 * served from the church's own domain, which have no platform host to match).
 * Deduped by platform; keeps the highest-confidence evidence URL.
 */
export function detectTechStack(findings: SourceFinding[], officialHost = ''): PlatformHit[] {
  const owned = officialHost ? findings.filter((f) => isOwnedFinding(f, officialHost)) : findings;
  const byName = new Map<string, PlatformHit>();
  for (const url of candidateUrls(owned)) {
    const c = classifyPlatform(url);
    if (!c) continue;
    const evidence_url = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    const ex = byName.get(c.platform);
    if (!ex || c.confidence > ex.confidence) {
      byName.set(c.platform, { platform_name: c.platform, category: c.category, confidence: c.confidence, evidence_url });
    }
  }
  // Website platform fingerprint (only if no website platform matched by host).
  if (![...byName.values()].some((h) => h.category === 'Website')) {
    const site = detectWebsitePlatform(owned);
    if (site) byName.set(site.platform_name, site);
  }
  return [...byName.values()].sort((a, b) => b.confidence - a.confidence || a.platform_name.localeCompare(b.platform_name));
}

/** The platform names — the dossier's technology_stack list. */
export function technologyStack(hits: PlatformHit[]): string[] {
  return hits.map((h) => h.platform_name);
}
