import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import { JobManager } from './jobs.js';
import type { CipStore } from './store.js';
import type { PipelineRunner } from './pipeline.js';
import type {
  DossierRecord,
  DossierResponse,
  JobRecord,
  JobStatusResponse,
  ListChurchesFilter,
} from './contract.js';

/**
 * createApp — builds the CIP API as an injectable factory so tests can supply an
 * in-memory store + a mock pipeline. The real entrypoint (index.ts) wires the
 * Supabase store + the real research pipeline.
 *
 * Security: every route (except /health) requires `Authorization: Bearer
 * <CIP_API_KEY>`. The backend owns all other secrets — Base44 holds only this
 * bearer token and never talks to Claude/Supabase/Places directly.
 */
export interface CreateAppDeps {
  store: CipStore;
  pipeline: PipelineRunner;
  apiKey: string;
}
export interface CreatedApp {
  app: Express;
  jobs: JobManager;
}

const asyncHandler = (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => { fn(req, res).catch(next); };

function toJobStatusResponse(j: JobRecord): JobStatusResponse {
  return {
    job_id: j.job_id, status: j.status, stage: j.stage, progress: j.progress,
    started_at: j.started_at, completed_at: j.completed_at, error: j.error,
    church_id: j.church_id, result: j.result_payload,
  };
}
function toDossierResponse(d: DossierRecord): DossierResponse {
  return {
    church_id: d.church_id, dossier_id: d.dossier_id,
    identity: d.identity, coverage: d.coverage, size: d.size, leadership_access: d.leadership_access,
    staff_emails: d.staff_emails, technology_stack: d.technology_stack, strategic_signals: d.strategic_signals,
    strategic_scores: d.strategic_scores, recommendations: d.recommendations, outreach_intelligence: d.outreach_intelligence,
    raw_evidence: d.raw_evidence, markdown: d.markdown,
  };
}
function num(v: unknown): number | undefined {
  const n = Number(v);
  return v != null && v !== '' && Number.isFinite(n) ? n : undefined;
}
function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

export function createApp(deps: CreateAppDeps): CreatedApp {
  const jobs = new JobManager(deps.store, deps.pipeline);
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  // Liveness — public (exposes no secrets, no data).
  app.get('/health', (_req, res) => res.json({ ok: true }));

  // ── auth: Bearer CIP_API_KEY on everything below ───────────────────────────
  app.use((req: Request, res: Response, next: NextFunction) => {
    const m = (req.header('authorization') ?? '').match(/^Bearer\s+(.+)$/i);
    if (!deps.apiKey || !m || m[1] !== deps.apiKey) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    next();
  });

  // 1. Start known-church research.
  app.post('/research/known-church', asyncHandler(async (req, res) => {
    const b = req.body ?? {};
    if (!str(b.name)) return res.status(400).json({ error: 'name is required' });
    const { job, church_id } = await jobs.startKnownChurch({
      name: b.name, city: b.city ?? null, state: b.state ?? null, url: b.url ?? null,
    });
    res.json({ job_id: job.job_id, church_id, status: job.status, message: 'Known church research started' });
  }));

  // 2. Start area/metro discovery.
  app.post('/research/discovery-query', asyncHandler(async (req, res) => {
    const b = req.body ?? {};
    if (!str(b.metro)) return res.status(400).json({ error: 'metro is required' });
    const { job } = await jobs.startDiscovery({
      metro: b.metro, state: b.state ?? null, limit: num(b.limit), filters: b.filters ?? {},
    });
    res.json({ job_id: job.job_id, status: job.status, message: 'Discovery job started' });
  }));

  // 3. List jobs (Research Queue).
  app.get('/research/jobs', asyncHandler(async (req, res) => {
    const q = req.query;
    const { jobs: rows, total } = await deps.store.listJobs({
      status: str(q.status), input_type: str(q.input_type), limit: num(q.limit) ?? 50, offset: num(q.offset) ?? 0,
    });
    res.json({ jobs: rows.map(toJobStatusResponse), total });
  }));

  // 3b. Poll a single job's status.
  app.get('/research/jobs/:id', asyncHandler(async (req, res) => {
    const job = await deps.store.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'job not found' });
    res.json(toJobStatusResponse(job));
  }));

  // 3c. Retry a job (e.g. a failed one) from its original input.
  app.post('/research/jobs/:id/retry', asyncHandler(async (req, res) => {
    const job = await jobs.retry(req.params.id);
    if (!job) return res.status(404).json({ error: 'job not found' });
    res.json(toJobStatusResponse(job));
  }));

  // 4. List the researched church repository.
  app.get('/churches', asyncHandler(async (req, res) => {
    const q = req.query;
    const filter: ListChurchesFilter = {
      q: str(q.q), state: str(q.state), priority: str(q.priority), archetype: str(q.archetype),
      min_coverage: num(q.min_coverage), min_confidence: num(q.min_confidence),
      limit: num(q.limit) ?? 50, offset: num(q.offset) ?? 0,
    };
    const { churches, total } = await deps.store.listChurches(filter);
    res.json({ churches, total });
  }));

  // 4b. A single church record.
  app.get('/churches/:id', asyncHandler(async (req, res) => {
    const church = await deps.store.getChurch(req.params.id);
    if (!church) return res.status(404).json({ error: 'church not found' });
    res.json(church);
  }));

  // 5. Open a completed dossier.
  app.get('/churches/:id/dossier', asyncHandler(async (req, res) => {
    const dossier = await deps.store.getDossierByChurch(req.params.id);
    if (!dossier) return res.status(404).json({ error: 'dossier not found' });
    res.json(toDossierResponse(dossier));
  }));

  // 6. Dashboard aggregates.
  app.get('/dashboard/stats', asyncHandler(async (_req, res) => {
    const [{ churches, total }, jobsAll] = await Promise.all([
      deps.store.listChurches({ limit: 100000 }),
      deps.store.listJobs({ limit: 100000 }),
    ]);
    const byStatus = (s: string) => jobsAll.jobs.filter((j) => j.status === s).length;
    const fits = churches.map((c) => c.engagement_fit).filter((v): v is number => typeof v === 'number');
    const tally = (key: 'archetype' | 'state') => {
      const m = new Map<string, number>();
      for (const c of churches) { const k = (c[key] ?? 'Unknown') as string; m.set(k, (m.get(k) ?? 0) + 1); }
      return [...m.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
    };
    const recent = [...churches].sort((a, b) => (b.last_researched_at ?? '').localeCompare(a.last_researched_at ?? ''));
    res.json({
      total_churches: total,
      jobs_queued: byStatus('queued'),
      jobs_running: byStatus('running'),
      jobs_completed: byStatus('complete'),
      jobs_failed: byStatus('failed'),
      avg_engagement_fit: fits.length ? Math.round(fits.reduce((a, b) => a + b, 0) / fits.length) : null,
      recent_dossiers: recent.slice(0, 8),
      top_opportunities: [...churches].sort((a, b) => (b.engagement_fit ?? 0) - (a.engagement_fit ?? 0)).slice(0, 8),
      churches_by_archetype: tally('archetype'),
      churches_by_state: tally('state'),
      recent_activity: jobsAll.jobs.slice(0, 12).map(toJobStatusResponse),
    });
  }));

  // Catch-all error handler — a failed request must never crash the server.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: err instanceof Error ? err.message : 'internal error' });
  });

  return { app, jobs };
}
