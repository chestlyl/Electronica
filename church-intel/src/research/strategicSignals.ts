import type { EvidenceAccessLevel } from '../types.js';
import { accessRank, type SourceFinding } from './dossier.js';
import { classifyPlatform } from './techStack.js';

/**
 * Deterministic Strategic Signal layer — EVIDENCE COLLECTION ONLY.
 *
 * Classifies every link/anchor/host/page-keyword discovered across the dossier's
 * findings into a strategic category, records where it came from (source page,
 * destination URL, host, anchor text, confidence, evidence access level), and
 * maps each category to the five strategic dimensions it supports.
 *
 * This does NOT alter scores, lifecycle, archetype, discovery, identity, or
 * ownership verification. It only surfaces and connects signal that the crawler
 * already gathered but previously discarded.
 */

export type SignalCategory =
  | 'church_management'
  | 'giving'
  | 'groups'
  | 'forms_workflows'
  | 'events_calendar'
  | 'livestream_video'
  | 'podcast'
  | 'social_media'
  | 'jobs_hiring'
  | 'internship_residency'
  | 'school_academy'
  | 'network_affiliation'
  | 'outreach_partner'
  | 'newsletter_email'
  | 'app_mobile'
  | 'communications'
  | 'other';

export type Dimension =
  | 'digital_maturity'
  | 'growth_orientation'
  | 'change_readiness'
  | 'organizational_capacity'
  | 'contactability';

/**
 * Authoritative category → dimension mapping (matches the product examples:
 * Church Center, Pushpay, job posting, residency, podcast, school, Mailchimp,
 * network affiliation). Evidence-relevance only — NOT a scoring weight.
 */
export const CATEGORY_DIMENSIONS: Record<SignalCategory, Dimension[]> = {
  church_management: ['digital_maturity', 'organizational_capacity', 'contactability'],
  giving: ['digital_maturity', 'organizational_capacity'],
  groups: ['organizational_capacity', 'contactability'],
  forms_workflows: ['digital_maturity', 'organizational_capacity', 'contactability'],
  events_calendar: ['digital_maturity', 'organizational_capacity'],
  livestream_video: ['digital_maturity', 'growth_orientation'],
  podcast: ['digital_maturity', 'growth_orientation'],
  social_media: ['digital_maturity', 'contactability'],
  jobs_hiring: ['growth_orientation', 'organizational_capacity', 'change_readiness'],
  internship_residency: ['growth_orientation', 'organizational_capacity', 'change_readiness'],
  school_academy: ['organizational_capacity', 'growth_orientation'],
  network_affiliation: ['change_readiness', 'growth_orientation'],
  outreach_partner: ['growth_orientation', 'change_readiness'],
  newsletter_email: ['digital_maturity', 'contactability'],
  app_mobile: ['digital_maturity', 'organizational_capacity'],
  communications: ['digital_maturity', 'contactability'],
  other: [],
};

export const DIMENSIONS: Dimension[] = [
  'digital_maturity', 'growth_orientation', 'change_readiness', 'organizational_capacity', 'contactability',
];

export interface StrategicSignal {
  category: SignalCategory;
  anchor_text: string;
  source_page: string;       // the finding/page the signal was discovered on
  destination_url: string;   // where the signal points (= source_page for page-text signals)
  host: string;
  confidence: number;        // 0..100 (deterministic; host > anchor > text keyword)
  access_level: EvidenceAccessLevel;
  dimensions: Dimension[];
}

// ── deterministic host → strategic-category table (beyond techStack platforms) ─
const HOST_CATEGORY: { host: RegExp; category: SignalCategory; confidence: number }[] = [
  { host: /(^|\.)youtube\.com$|(^|\.)youtu\.be$|(^|\.)vimeo\.com$/i, category: 'livestream_video', confidence: 85 },
  { host: /(^|\.)spotify\.com$|(^|\.)podcasts\.apple\.com$|(^|\.)anchor\.fm$|(^|\.)buzzsprout\.com$|(^|\.)podbean\.com$|(^|\.)simplecast\.com$/i, category: 'podcast', confidence: 85 },
  { host: /(^|\.)facebook\.com$|(^|\.)fb\.com$|(^|\.)instagram\.com$|(^|\.)twitter\.com$|(^|\.)x\.com$|(^|\.)tiktok\.com$|(^|\.)linkedin\.com$/i, category: 'social_media', confidence: 85 },
];

