import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  Church,
  ChurchFilter,
  Evidence,
  EnrichmentRun,
  ImportRecord,
  ReviewItem,
  ReviewStatus,
  RunStatus,
} from '../types.js';
import type { Store, UpsertResult } from './store.js';

interface Db {
  churches: Church[];
  evidence: Evidence[];
  runs: EnrichmentRun[];
  reviews: ReviewItem[];
}

/**
 * File-backed store implementing the same interface as SupabaseStore.
 * Used by the offline demo so the full pipeline runs without credentials.
 */
export class JsonStore implements Store {
  private db: Db;
  constructor(private path: string) {
    if (existsSync(path)) {
      this.db = JSON.parse(readFileSync(path, 'utf8'));
    } else {
      this.db = { churches: [], evidence: [], runs: [], reviews: [] };
    }
  }

  private flush() {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(this.db, null, 2));
  }

  private blankChurch(rec: ImportRecord): Church {
    const now = new Date().toISOString();
    return {
      id: randomUUID(),
      original_row_id: rec.original_row_id,
      name: rec.name,
      address: rec.address,
      city: rec.city,
      state: rec.state,
      zip: rec.zip,
      country: rec.country,
      phone_original: rec.phone_original,
      email_original: rec.email_original,
      website_original: rec.website_original,
      phone_verified: null,
      email_verified: null,
      website_verified: null,
      active_status: null,
      lead_pastor: null,
      denomination: null,
      network_affiliation: rec.network_affiliation,
      language: rec.language,
      staff_count: null,
      campus_count: null,
      weekend_services_count: null,
      attendance_estimate: null,
      attendance_min: null,
      attendance_max: null,
      attendance_confidence: null,
      attendance_confidence_tier: null,
      influence_score: null,
      mmc_fit_score: null,
      multiplication_score: null,
      church_planting_activity: null,
      leadership_development_score: null,
      digital_reach_score: null,
      verification_score: null,
      review_status: 'unreviewed',
      notes: rec.notes,
      last_checked_at: null,
      created_at: now,
      updated_at: now,
    };
  }

  async upsertImportRecord(rec: ImportRecord): Promise<UpsertResult> {
    const existing = this.db.churches.find((c) => c.original_row_id === rec.original_row_id);
    if (existing) return { id: existing.id, inserted: false };
    const c = this.blankChurch(rec);
    this.db.churches.push(c);
    this.flush();
    return { id: c.id, inserted: true };
  }

  async getChurch(id: string): Promise<Church | null> {
    return this.db.churches.find((c) => c.id === id) ?? null;
  }
  async getChurchByRowId(rowId: string): Promise<Church | null> {
    return this.db.churches.find((c) => c.original_row_id === rowId) ?? null;
  }

  async listChurches(f: ChurchFilter): Promise<Church[]> {
    let rows = this.db.churches.filter((c) => {
      if (f.state && c.state !== f.state) return false;
      if (f.activeStatus && c.active_status !== f.activeStatus) return false;
      if (f.missingWebsite && c.website_verified) return false;
      if (f.missingEmail && c.email_verified) return false;
      if (f.missingPastor && c.lead_pastor) return false;
      if (f.needsVerification && c.last_checked_at) return false;
      if (typeof f.minMmcFit === 'number' && (c.mmc_fit_score ?? -1) < f.minMmcFit) return false;
      if (f.search && !(c.name ?? '').toLowerCase().includes(f.search.toLowerCase())) return false;
      return true;
    });
    rows = rows.sort((a, b) => (b.mmc_fit_score ?? -1) - (a.mmc_fit_score ?? -1));
    const off = f.offset ?? 0;
    return f.limit ? rows.slice(off, off + f.limit) : rows;
  }

  async countChurches(f: ChurchFilter): Promise<number> {
    return (await this.listChurches({ ...f, limit: undefined, offset: undefined })).length;
  }

  async updateChurch(id: string, fields: Partial<Church>): Promise<void> {
    const c = this.db.churches.find((x) => x.id === id);
    if (!c) throw new Error(`church ${id} not found`);
    Object.assign(c, fields, { updated_at: new Date().toISOString() });
    this.flush();
  }

  async insertEvidence(ev: Evidence): Promise<string> {
    const id = randomUUID();
    this.db.evidence.push({ ...ev, id, checked_at: ev.checked_at ?? new Date().toISOString() });
    this.flush();
    return id;
  }
  async listEvidence(churchId: string, fieldName?: string): Promise<Evidence[]> {
    return this.db.evidence
      .filter((e) => e.church_id === churchId && (!fieldName || e.field_name === fieldName))
      .sort((a, b) => (b.checked_at ?? '').localeCompare(a.checked_at ?? ''));
  }

  async createRun(run: EnrichmentRun): Promise<string> {
    const id = randomUUID();
    this.db.runs.push({ ...run, id, started_at: new Date().toISOString() });
    this.flush();
    return id;
  }
  async completeRun(id: string, patch: any): Promise<void> {
    const r = this.db.runs.find((x) => x.id === id);
    if (r) Object.assign(r, patch, { completed_at: new Date().toISOString() });
    this.flush();
  }

  async enqueueReview(item: ReviewItem): Promise<string> {
    const dup = this.db.reviews.find(
      (r) => r.church_id === item.church_id && r.field_name === item.field_name && r.review_status === 'pending',
    );
    if (dup) {
      Object.assign(dup, item);
      this.flush();
      return dup.id!;
    }
    const id = randomUUID();
    this.db.reviews.push({ ...item, id, created_at: new Date().toISOString() });
    this.flush();
    return id;
  }
  async listReviewQueue(status?: ReviewStatus): Promise<ReviewItem[]> {
    return this.db.reviews
      .filter((r) => !status || r.review_status === status)
      .sort((a, b) => (b.confidence_score ?? -1) - (a.confidence_score ?? -1));
  }
  async getReviewItem(id: string): Promise<ReviewItem | null> {
    return this.db.reviews.find((r) => r.id === id) ?? null;
  }
  async updateReview(id: string, patch: any): Promise<void> {
    const r = this.db.reviews.find((x) => x.id === id);
    if (r) Object.assign(r, patch, { reviewed_at: new Date().toISOString() });
    this.flush();
  }
}
