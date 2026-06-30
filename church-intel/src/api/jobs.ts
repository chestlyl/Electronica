import { nowIso } from './ids.js';
import type { CipStore } from './store.js';
import type { DiscoveryInput, KnownChurchInput, PipelineRunner } from './pipeline.js';
import type { JobRecord } from './contract.js';

/**
 * In-process async job manager. The API request returns immediately with a job
 * id; the pipeline runs in the background, advancing the job's stage/progress as
 * it goes. Failures are CAUGHT and stored on the job — they never crash the
 * server. (A queue can replace this later; the seam stays the same.)
 */
function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export class JobManager {
  /** In-flight background promises, so tests can deterministically await completion. */
  private inflight = new Map<string, Promise<void>>();

  constructor(private store: CipStore, private pipeline: PipelineRunner) {}

  async startKnownChurch(body: KnownChurchInput): Promise<{ job: JobRecord; church_id: string }> {
    // Create/upsert the church up front so the caller gets a stable church_id now.
    const church = await this.store.upsertChurch({
      name: body.name, city: body.city ?? null, state: body.state ?? null, website: body.url ?? null,
    });
    const job = await this.store.createJob({ input_type: 'known_church', input_payload: body, church_id: church.church_id });
    this.track(job.job_id, this.runKnownChurch(job.job_id, church.church_id, body));
    return { job, church_id: church.church_id };
  }

  async startDiscovery(body: DiscoveryInput): Promise<{ job: JobRecord }> {
    const job = await this.store.createJob({ input_type: 'discovery', input_payload: body, church_id: null });
    this.track(job.job_id, this.runDiscovery(job.job_id, body));
    return { job };
  }

  /** Re-run an existing job (e.g. a failed one) from its original input. */
  async retry(jobId: string): Promise<JobRecord | null> {
    const job = await this.store.getJob(jobId);
    if (!job) return null;
    const reset = await this.store.updateJob(jobId, {
      status: 'queued', stage: 'queued', progress: 0, error: null, completed_at: null, started_at: null, result_payload: null,
    });
    if (job.input_type === 'known_church') {
      const body = job.input_payload as KnownChurchInput;
      let churchId = job.church_id;
      if (!churchId) churchId = (await this.store.upsertChurch({ name: body.name, city: body.city ?? null, state: body.state ?? null, website: body.url ?? null })).church_id;
      this.track(jobId, this.runKnownChurch(jobId, churchId, body));
    } else {
      this.track(jobId, this.runDiscovery(jobId, job.input_payload as DiscoveryInput));
    }
    return reset;
  }

  /** Await all in-flight jobs (used by tests for determinism). */
  async idle(): Promise<void> {
    await Promise.all([...this.inflight.values()]);
  }

  private track(jobId: string, p: Promise<void>): void {
    const wrapped = p.catch(() => {}).finally(() => this.inflight.delete(jobId));
    this.inflight.set(jobId, wrapped);
  }

  private async runKnownChurch(jobId: string, churchId: string, body: KnownChurchInput): Promise<void> {
    try {
      await this.store.updateJob(jobId, { status: 'running', stage: 'discovery', progress: 5, started_at: nowIso() });
      const out = await this.pipeline.runKnownChurch(body, async (stage, progress) => {
        await this.store.updateJob(jobId, { stage, progress });
      });
      await this.store.upsertChurch({ church_id: churchId, ...out.church, last_researched_at: nowIso() });
      const dossier = await this.store.saveDossier({ church_id: churchId, job_id: jobId, sections: out.sections });
      await this.store.updateJob(jobId, {
        status: 'complete', stage: 'complete', progress: 100, completed_at: nowIso(),
        result_payload: { church_id: churchId, dossier_id: dossier.dossier_id },
      });
    } catch (e) {
      await this.store.updateJob(jobId, { status: 'failed', stage: 'failed', error: errMsg(e), completed_at: nowIso() });
    }
  }

  private async runDiscovery(jobId: string, body: DiscoveryInput): Promise<void> {
    try {
      await this.store.updateJob(jobId, { status: 'running', stage: 'discovery', progress: 5, started_at: nowIso() });
      const out = await this.pipeline.runDiscovery(body, async (stage, progress) => {
        await this.store.updateJob(jobId, { stage, progress });
      });
      const churchIds: string[] = [];
      for (const c of out.churches) {
        const row = await this.store.upsertChurch({ ...c, last_researched_at: nowIso() });
        churchIds.push(row.church_id);
      }
      await this.store.updateJob(jobId, {
        status: 'complete', stage: 'complete', progress: 100, completed_at: nowIso(),
        result_payload: { church_ids: churchIds, count: churchIds.length, board: out.board },
      });
    } catch (e) {
      await this.store.updateJob(jobId, { status: 'failed', stage: 'failed', error: errMsg(e), completed_at: nowIso() });
    }
  }
}
