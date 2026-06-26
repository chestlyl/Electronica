import { supabase } from '../db/supabase.js';
import { newId, nowIso } from './ids.js';
import type {
  ChurchRow,
  DossierRecord,
  JobRecord,
  ListChurchesFilter,
} from './contract.js';
import type {
  CipStore,
  CreateJobInput,
  SaveDossierInput,
  UpsertChurchInput,
} from './store.js';

/**
 * Supabase-backed CipStore — the production system of record. Uses the new
 * `cip_*` tables (see supabase/migrations/0003_cip_api.sql), kept separate from
 * the legacy enrichment tables so this seam never clobbers the spreadsheet
 * repository. Not exercised by the offline test suite (needs live credentials);
 * the in-memory store backs the tests.
 */
function normWebsite(url: string | null | undefined): string {
  return (url ?? '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '').trim();
}
function defined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function jobFromRow(r: any): JobRecord {
  return {
    job_id: r.id, status: r.status, stage: r.stage, progress: r.progress,
    input_type: r.input_type, input_payload: r.input_payload, church_id: r.church_id,
    result_payload: r.result_payload, error: r.error, started_at: r.started_at,
    completed_at: r.completed_at, created_at: r.created_at, updated_at: r.updated_at,
  };
}
function churchFromRow(r: any): ChurchRow {
  return {
    church_id: r.id, name: r.name, city: r.city, state: r.state, website: r.website,
    verified: !!r.verified, denomination: r.denomination, archetype: r.archetype, lifecycle: r.lifecycle,
    awa: r.awa, attendance_source: r.attendance_source, coverage_percent: r.coverage_percent,
    research_confidence: r.research_confidence, engagement_fit: r.engagement_fit, priority: r.priority,
    last_researched_at: r.last_researched_at, created_at: r.created_at, updated_at: r.updated_at,
  };
}
function dossierFromRow(r: any): DossierRecord {
  return {
    dossier_id: r.id, church_id: r.church_id, job_id: r.job_id, created_at: r.created_at,
    identity: r.identity_json ?? {}, coverage: r.coverage_json ?? {}, size: r.size_json ?? {},
    leadership_access: r.leadership_json ?? [], staff_emails: r.staff_emails_json ?? {},
    technology_stack: r.technology_stack_json ?? [], strategic_signals: r.strategic_signals_json ?? [],
    strategic_scores: r.strategic_scores_json ?? {}, recommendations: r.recommendations_json ?? {},
    outreach_intelligence: r.outreach_json ?? {}, raw_evidence: r.raw_evidence_json ?? [],
    markdown: r.markdown ?? '',
  };
}

export class SupabaseCipStore implements CipStore {
  private get db() { return supabase(); }

  async createJob(input: CreateJobInput): Promise<JobRecord> {
    const now = nowIso();
    const row = {
      id: newId('job'), status: 'queued', stage: 'queued', progress: 0,
      input_type: input.input_type, input_payload: input.input_payload, church_id: input.church_id,
      result_payload: null, error: null, started_at: null, completed_at: null, created_at: now, updated_at: now,
    };
    const { data, error } = await this.db.from('cip_research_jobs').insert(row).select('*').single();
    if (error) throw error;
    return jobFromRow(data);
  }
  async getJob(id: string): Promise<JobRecord | null> {
    const { data, error } = await this.db.from('cip_research_jobs').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    return data ? jobFromRow(data) : null;
  }
  async updateJob(id: string, patch: Partial<JobRecord>): Promise<JobRecord | null> {
    const { job_id, ...rest } = patch; // never rewrite the id
    void job_id;
    const { data, error } = await this.db.from('cip_research_jobs')
      .update({ ...defined(rest), updated_at: nowIso() }).eq('id', id).select('*').maybeSingle();
    if (error) throw error;
    return data ? jobFromRow(data) : null;
  }

  async upsertChurch(input: UpsertChurchInput): Promise<ChurchRow> {
    const now = nowIso();
    let id = input.church_id;
    if (!id) {
      const w = normWebsite(input.website);
      if (w) {
        const { data } = await this.db.from('cip_churches').select('id, website');
        id = (data ?? []).find((c: any) => normWebsite(c.website) === w)?.id;
      } else if (input.name) {
        const { data } = await this.db.from('cip_churches').select('id, name, state')
          .ilike('name', input.name).eq('state', input.state ?? '');
        id = (data ?? [])[0]?.id;
      }
    }
    const fields = defined({
      name: input.name, city: input.city, state: input.state, website: input.website, verified: input.verified,
      denomination: input.denomination, archetype: input.archetype, lifecycle: input.lifecycle, awa: input.awa,
      attendance_source: input.attendance_source, coverage_percent: input.coverage_percent,
      research_confidence: input.research_confidence, engagement_fit: input.engagement_fit, priority: input.priority,
      last_researched_at: input.last_researched_at,
    });
    if (id) {
      const { data, error } = await this.db.from('cip_churches')
        .update({ ...fields, updated_at: now }).eq('id', id).select('*').single();
      if (error) throw error;
      return churchFromRow(data);
    }
    const { data, error } = await this.db.from('cip_churches')
      .insert({ id: newId('church'), verified: false, ...fields, created_at: now, updated_at: now })
      .select('*').single();
    if (error) throw error;
    return churchFromRow(data);
  }
  async getChurch(id: string): Promise<ChurchRow | null> {
    const { data, error } = await this.db.from('cip_churches').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    return data ? churchFromRow(data) : null;
  }
  async listChurches(filter: ListChurchesFilter): Promise<{ churches: ChurchRow[]; total: number }> {
    let q = this.db.from('cip_churches').select('*', { count: 'exact' });
    if (filter.q) q = q.ilike('name', `%${filter.q}%`);
    if (filter.state) q = q.eq('state', filter.state);
    if (filter.priority) q = q.eq('priority', filter.priority);
    if (filter.archetype) q = q.eq('archetype', filter.archetype);
    if (typeof filter.min_coverage === 'number') q = q.gte('coverage_percent', filter.min_coverage);
    if (typeof filter.min_confidence === 'number') q = q.gte('research_confidence', filter.min_confidence);
    q = q.order('engagement_fit', { ascending: false, nullsFirst: false });
    const offset = filter.offset ?? 0;
    q = q.range(offset, offset + (filter.limit ?? 50) - 1);
    const { data, error, count } = await q;
    if (error) throw error;
    return { churches: (data ?? []).map(churchFromRow), total: count ?? (data?.length ?? 0) };
  }

  async saveDossier(input: SaveDossierInput): Promise<DossierRecord> {
    const s = input.sections;
    const payload = {
      church_id: input.church_id, job_id: input.job_id,
      identity_json: s.identity, coverage_json: s.coverage, size_json: s.size, leadership_json: s.leadership_access,
      staff_emails_json: s.staff_emails, technology_stack_json: s.technology_stack, strategic_signals_json: s.strategic_signals,
      strategic_scores_json: s.strategic_scores, recommendations_json: s.recommendations, outreach_json: s.outreach_intelligence,
      raw_evidence_json: s.raw_evidence, markdown: s.markdown,
    };
    // One current dossier per church: update in place if present, else insert.
    const { data: existing } = await this.db.from('cip_dossiers').select('id').eq('church_id', input.church_id).maybeSingle();
    if (existing) {
      const { data, error } = await this.db.from('cip_dossiers').update(payload).eq('id', existing.id).select('*').single();
      if (error) throw error;
      return dossierFromRow(data);
    }
    const { data, error } = await this.db.from('cip_dossiers')
      .insert({ id: newId('dossier'), created_at: nowIso(), ...payload }).select('*').single();
    if (error) throw error;
    return dossierFromRow(data);
  }
  async getDossierByChurch(churchId: string): Promise<DossierRecord | null> {
    const { data, error } = await this.db.from('cip_dossiers').select('*').eq('church_id', churchId).maybeSingle();
    if (error) throw error;
    return data ? dossierFromRow(data) : null;
  }
}
