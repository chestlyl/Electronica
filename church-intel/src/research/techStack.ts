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
  { host: /(^|\.)wixsite\.com$|(^|\.)wix\.com$/i, platform: 'Wix', category: 'Website', confidence: 85 },
  // extras (deterministic, useful — not in the required list)
  { host: /(^|\.)givelify\.com$/i, platform: 'Givelify', category: 'Giving', confidence: 95 },
  { host: /(^|\.)easytithe\.com$/i, platform: 'EasyTithe', category: 'Giving', confidence: 90 },
  { host: /(^|\.)ccbchurch\.com$/i, platform: 'Church Community Builder', category: 'ChMS', confidence: 90 },
  { host: /(^|\.)wordpress\.(?:com|org)$/i, platform: 'WordPress', category: 'Website', confidence: 80 },
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

/**
 * Detect the church's technology stack across all findings (hostname mapping
 * only). Deduped by platform; keeps the highest-confidence evidence URL.
 */
export function detectTechStack(findings: SourceFinding[]): PlatformHit[] {
  const byName = new Map<string, PlatformHit>();
  for (const url of candidateUrls(findings)) {
    const c = classifyPlatform(url);
    if (!c) continue;
    const evidence_url = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    const ex = byName.get(c.platform);
    if (!ex || c.confidence > ex.confidence) {
      byName.set(c.platform, { platform_name: c.platform, category: c.category, confidence: c.confidence, evidence_url });
    }
  }
  return [...byName.values()].sort((a, b) => b.confidence - a.confidence || a.platform_name.localeCompare(b.platform_name));
}

/** The platform names — the dossier's technology_stack list. */
export function technologyStack(hits: PlatformHit[]): string[] {
  return hits.map((h) => h.platform_name);
}
