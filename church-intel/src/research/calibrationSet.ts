import { readFileSync } from 'node:fs';
import { capForAccess } from './dossier.js';
import { toolFieldsFromBuild, type FieldMap } from './calibration.js';
import { digitalEvidenceSummary } from './digitalSignals.js';
import { deriveArchetype, deriveContactability, type Derived } from './interpret.js';
import type { DossierBuild, ResearchTarget } from './researchAgent.js';
import type { LinkDiagnostic } from './types.js';
import type { CoverageRow, SourceCoverageRow } from './coverage.js';
import type { LeaderCandidate } from './extractors.js';
import type { PlatformHit } from './techStack.js';
import type { StrategicSignal, Dimension } from './strategicSignals.js';
import { normalizedCounts as normalizedCountsOf } from './evidenceModel.js';
import type { Interpretation } from './evidenceModel.js';
import type { StrategicScores } from './strategicScoring.js';
import type { RecommendationEngineResult } from './recommendationEngine.js';

// Re-exported for compatibility (the derivations now live in the interpretation
// layer; calibration unit tests import deriveArchetype from here).
export { deriveArchetype, deriveContactability, type Derived };

export interface CalibrationEntry {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  url?: string | null;
}

export function loadCalibrationSet(path: string): CalibrationEntry[] {
  return JSON.parse(readFileSync(path, 'utf8')) as CalibrationEntry[];
}

/** Error message when a known-church calibration row is missing its website URL. */
export const KNOWN_CHURCH_URL_REQUIRED =
  'Known church calibration requires an official website URL. Use market-discovery mode to find unknown churches.';

/** Calibration rows are KNOWN churches → they must carry an official website URL. */
export function requireCalibrationUrl(entry: CalibrationEntry): string {
  if (!entry.url) throw new Error(`${entry.id}: ${KNOWN_CHURCH_URL_REQUIRED}`);
  return entry.url;
}

/** Map the internal lifecycle enum to the calibration-report vocabulary. */
export function lifecycleDisplay(stage: string | null | undefined): string {
  switch (stage) {
    case 'plant': return 'church_plant';
    case 'relaunch_revitalization': return 'revitalizing';
    case 'growing': return 'growing';
    case 'established': return 'established';
    case 'plateaued': return 'plateaued';
    case 'declining': return 'declining';
    default: return stage ?? 'unknown';
    // note: 'relaunching' and 'reverting' are not separately detectable yet.
  }
}

export interface CalibrationConflict {
  field_name: string; value_a: string | null; value_b: string | null; recommended_value: string | null; confidence: number | null;
}

/** Serializable per-church calibration row (cached as <id>.json by calibrate-run). */
export interface CalibrationRow {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  officialSite: string | null;
  inputMode: string;
  providedUrl: string | null;
  websiteVerificationStatus: string;
  identityVerdict: string;
  identity_confidence: number;
  contaminationFlags: string[];
  accessLevel: string;
  research_confidence: number | null;
  fields: FieldMap;
  summaries: { identity: string; digital: string; staff: string; growth: string; lifecycle: string; research: string };
  conflicts: CalibrationConflict[];
  archetype: Derived;
  contactability: Derived;
  lifecycle: { value: string; confidence: number; evidence: string };
  crawl: { officialDomFetched: boolean; renderedDomUsed: boolean; crawlMethod: string; rawTextLength: number; renderedTextLength: number; renderedGainRatio: number; links: LinkDiagnostic[] };
  coverage: CoverageRow[];
  sourceCoverage: SourceCoverageRow[];
  leadership: LeaderCandidate[];
  techStack: PlatformHit[];
  strategicSignals: StrategicSignal[];
  strategicDimensionCounts: Record<Dimension, number>;
  /** Layer 4 conclusions — report + enrich consume this same object. */
  interpretation: Interpretation;
  /** Strategic Scoring v1 — rubric-based, report-only. */
  strategicScores: StrategicScores;
  /** Strategic Recommendation Engine (Phase 2) — deterministic, report-only. */
  recommendations: RecommendationEngineResult;
  /** Layer 2/3 instrumentation. */
  rawEvidenceCount: number;
  normalizedCounts: Record<string, number>;
  digitalSummary: string;
  scoreNotes: Record<string, { confidence: number; tier: string; reason: string }>;
  generatedAt: string;
}

export function rowFromBuild(entry: CalibrationEntry, build: DossierBuild): CalibrationRow {
  const target: ResearchTarget = { name: entry.name, city: entry.city, state: entry.state, originalWebsite: entry.url ?? null, alternateName: null };
  const fields = toolFieldsFromBuild(target, build);
  const s = build.synthesis;
  const lifecycleConf = build.fieldEstimates.find((f) => f.field_name === 'lifecycle_stage')?.confidence ?? build.dossier.research_confidence ?? 0;
  return {
    id: entry.id, name: entry.name, city: entry.city, state: entry.state,
    officialSite: build.officialSite,
    inputMode: build.identity.inputMode,
    providedUrl: build.identity.providedUrl,
    websiteVerificationStatus: build.identity.websiteVerificationStatus,
    identityVerdict: build.identity.identityVerdict,
    identity_confidence: build.identity.identity_confidence,
    contaminationFlags: build.contamination,
    accessLevel: build.accessLevel,
    research_confidence: build.dossier.research_confidence,
    fields,
    summaries: {
      identity: s.identity_summary, digital: s.digital_summary, staff: s.staff_summary,
      growth: s.growth_summary, lifecycle: s.lifecycle_summary, research: s.research_summary,
    },
    conflicts: build.conflicts.map((c) => ({ field_name: c.field_name, value_a: c.value_a, value_b: c.value_b, recommended_value: c.recommended_value, confidence: c.confidence })),
    // Archetype + contactability are now INTERPRETATION conclusions (Layer 4) —
    // the row surfaces them rather than re-deriving them in the report layer.
    archetype: { value: build.interpretation.archetype.value, confidence: build.interpretation.archetype.confidence, evidence: build.interpretation.archetype.reason },
    contactability: { value: String(build.interpretation.contactability_score.value), confidence: build.interpretation.contactability_score.confidence, evidence: build.interpretation.contactability_score.reason },
    // Lifecycle is an INTERPRETATION conclusion; summary text stays as evidence.
    lifecycle: { value: lifecycleDisplay(String(build.interpretation.lifecycle_stage.value)), confidence: lifecycleConf, evidence: s.lifecycle_summary },
    crawl: build.crawl,
    coverage: build.coverage,
    sourceCoverage: build.sourceCoverage,
    leadership: build.leadership.map((l) => ({ ...l, confidence: Math.min(l.confidence, capForAccess(build.accessLevel as any)) })),
    techStack: build.techStack,
    strategicSignals: build.strategicSignals,
    strategicDimensionCounts: build.strategicDimensionCounts,
    interpretation: build.interpretation,
    strategicScores: build.strategicScores,
    recommendations: build.recommendations,
    rawEvidenceCount: build.raw.length,
    normalizedCounts: normalizedCountsOf(build.normalized),
    digitalSummary: digitalEvidenceSummary(build.digital),
    scoreNotes: Object.fromEntries(Object.entries(build.scoreConfidence).map(([k, v]) => [k, { confidence: v.confidence, tier: v.tier, reason: v.reason }])),
    generatedAt: new Date().toISOString(),
  };
}
