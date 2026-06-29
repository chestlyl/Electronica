import type { SourceFinding } from './dossier.js';
import type { StrategicSignal } from './strategicSignals.js';
import type { PlatformHit } from './techStack.js';
import type { DigitalSignals } from './digitalSignals.js';

/**
 * Coverage Validation Layer (Stage between Extraction and Scoring).
 *
 * Records, per evidence category, what the crawl ACTUALLY investigated — so the
 * system can tell apart:
 *   • investigated and absent  (page crawled, nothing there)  → may reduce score
 *   • discovered and uncrawled (a link/signal, no page)        → reduce confidence
 *   • missing                  (no link, no signal, no page)   → reduce confidence
 *
 * This stage CHANGES NO SCORES. It is pure honesty: it computes status from real
 * crawl facts (which pages were fetched, which signals fired, which platforms were
 * detected) — NOT from the Digital-Signals heuristic that produced the Cross Point
 * contradiction.
 */

export type CovStatus = 'complete' | 'partial' | 'missing';

export interface CoverageCategory {
  category: string;
  status: CovStatus;
  required: boolean;
  /** Did we look where this evidence would be? (page fetched / detector ran on the
   *  right pages). An absence is only meaningful — i.e. score-eligible — if true. */
  investigated: boolean;
  note: string;
  evidence_ids: string[];   // finding URLs / signal categories that support the status
}

export interface CoverageReport {
  coveragePercent: number;
  categories: CoverageCategory[];
  complete: string[];
  partial: string[];
  missing: string[];
  /** Quick lookup for the scoring gate: was this coverage category investigated? */
  investigatedSet: Set<string>;
}

export interface CoverageInput {
  findings: SourceFinding[];
  strategicSignals: StrategicSignal[];
  techStack: PlatformHit[];
  digital: DigitalSignals;
  campusKnown?: boolean;
}

const STATUS_VALUE: Record<CovStatus, number> = { complete: 1, partial: 0.5, missing: 0 };

