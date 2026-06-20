export type ActiveStatus =
  | 'Verified Active'
  | 'Likely Active'
  | 'Uncertain'
  | 'Closed'
  | 'Merged';

export type ConfidenceTier = 'High' | 'Medium' | 'Low' | 'Very Low';

export type ReviewStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'needs_more_research';

export type RunStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'partial';

export interface Church {
  id: string;
  original_row_id: string;
  name: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string | null;
  phone_original: string | null;
  email_original: string | null;
  website_original: string | null;
  phone_verified: string | null;
  email_verified: string | null;
  website_verified: string | null;
  active_status: ActiveStatus | null;
  lead_pastor: string | null;
  denomination: string | null;
  network_affiliation: string | null;
  language: string | null;
  staff_count: number | null;
  campus_count: number | null;
  weekend_services_count: number | null;
  attendance_estimate: number | null;
  attendance_min: number | null;
  attendance_max: number | null;
  attendance_confidence: number | null;
  attendance_confidence_tier: ConfidenceTier | null;
  influence_score: number | null;
  mmc_fit_score: number | null;
  multiplication_score: number | null;
  church_planting_activity: number | null;
  leadership_development_score: number | null;
  digital_reach_score: number | null;
  verification_score: number | null;
  review_status: string | null;
  notes: string | null;
  last_checked_at: string | null;
  created_at?: string;
  updated_at?: string;
}

/** Subset of fields that agents are allowed to write. */
export type ChurchUpdatableField = Exclude<
  keyof Church,
  | 'id'
  | 'original_row_id'
  | 'name'
  | 'address'
  | 'city'
  | 'state'
  | 'zip'
  | 'country'
  | 'phone_original'
  | 'email_original'
  | 'website_original'
  | 'created_at'
  | 'updated_at'
>;

export interface Evidence {
  id?: string;
  church_id: string;
  field_name: string;
  proposed_value: string | null;
  evidence_text: string | null;
  source_url: string | null;
  source_type: string | null;
  confidence_score: number | null;
  checked_at?: string;
}

export interface EnrichmentRun {
  id?: string;
  church_id: string | null;
  run_type: string;
  status: RunStatus;
  started_at?: string;
  completed_at?: string | null;
  error_message?: string | null;
  model_used?: string | null;
  tokens_used?: number;
  cost_estimate?: number;
}

export interface ReviewItem {
  id?: string;
  church_id: string;
  field_name: string;
  current_value: string | null;
  proposed_value: string | null;
  confidence_score: number | null;
  evidence_summary: string | null;
  source_urls: string[] | null;
  review_status: ReviewStatus;
  created_at?: string;
  reviewed_at?: string | null;
  reviewer_notes?: string | null;
}

/** A normalized record produced by the spreadsheet importer. */
export interface ImportRecord {
  original_row_id: string;
  name: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string | null;
  phone_original: string | null;
  email_original: string | null;
  website_original: string | null;
  language: string | null;
  network_affiliation: string | null;
  notes: string | null;
}

export interface ChurchFilter {
  state?: string;
  activeStatus?: ActiveStatus;
  missingWebsite?: boolean;
  missingEmail?: boolean;
  missingPastor?: boolean;
  minMmcFit?: number;
  search?: string;
  limit?: number;
  offset?: number;
  needsVerification?: boolean; // last_checked_at is null
}
