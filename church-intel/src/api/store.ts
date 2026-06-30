import { newId, nowIso } from './ids.js';
import type {
  ChurchRow,
  DossierRecord,
  DossierSections,
  InputType,
  JobRecord,
  JobResult,
  ListChurchesFilter,
} from './contract.js';

/**
 * CipStore — the API's persistence seam. The API layer depends ONLY on this
 * interface, never on the legacy enrichment `Store`. The real implementation is
 * Supabase (`SupabaseCipStore`); the in-memory implementation backs the tests.
 */
export interface CreateJobInput {
  input_type: InputType;
  input_payload: unknown;
  church_id: string | null;
}
export interface UpsertChurchInput extends Partial<ChurchRow> {
  name: string | null;
}
export interface SaveDossierInput {
  church_id: string;
  job_id: string | null;
  sections: DossierSections;
}

export interface ListJobsFilter {
  status?: string;
  input_type?: string;
  limit?: number;
  offset?: number;
}

export interface CipStore {
  createJob(input: CreateJobInput): Promise<JobRecord>;
  getJob(id: string): Promise<JobRecord | null>;
  listJobs(filter: ListJobsFilter): Promise<{ jobs: JobRecord[]; total: number }>;
  updateJob(id: string, patch: Partial<JobRecord>): Promise<JobRecord | null>;
  upsertChurch(input: UpsertChurchInput): Promise<ChurchRow>;
  getChurch(id: string): Promise<ChurchRow | null>;
  listChurches(filter: ListChurchesFilter): Promise<{ churches: ChurchRow[]; total: number }>;
  saveDossier(input: SaveDossierInput): Promise<DossierRecord>;
  getDossierByChurch(churchId: string): Promise<DossierRecord | null>;
}

/** Drop undefined keys so a patch never clobbers an existing value with undefined. */
function defined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
function normWebsite(url: string | null | undefined): string {
  return (url ?? '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '').trim();
}

// ── In-memory implementation (tests + offline) ───────────────────────────────
export class InMemoryCipStore implements CipStore {
  private jobs = new Map<string, JobRecord>();
  private churches = new Map<string, ChurchRow>();
  private dossiers = new Map<string, DossierRecord>(); // keyed by church_id (one current)

  async createJob(input: CreateJobInput): Promise<JobRecord> {
    const now = nowIso();
    const job: JobRecord = {
      job_id: newId('job'),
      status: 'queued', stage: 'queued', progress: 0,
      input_type: input.input_type, input_payload: input.input_payload,
      church_id: input.church_id, result_payload: null, error: null,
      started_at: null, completed_at: null, created_at: now, updated_at: now,
    };
    this.jobs.set(job.job_id, job);
    return { ...job };
  }
  async getJob(id: string): Promise<JobRecord | null> {
    const j = this.jobs.get(id);
    return j ? { ...j } : null;
  }
  async listJobs(filter: ListJobsFilter): Promise<{ jobs: JobRecord[]; total: number }> {
    let rows = [...this.jobs.values()];
    if (filter.status) rows = rows.filter((j) => j.status === filter.status);
    if (filter.input_type) rows = rows.filter((j) => j.input_type === filter.input_type);
    rows.sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''));
    const total = rows.length;
    const offset = filter.offset ?? 0;
    const limit = filter.limit ?? 50;
    return { jobs: rows.slice(offset, offset + limit).map((j) => ({ ...j })), total };
  }
  async updateJob(id: string, patch: Partial<JobRecord>): Promise<JobRecord | null> {
    const j = this.jobs.get(id);
    if (!j) return null;
    const updated: JobRecord = { ...j, ...defined(patch), job_id: j.job_id, updated_at: nowIso() };
    this.jobs.set(id, updated);
    return { ...updated };
  }

  async upsertChurch(input: UpsertChurchInput): Promise<ChurchRow> {
    const now = nowIso();
    let id = input.church_id;
    if (!id) {
      // Dedup so re-researching the same church reuses its row (stable church_id).
      const w = normWebsite(input.website);
      const match = [...this.churches.values()].find((c) =>
        (w && normWebsite(c.website) === w) ||
        (!w && !!input.name && (c.name ?? '').toLowerCase() === input.name.toLowerCase() && (c.state ?? '') === (input.state ?? '')));
      id = match?.church_id;
    }
    const existing = id ? this.churches.get(id) : undefined;
    if (existing) {
      const updated: ChurchRow = { ...existing, ...defined(input), church_id: existing.church_id, updated_at: now };
      this.churches.set(existing.church_id, updated);
      return { ...updated };
    }
    const row: ChurchRow = {
      church_id: id ?? newId('church'),
      name: input.name ?? null, city: input.city ?? null, state: input.state ?? null, website: input.website ?? null,
      verified: input.verified ?? false, denomination: input.denomination ?? null, archetype: input.archetype ?? null,
      lifecycle: input.lifecycle ?? null, awa: input.awa ?? null, attendance_source: input.attendance_source ?? null,
      coverage_percent: input.coverage_percent ?? null, research_confidence: input.research_confidence ?? null,
      engagement_fit: input.engagement_fit ?? null, priority: input.priority ?? null,
      last_researched_at: input.last_researched_at ?? null, created_at: now, updated_at: now,
    };
    this.churches.set(row.church_id, row);
    return { ...row };
  }
  async getChurch(id: string): Promise<ChurchRow | null> {
    const c = this.churches.get(id);
    return c ? { ...c } : null;
  }
  async listChurches(filter: ListChurchesFilter): Promise<{ churches: ChurchRow[]; total: number }> {
    let rows = [...this.churches.values()];
    if (filter.q) { const q = filter.q.toLowerCase(); rows = rows.filter((c) => (c.name ?? '').toLowerCase().includes(q)); }
    if (filter.state) rows = rows.filter((c) => c.state === filter.state);
    if (filter.priority) rows = rows.filter((c) => c.priority === filter.priority);
    if (filter.archetype) rows = rows.filter((c) => c.archetype === filter.archetype);
    if (typeof filter.min_coverage === 'number') rows = rows.filter((c) => (c.coverage_percent ?? 0) >= filter.min_coverage!);
    if (typeof filter.min_confidence === 'number') rows = rows.filter((c) => (c.research_confidence ?? 0) >= filter.min_confidence!);
    rows.sort((a, b) => (b.engagement_fit ?? 0) - (a.engagement_fit ?? 0) || (b.last_researched_at ?? '').localeCompare(a.last_researched_at ?? ''));
    const total = rows.length;
    const offset = filter.offset ?? 0;
    const limit = filter.limit ?? 50;
    return { churches: rows.slice(offset, offset + limit).map((c) => ({ ...c })), total };
  }

  async saveDossier(input: SaveDossierInput): Promise<DossierRecord> {
    const rec: DossierRecord = {
      dossier_id: newId('dossier'), church_id: input.church_id, job_id: input.job_id,
      created_at: nowIso(), ...input.sections,
    };
    this.dossiers.set(input.church_id, rec);
    return { ...rec };
  }
  async getDossierByChurch(churchId: string): Promise<DossierRecord | null> {
    const d = this.dossiers.get(churchId);
    return d ? { ...d } : null;
  }
}
