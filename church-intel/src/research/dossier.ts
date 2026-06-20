import type { EvidenceAccessLevel } from '../types.js';

export type SourceType =
  | 'official_site'
  | 'staff_page'
  | 'contact_page'
  | 'about_history'
  | 'sermon_livestream'
  | 'youtube'
  | 'facebook'
  | 'instagram'
  | 'linkedin'
  | 'job_posting'
  | 'denom_directory'
  | 'maps'
  | 'church_directory'
  | 'news_media'
  | 'vendor_reference'
  | 'search';

/** Source reliability weights (0..1). */
export const RELIABILITY: Record<EvidenceAccessLevel, number> = {
  user_provided_ground_truth: 1.0,
  live_official_site: 0.95,
  staff_profile: 0.9,
  third_party_directory: 0.78,
  job_posting: 0.75,
  social_profile: 0.7,
  search_snippets: 0.5,
  vendor_reference: 0.2,
};

/** Ranking so we can pick the "best" access level achieved. */
const ACCESS_RANK: EvidenceAccessLevel[] = [
  'vendor_reference',
  'search_snippets',
  'third_party_directory',
  'job_posting',
  'social_profile',
  'staff_profile',
  'live_official_site',
  'user_provided_ground_truth',
];
export function accessRank(level: EvidenceAccessLevel): number {
  return ACCESS_RANK.indexOf(level);
}
export function bestAccess(levels: EvidenceAccessLevel[]): EvidenceAccessLevel {
  if (!levels.length) return 'search_snippets';
  return levels.reduce((a, b) => (accessRank(b) > accessRank(a) ? b : a));
}

/**
 * Confidence cap by the BEST evidence access level supporting a value.
 * This is the mechanism that lets the tool say "I could not fetch the official
 * site, but found indexed evidence — confidence is capped."
 */
export function capForAccess(level: EvidenceAccessLevel): number {
  switch (level) {
    case 'user_provided_ground_truth': return 100;
    case 'live_official_site': return 95;
    case 'staff_profile':
    case 'social_profile':
    case 'job_posting':
    case 'third_party_directory': return 75;
    case 'search_snippets': return 65;
    case 'vendor_reference': return 40;
  }
}

export function capConfidence(raw: number, level: EvidenceAccessLevel): number {
  return Math.max(0, Math.min(capForAccess(level), Math.round(raw)));
}

export interface ExtractedField {
  field_name: string;
  value: string | number | null;
  confidence: number;       // 0..100, pre-cap
  evidence_text: string;
  source_url: string;
  source_type: SourceType;
  access_level: EvidenceAccessLevel;
}

export interface SourceFinding {
  sourceType: SourceType;
  accessLevel: EvidenceAccessLevel;
  url: string;
  title?: string;
  fetched: boolean;         // did we retrieve real page content, or only a snippet?
  status: number;
  text?: string;
  snippet?: string;
  reliability: number;      // 0..1
  fields: ExtractedField[];
  fetchedAt: string;
  // rendered-DOM diagnostics (in-memory only)
  crawlMethod?: string;
  rawTextLength?: number;
  renderedTextLength?: number;
  renderedGainRatio?: number;
}

export function makeFinding(partial: Partial<SourceFinding> & {
  sourceType: SourceType;
  accessLevel: EvidenceAccessLevel;
  url: string;
}): SourceFinding {
  return {
    title: undefined,
    fetched: false,
    status: 0,
    reliability: RELIABILITY[partial.accessLevel],
    fields: [],
    fetchedAt: new Date().toISOString(),
    ...partial,
  };
}

/** The best (highest reliability) access level across all findings. */
export function dossierAccessLevel(findings: SourceFinding[]): EvidenceAccessLevel {
  return bestAccess(findings.map((f) => f.accessLevel));
}

/** Whether the church's own live DOM was actually retrieved. */
export function officialSiteWasCrawled(findings: SourceFinding[]): boolean {
  return findings.some((f) => f.accessLevel === 'live_official_site' && f.fetched);
}

export const OFFICIAL_LEVELS: EvidenceAccessLevel[] = ['live_official_site', 'staff_profile'];