// platform category (techStack) → strategic signal category
const PLATFORM_CATEGORY_MAP: Record<string, SignalCategory> = {
  ChMS: 'church_management',
  Giving: 'giving',
  App: 'app_mobile',
  Communication: 'communications',
  Email: 'newsletter_email',
  Streaming: 'livestream_video',
  Website: 'other',
  Other: 'other',
};

// anchor-text keyword → category (church's own internal links with descriptive labels)
const ANCHOR_KEYWORDS: { re: RegExp; category: SignalCategory }[] = [
  { re: /\b(give|giving|donate|donation|tithe|offering)\b/i, category: 'giving' },
  { re: /\b(small ?groups?|connect ?groups?|life ?groups?|groups)\b/i, category: 'groups' },
  { re: /\b(calendar|events?)\b/i, category: 'events_calendar' },
  { re: /\b(forms?|registration|register|sign[ -]?up|rsvp)\b/i, category: 'forms_workflows' },
  { re: /\b(watch|live ?stream|livestream|sermons?|messages|videos?)\b/i, category: 'livestream_video' },
  { re: /\bpodcasts?\b/i, category: 'podcast' },
  { re: /\b(jobs?|careers?|hiring|employment|openings?)\b/i, category: 'jobs_hiring' },
  { re: /\b(internships?|interns?)\b/i, category: 'internship_residency' },
  { re: /\b(residency|residents?)\b/i, category: 'internship_residency' },
  { re: /\b(school|academy|pre[- ]?school|daycare|childcare|christian ?school)\b/i, category: 'school_academy' },
  { re: /\b(newsletters?|subscribe|mailing ?list|email ?list)\b/i, category: 'newsletter_email' },
  { re: /\b(download.*app|our app|mobile app)\b/i, category: 'app_mobile' },
];

