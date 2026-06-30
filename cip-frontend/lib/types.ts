// Mirror of the CIP API contract (church-intel/src/api/contract.ts).

export type JobStatus = 'queued' | 'running' | 'complete' | 'failed';
export type JobStage =
  | 'queued' | 'discovery' | 'extraction' | 'coverage_validation'
  | 'scoring' | 'dossier_generation' | 'complete' | 'failed';

export interface JobResult {
  church_id?: string;
  dossier_id?: string;
  [k: string]: unknown;
}

export interface Job {
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

export interface DossierSections {
  identity: Record<string, unknown>;
  coverage: Record<string, unknown>;
  size: Record<string, unknown>;
  leadership_access: LeadershipEntry[];
  staff_emails: Record<string, unknown>;
  technology_stack: TechItem[];
  strategic_signals: SignalItem[];
  strategic_scores: Record<string, ScoredDimension>;
  recommendations: Record<string, unknown>;
  outreach_intelligence: Record<string, unknown>;
  raw_evidence: RawEvidenceItem[];
  markdown: string;
}
export interface Dossier extends DossierSections {
  church_id: string;
  dossier_id: string;
}

export interface LeadershipEntry {
  role: string;
  name: string;
  title: string;
  email: string | null;
  source_url: string;
  confidence: number;
}
export interface TechItem {
  platform_name: string;
  category: string;
  confidence: number;
  evidence_url?: string;
}
export interface SignalItem {
  category: string;
  anchor_text?: string;
  host?: string;
  destination_url?: string;
  confidence: number;
  dimensions?: string[];
}
export interface ScoreFactor { label: string; points: number; evidence_refs?: string[] }
export interface ScoredDimension {
  dimension: string;
  score: number;
  band: string;
  confidence: number;
  positive_factors: ScoreFactor[];
  negative_factors: ScoreFactor[];
  not_investigated: ScoreFactor[];
  top_factors?: ScoreFactor[];
}
export interface RawEvidenceItem {
  id: string;
  source_type: string;
  source_url: string;
  page_category: string;
  text_excerpt: string;
  fetched: boolean;
  access_level: string;
}

export interface DashboardStats {
  total_churches: number;
  jobs_queued: number;
  jobs_running: number;
  jobs_completed: number;
  jobs_failed: number;
  avg_engagement_fit: number | null;
  recent_dossiers: ChurchRow[];
  top_opportunities: ChurchRow[];
  churches_by_archetype: { label: string; count: number }[];
  churches_by_state: { label: string; count: number }[];
  recent_activity: Job[];
}

export interface ChurchFilters {
  q?: string;
  state?: string;
  archetype?: string;
  priority?: string;
  min_coverage?: number;
  min_confidence?: number;
  limit?: number;
  offset?: number;
}
