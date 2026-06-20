import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config, assertSupabaseConfigured } from '../config.js';
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

let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  assertSupabaseConfigured();
  if (!client) {
    client = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
      auth: { persistSession: false },
    });
  }
  return client;
}

function applyFilter(q: any, f: ChurchFilter) {
  if (f.state) q = q.eq('state', f.state);
  if (f.activeStatus) q = q.eq('active_status', f.activeStatus);
  if (f.missingWebsite) q = q.is('website_verified', null);
  if (f.missingEmail) q = q.is('email_verified', null);
  if (f.missingPastor) q = q.is('lead_pastor', null);
  if (f.needsVerification) q = q.is('last_checked_at', null);
  if (typeof f.minMmcFit === 'number') q = q.gte('mmc_fit_score', f.minMmcFit);
  if (f.search) q = q.ilike('name', `%${f.search}%`);
  return q;
}

export class SupabaseStore implements Store {
  private db = supabase();

  async upsertImportRecord(rec: ImportRecord): Promise<UpsertResult> {
    // De-dupe on the stable original_row_id.
    const { data: existing } = await this.db
      .from('churches')
      .select('id')
      .eq('original_row_id', rec.original_row_id)
      .maybeSingle();
    if (existing) return { id: existing.id, inserted: false };

    const { data, error } = await this.db
      .from('churches')
      .insert(rec)
      .select('id')
      .single();
    if (error) throw error;
    return { id: data.id, inserted: true };
  }

  async getChurch(id: string): Promise<Church | null> {
    const { data, error } = await this.db
      .from('churches')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return (data as Church) ?? null;
  }

  async getChurchByRowId(rowId: string): Promise<Church | null> {
    const { data, error } = await this.db
      .from('churches')
      .select('*')
      .eq('original_row_id', rowId)
      .maybeSingle();
    if (error) throw error;
    return (data as Church) ?? null;
  }

  async listChurches(f: ChurchFilter): Promise<Church[]> {
    let q = this.db.from('churches').select('*');
    q = applyFilter(q, f);
    q = q.order('mmc_fit_score', { ascending: false, nullsFirst: false });
    if (f.limit) q = q.range(f.offset ?? 0, (f.offset ?? 0) + f.limit - 1);
    const { data, error } = await q;
    if (error) throw error;
    return (data as Church[]) ?? [];
  }

  async countChurches(f: ChurchFilter): Promise<number> {
    let q = this.db.from('churches').select('id', { count: 'exact', head: true });
    q = applyFilter(q, f);
    const { count, error } = await q;
    if (error) throw error;
    return count ?? 0;
  }

  async updateChurch(id: string, fields: Partial<Church>): Promise<void> {
    const { error } = await this.db.from('churches').update(fields).eq('id', id);
    if (error) throw error;
  }

  async insertEvidence(ev: Evidence): Promise<string> {
    const { data, error } = await this.db
      .from('church_evidence')
      .insert(ev)
      .select('id')
      .single();
    if (error) throw error;
    return data.id;
  }

  async listEvidence(churchId: string, fieldName?: string): Promise<Evidence[]> {
    let q = this.db
      .from('church_evidence')
      .select('*')
      .eq('church_id', churchId)
      .order('checked_at', { ascending: false });
    if (fieldName) q = q.eq('field_name', fieldName);
    const { data, error } = await q;
    if (error) throw error;
    return (data as Evidence[]) ?? [];
  }

  async createRun(run: EnrichmentRun): Promise<string> {
    const { data, error } = await this.db
      .from('enrichment_runs')
      .insert({ ...run, status: run.status ?? 'running' })
      .select('id')
      .single();
    if (error) throw error;
    return data.id;
  }

  async completeRun(
    id: string,
    patch: {
      status: RunStatus;
      error_message?: string | null;
      tokens_used?: number;
      cost_estimate?: number;
      model_used?: string | null;
    },
  ): Promise<void> {
    const { error } = await this.db
      .from('enrichment_runs')
      .update({ ...patch, completed_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
  }

  async enqueueReview(item: ReviewItem): Promise<string> {
    // Upsert on the partial-unique (church_id, field_name) pending index.
    const { data, error } = await this.db
      .from('review_queue')
      .upsert(item, { onConflict: 'church_id,field_name', ignoreDuplicates: false })
      .select('id')
      .single();
    if (error) {
      // If conflict target isn't matched (already non-pending), fall back to insert.
      const ins = await this.db.from('review_queue').insert(item).select('id').single();
      if (ins.error) throw ins.error;
      return ins.data.id;
    }
    return data.id;
  }

  async listReviewQueue(status?: ReviewStatus): Promise<ReviewItem[]> {
    let q = this.db
      .from('review_queue')
      .select('*')
      .order('confidence_score', { ascending: false, nullsFirst: false });
    if (status) q = q.eq('review_status', status);
    const { data, error } = await q;
    if (error) throw error;
    return (data as ReviewItem[]) ?? [];
  }

  async getReviewItem(id: string): Promise<ReviewItem | null> {
    const { data, error } = await this.db
      .from('review_queue')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return (data as ReviewItem) ?? null;
  }

  async updateReview(
    id: string,
    patch: { review_status: ReviewStatus; reviewer_notes?: string | null },
  ): Promise<void> {
    const { error } = await this.db
      .from('review_queue')
      .update({ ...patch, reviewed_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
  }
}