// page-text keyword → category (conservative; high-signal phrases only)
const TEXT_KEYWORDS: { re: RegExp; category: SignalCategory }[] = [
  { re: /\b(pastoral |ministry )?residency\b|\bresident program\b/i, category: 'internship_residency' },
  { re: /\binternship\b|\bministry interns?\b/i, category: 'internship_residency' },
  { re: /\b(christian (school|academy)|pre[- ]?school|daycare|childcare|day school)\b/i, category: 'school_academy' },
  { re: /\bpodcast\b/i, category: 'podcast' },
  { re: /\b(now hiring|we'?re hiring|job opening|employment opportunit|join our (staff|team))\b/i, category: 'jobs_hiring' },
  { re: /\bchurch of the nazarene\b|\bassemblies of god\b|\bsouthern baptist\b|\bacts ?29\b|\barc churches?\b/i, category: 'network_affiliation' },
];

function hostOf(url: string): string {
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function categoryFromHost(url: string): { category: SignalCategory; confidence: number } | null {
  const platform = classifyPlatform(url);
  if (platform) {
    const category = PLATFORM_CATEGORY_MAP[platform.category] ?? 'other';
    return { category, confidence: Math.min(platform.confidence, 90) };
  }
  const h = hostOf(url);
  if (!h) return null;
  for (const e of HOST_CATEGORY) if (e.host.test(h)) return { category: e.category, confidence: e.confidence };
  return null;
}

function categoryFromAnchor(text: string): SignalCategory | null {
  if (!text) return null;
  for (const e of ANCHOR_KEYWORDS) if (e.re.test(text)) return e.category;
  return null;
}

const URL_RE = /\bhttps?:\/\/[^\s"'<>)]+|\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s"'<>)]*)?/gi;

/**
 * Classify all strategic signals across the dossier findings (deterministic).
 * Website-first: signals are sorted by evidence access level (live official site
 * first), then confidence, so the official website's own signals lead.
 */
export function detectStrategicSignals(findings: SourceFinding[]): StrategicSignal[] {
  const byKey = new Map<string, StrategicSignal>();

  const add = (s: StrategicSignal) => {
    if (s.category === 'other') return; // record only meaningful categories
    const key = `${s.category}|${s.destination_url}`;
    const ex = byKey.get(key);
    // keep the strongest evidence: better access level, else higher confidence
    if (!ex || accessRank(s.access_level) > accessRank(ex.access_level) ||
        (accessRank(s.access_level) === accessRank(ex.access_level) && s.confidence > ex.confidence)) {
      byKey.set(key, s);
    }
  };

  const mk = (category: SignalCategory, anchor: string, source: string, dest: string, conf: number, access: EvidenceAccessLevel): StrategicSignal => ({
    category, anchor_text: (anchor || '').slice(0, 120), source_page: source, destination_url: dest,
    host: hostOf(dest), confidence: conf, access_level: access, dimensions: CATEGORY_DIMENSIONS[category],
  });

  for (const f of findings) {
    const source = f.url;
    const access = f.accessLevel;

    // (1) The finding's own URL host (e.g. a *.churchcenter.com page).
    const ownHost = categoryFromHost(f.url);
    if (ownHost) add(mk(ownHost.category, f.title ?? '', source, f.url, ownHost.confidence, access));

    // (2) Outbound links preserved from the page (host first, then anchor text).
    const links: { url: string; text: string }[] = [
      ...(f.outboundLinks ?? []),
      ...(f.linkDiagnostics ?? []).map((d) => ({ url: d.resolvedUrl || d.href, text: d.anchorText })),
    ];
    for (const link of links) {
      if (!link.url) continue;
      // A link can carry BOTH a platform signal (by host) AND a functional
      // signal (by anchor text / URL path). e.g. churchcenter.com/groups is
      // church_management (host) AND groups (path). Emit every distinct one.
      const byHost = categoryFromHost(link.url);
      if (byHost) add(mk(byHost.category, link.text, source, link.url, byHost.confidence, access));
      let path = ''; try { path = new URL(link.url).pathname.replace(/[-_/]+/g, ' '); } catch { /* keep '' */ }
      const byAnchor = categoryFromAnchor(`${link.text} ${path}`);
      if (byAnchor && byAnchor !== byHost?.category) add(mk(byAnchor, link.text, source, link.url, byHost ? byHost.confidence : 70, access));
    }

    // (3) URLs embedded in the evidence text/snippet (host classification only).
    const text = `${f.title ?? ''} ${(f.fetched ? f.text : f.snippet) ?? ''}`;
    for (const m of text.matchAll(URL_RE)) {
      const byHost = categoryFromHost(m[0]);
      if (byHost) {
        const dest = /^https?:\/\//i.test(m[0]) ? m[0] : `https://${m[0]}`;
        add(mk(byHost.category, '', source, dest, byHost.confidence, access));
      }
    }

    // (4) Page-text keyword signals (residency, school, podcast, hiring, network).
    for (const e of TEXT_KEYWORDS) {
      const m = text.match(e.re);
      if (m) add(mk(e.category, m[0], source, source, 55, access));
    }
  }

  return [...byKey.values()].sort((a, b) =>
    accessRank(b.access_level) - accessRank(a.access_level) ||
    b.confidence - a.confidence ||
    a.category.localeCompare(b.category));
}

/** Count of signals supporting each strategic dimension. */
export function dimensionCounts(signals: StrategicSignal[]): Record<Dimension, number> {
  const counts: Record<Dimension, number> = {
    digital_maturity: 0, growth_orientation: 0, change_readiness: 0, organizational_capacity: 0, contactability: 0,
  };
  for (const s of signals) for (const d of s.dimensions) counts[d]++;
  return counts;
}

/** One-line evidence summary (for dossier markdown). */
export function strategicSignalSummary(signals: StrategicSignal[]): string {
  if (!signals.length) return 'no strategic signals detected';
  const c = dimensionCounts(signals);
  return `${signals.length} signals · digital_maturity ${c.digital_maturity} · growth_orientation ${c.growth_orientation} · change_readiness ${c.change_readiness} · organizational_capacity ${c.organizational_capacity} · contactability ${c.contactability}`;
}
