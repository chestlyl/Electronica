import type { EvidenceAccessLevel } from '../types.js';

/**
 * Layered evidence model — the contracts that keep the research pipeline's five
 * layers from doing each other's jobs:
 *
 *   1. Input Mode          → ResearchTarget         (researchAgent.ts)
 *   2. Evidence Collection → RawEvidence[]          (collectors / this file)
 *   3. Normalization       → NormalizedEvidence     (normalize.ts)
 *   4. Interpretation      → Interpretation         (interpret.ts) — ONLY conclusions
 *   5. Reporting / Writing → consume Interpretation  (report + enrich)
 *
 * Collectors collect (no meaning). Normalizers structure (no conclusions).
 * Only the interpreter concludes, and every conclusion must reference normalized
 * evidence rows. Report and enrich consume the SAME Interpretation object, so
 * they can never diverge.
 */

// ── Layer 2: raw evidence (what a collector gathered, no interpretation) ──────
export interface RawEvidence {
  id: string;
  source_type: string;
  source_url: string;
  page_category: string;
  text_excerpt: string;
  outbound_links: { url: string; text: string }[];
  fetched: boolean;
  rendered: boolean;
  crawl_method: string;
  access_level: EvidenceAccessLevel;
  collected_at: string;
}

// ── Layer 3: one normalized evidence row (structured, still not a conclusion) ─
export interface NormalizedRow {
  id: string;                 // stable id (e.g. "leader_1") for evidence references
  value: string;              // the normalized value (name, email, platform, …)
  category: string;           // role / category / type (e.g. "lead_pastor", "giving")
  detail?: string;            // title / dimensions / extra context
  source_url: string;
  evidence_text: string;
  confidence: number;         // 0..100 (pre-conclusion, evidence-strength only)
  access_level: EvidenceAccessLevel;
  extractor_name: string;     // which normalizer produced this row (provenance)
}

export interface NormalizedEvidence {
  leaders: NormalizedRow[];
  contacts: NormalizedRow[];
  locations: NormalizedRow[];
  services: NormalizedRow[];
  staff_roster: NormalizedRow[];
  technology_stack: NormalizedRow[];
  external_signals: NormalizedRow[];
  ministries: NormalizedRow[];
  sermons_media: NormalizedRow[];
  jobs_hiring: NormalizedRow[];
  network_affiliations: NormalizedRow[];
  conflicts: NormalizedRow[];
}

export function emptyNormalizedEvidence(): NormalizedEvidence {
  return {
    leaders: [], contacts: [], locations: [], services: [], staff_roster: [],
    technology_stack: [], external_signals: [], ministries: [], sermons_media: [],
    jobs_hiring: [], network_affiliations: [], conflicts: [],
  };
}

/** Counts per normalized table (instrumentation). */
export function normalizedCounts(n: NormalizedEvidence): Record<string, number> {
  return Object.fromEntries(Object.entries(n).map(([k, v]) => [k, (v as NormalizedRow[]).length]));
}

// ── Layer 4: a single interpreted conclusion (must reference evidence rows) ───
export interface Conclusion<T> {
  value: T;
  confidence: number;
  evidence_ids: string[];     // ids of the NormalizedRow(s) this conclusion rests on
  reason: string;             // human-readable justification
  access_level: EvidenceAccessLevel;
}

export interface Interpretation {
  lead_pastors: Conclusion<string[]>;
  executive_pastor: Conclusion<string | null>;
  operations_leader: Conclusion<string | null>;
  communications_leader: Conclusion<string | null>;
  office_email: Conclusion<string | null>;
  office_phone: Conclusion<string | null>;
  staff_count: Conclusion<number | null>;
  address: Conclusion<string | null>;
  denomination: Conclusion<string | null>;
  attendance_estimate: Conclusion<number | null>;
  lifecycle_stage: Conclusion<string>;
  archetype: Conclusion<string>;
  digital_maturity_score: Conclusion<number | null>;
  growth_orientation_score: Conclusion<number | null>;
  change_readiness_score: Conclusion<number | null>;
  staff_depth_score: Conclusion<number | null>;
  contactability_score: Conclusion<number>;
  known_church_verified: boolean;
}
