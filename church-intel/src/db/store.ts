import type {
  Church,
  ChurchFilter,
  Evidence,
  EnrichmentRun,
  ImportRecord,
  ResearchConflict,
  ResearchDossier,
  ReviewItem,
  ReviewStatus,
  RunStatus,
} from '../types.js';

export interface UpsertResult {
  id: string;
  inserted: boolean;
}

/**
 * Storage abstraction. The real implementation is Supabase (source of truth);
 * a JSON-file implementation backs the offline demo and tests.
 */
export interface Store {
  // churches
  upsertImportRecord(rec: ImportRecord): Promise<UpsertResult>;
  getChurch(id: string): Promise<Church | null>;
  getChurchByRowId(rowId: string): Promise<Church | null>;
  listChurches(filter: ChurchFilter): Promise<Church[]>;
  countChurches(filter: ChurchFilter): Promise<number>;
  updateChurch(id: string, fields: Partial<Church>): Promise<void>;

  // evidence
  insertEvidence(ev: Evidence): Promise<string>;
  listEvidence(churchId: string, fieldName?: string): Promise<Evidence[]>;

  // runs
  createRun(run: EnrichmentRun): Promise<string>;
  completeRun(
    id: string,
    patch: {
      status: RunStatus;
      error_message?: string | null;
      tokens_used?: number;
      cost_estimate?: number;
      model_used?: string | null;
    },
  ): Promise<void>;

  // review queue
  enqueueReview(item: ReviewItem): Promise<string>;
  listReviewQueue(status?: ReviewStatus): Promise<ReviewItem[]>;
  getReviewItem(id: string): Promise<ReviewItem | null>;
  updateReview(
    id: string,
    patch: { review_status: ReviewStatus; reviewer_notes?: string | null },
  ): Promise<void>;

  // research dossiers (one current per church) + conflicts
  upsertDossier(dossier: ResearchDossier): Promise<string>;
  getDossier(churchId: string): Promise<ResearchDossier | null>;
  addConflict(conflict: ResearchConflict): Promise<string>;
  listConflicts(churchId: string): Promise<ResearchConflict[]>;
}
