/**
 * CIP API contract (Stage: API seam). These types mirror the shapes Base44's
 * `lib/cipApiContract.js` already expects. The backend owns every secret and the
 * research orchestration; Base44 only ever sees these contract-shaped responses.
 *
 * IDs are opaque, prefixed strings (`job_…`, `church_…`, `dossier_…`) generated
 * by the backend — never database UUIDs leaked across the seam.
 */

export type JobStatus = 'queued' | 'running' | 'complete' | 'failed';
export type JobStage =
  | 'queued'
  | 'discovery'
  | 'extraction'
  | 'coverage_validation'
  | 'scoring'
  | 'dossier_generation'
  | 'complete'
  | 'failed';
export type InputType = 'known_church' | 'discovery';

/** Result payload stored on a completed job. */
export interface JobResult {
  church_id?: string;
  dossier_id?: string;
  [k: string]: unknown;
}

/** The persisted job record (full row — `research_jobs`). */
export interface JobRecord {
  job_id: string;
  status: JobStatus;
  stage: JobStage;
  progress: number;
  input_type: InputType;
  input_payload: unknown;
  church_id: string | null;
  result_payload: JobResult | null;
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

/** GET /research/jobs/:id response. */
export interface JobStatusResponse {
  job_id: string;
  status: JobStatus;
  stage: JobStage;
  progress: number;
  started_at: string | null;
  completed_at: string | null;
  error: string | null;
  church_id: string | null;
  result: JobResult | null;
}

/** A church row in the researched repository (`churches`). */
export interface ChurchRow {
  church_id: string;
  name: string | null;
  city: string | null;
  state: string | null;
  website: string | null;
  verified: boolean;
  denomination: string | null;
  archetype: string | null;
  lifecycle: string | null;
  awa: number | null;
  attendance_source: string | null;
  coverage_percent: number | null;
  research_confidence: number | null;
  engagement_fit: number | null;
  priority: string | null;
  last_researched_at: string | null;
  created_at: string;
  updated_at: string;
}

/** The strategic fields written to a church row after research completes. */
export type ChurchResearchFields = Pick<
  ChurchRow,
  | 'name' | 'city' | 'state' | 'website' | 'verified' | 'denomination' | 'archetype'
  | 'lifecycle' | 'awa' | 'attendance_source' | 'coverage_percent' | 'research_confidence'
  | 'engagement_fit' | 'priority'
>;

/** The structured + markdown dossier sections (contract `dossiers`). */
export interface DossierSections {
  identity: Record<string, unknown>;
  coverage: Record<string, unknown>;
  size: Record<string, unknown>;
  leadership_access: unknown[];
  staff_emails: Record<string, unknown>;
  technology_stack: unknown[];
  strategic_signals: unknown[];
  strategic_scores: Record<string, unknown>;
  recommendations: Record<string, unknown>;
  outreach_intelligence: Record<string, unknown>;
  raw_evidence: unknown[];
  markdown: string;
}

/** Persisted dossier record. */
export interface DossierRecord extends DossierSections {
  dossier_id: string;
  church_id: string;
  job_id: string | null;
  created_at: string;
}

/** GET /churches/:id/dossier response. */
export interface DossierResponse extends DossierSections {
  church_id: string;
  dossier_id: string;
}

export interface ListChurchesFilter {
  q?: string;
  state?: string;
  priority?: string;
  archetype?: string;
  min_coverage?: number;
  min_confidence?: number;
  limit?: number;
  offset?: number;
}