export function validateCoverage(input: CoverageInput): CoverageReport {
  const { findings, strategicSignals, techStack, digital, campusKnown } = input;
  const fetchedCats = new Set(findings.filter((f) => f.fetched).map((f) => f.category ?? ''));
  const fetched = (...cats: string[]) => cats.some((c) => fetchedCats.has(c));
  const sig = (...cats: string[]) => strategicSignals.some((s) => cats.includes(s.category));
  const sigIds = (...cats: string[]) => strategicSignals.filter((s) => cats.includes(s.category)).map((s) => s.category);
  const pageIds = (...cats: string[]) => findings.filter((f) => f.fetched && cats.includes(f.category ?? '')).map((f) => f.url);

  // platform-revealing pages: where a tech/app/giving stack actually shows up.
  const platformPages = fetched('giving', 'groups', 'app', 'sermons');
  const appDetected = digital.church_app || digital.platforms.length > 0;
  // 'technology' coverage = CORE infrastructure (ChMS/Giving/App/Website/Email).
  // Streaming (YouTube/Vimeo) belongs to sermons/media, and a single homepage
  // link to it must not, by itself, mark the tech stack "investigated".
  const coreTech = techStack.filter((t) => t.category !== 'Streaming');
  const techDetected = coreTech.length > 0 || digital.platforms.length > 0;

  type Spec = { category: string; required?: boolean; complete: boolean; partial: boolean; investigated: boolean; ids: string[]; note: string };
  const specs: Spec[] = [
    { category: 'homepage', required: true, complete: fetched('home'), partial: false, investigated: fetched('home'), ids: pageIds('home'), note: fetched('home') ? 'fetched' : 'not fetched' },
    { category: 'about', required: true, complete: fetched('about'), partial: false, investigated: fetched('about'), ids: pageIds('about'), note: fetched('about') ? 'fetched' : 'not fetched' },
    { category: 'staff', required: true, complete: fetched('staff', 'leadership'), partial: false, investigated: fetched('staff', 'leadership'), ids: pageIds('staff', 'leadership'), note: fetched('staff', 'leadership') ? 'fetched' : 'not fetched' },
    { category: 'contact', required: true, complete: fetched('contact'), partial: false, investigated: fetched('contact'), ids: pageIds('contact'), note: fetched('contact') ? 'fetched' : 'not fetched' },
    { category: 'campuses', complete: fetched('locations'), partial: !!campusKnown, investigated: fetched('locations'), ids: pageIds('locations'), note: fetched('locations') ? 'campus pages fetched' : (campusKnown ? 'campus count inferred from text; pages not crawled' : 'not investigated') },
    { category: 'ministries', complete: fetched('ministries'), partial: sig('school_academy'), investigated: fetched('ministries'), ids: pageIds('ministries').concat(sigIds('school_academy')), note: fetched('ministries') ? 'fetched' : (sig('school_academy') ? 'signal only' : 'not investigated') },
    { category: 'groups', complete: fetched('groups'), partial: sig('groups'), investigated: fetched('groups'), ids: pageIds('groups').concat(sigIds('groups')), note: fetched('groups') ? 'fetched' : (sig('groups') ? 'link/signal only, page not crawled' : 'not investigated') },
    { category: 'giving', complete: fetched('giving'), partial: sig('giving'), investigated: fetched('giving'), ids: pageIds('giving').concat(sigIds('giving')), note: fetched('giving') ? 'giving page fetched' : (sig('giving') ? 'give link/signal only, page not crawled' : 'not investigated') },
    { category: 'sermons/media', complete: fetched('sermons'), partial: sig('livestream_video', 'podcast'), investigated: fetched('sermons'), ids: pageIds('sermons').concat(sigIds('livestream_video', 'podcast')), note: fetched('sermons') ? 'media page fetched' : (sig('livestream_video', 'podcast') ? 'media link/signal only, page not crawled' : 'not investigated') },
    { category: 'app/mobile', complete: appDetected, partial: sig('app_mobile') || (!appDetected && platformPages), investigated: appDetected || platformPages, ids: sigIds('app_mobile'), note: appDetected ? `app/platform detected` : (platformPages ? 'platform pages crawled, no app found (verified absent)' : 'not investigated') },
    { category: 'technology', complete: techDetected, partial: !techDetected && platformPages, investigated: techDetected || platformPages, ids: coreTech.map((t) => t.platform_name), note: techDetected ? coreTech.map((t) => t.platform_name).join(', ') || digital.platforms.join(', ') : (platformPages ? 'platform pages crawled, no known stack (verified absent)' : 'tech-revealing pages not crawled') },
    { category: 'social', complete: sig('social_media'), partial: false, investigated: fetched('home'), ids: sigIds('social_media'), note: sig('social_media') ? 'social profiles found' : (fetched('home') ? 'home crawled, no social links' : 'not investigated') },
    { category: 'jobs/careers', complete: fetched('jobs'), partial: sig('jobs_hiring'), investigated: fetched('jobs'), ids: pageIds('jobs').concat(sigIds('jobs_hiring')), note: fetched('jobs') ? 'jobs page fetched' : (sig('jobs_hiring') ? 'hiring signal only, page not crawled' : 'not investigated') },
  ];

  const categories: CoverageCategory[] = specs.map((s) => ({
    category: s.category, required: !!s.required,
    status: s.complete ? 'complete' : s.partial ? 'partial' : 'missing',
    investigated: s.investigated, note: s.note, evidence_ids: [...new Set(s.ids)],
  }));

  // weighted coverage % (required categories count double)
  const weightOf = (c: CoverageCategory) => (c.required ? 2 : 1);
  const num = categories.reduce((acc, c) => acc + weightOf(c) * STATUS_VALUE[c.status], 0);
  const den = categories.reduce((acc, c) => acc + weightOf(c), 0);
  const coveragePercent = Math.round((num / den) * 100);

  return {
    coveragePercent,
    categories,
    complete: categories.filter((c) => c.status === 'complete').map((c) => c.category),
    partial: categories.filter((c) => c.status === 'partial').map((c) => c.category),
    missing: categories.filter((c) => c.status === 'missing').map((c) => c.category),
    investigatedSet: new Set(categories.filter((c) => c.investigated).map((c) => c.category)),
  };
}
