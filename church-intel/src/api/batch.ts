import { JobManager } from './jobs.js';
import type { CipStore } from './store.js';
import type { KnownChurchInput, PipelineRunner } from './pipeline.js';

/**
 * Batch research → persist to the CIP store (Supabase in production). Feeds the
 * church repository from a list of known churches. Reuses the JobManager so each
 * church runs the same pipeline and gets persisted (church + dossier + job).
 */
export interface BatchChurch {
  name: string;
  url?: string | null;
  city?: string | null;
  state?: string | null;
}
export interface BatchResult {
  name: string;
  church_id: string | null;
  status: string;
  error: string | null;
}
export interface BatchProgress {
  done: number;
  total: number;
  name: string;
  status: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Parse a churches list from JSON (array) or CSV (header row). */
export function parseChurchList(content: string, filename = ''): BatchChurch[] {
  const trimmed = content.trim();
  if (filename.endsWith('.json') || trimmed.startsWith('[') || trimmed.startsWith('{')) {
    const data = JSON.parse(trimmed);
    const arr = Array.isArray(data) ? data : (data.churches ?? []);
    return arr.map(normalize).filter((c: BatchChurch) => c.name);
  }
  // CSV
  const lines = trimmed.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const header = splitCsv(lines[0]).map((h) => h.trim().toLowerCase());
  const idx = (names: string[]) => header.findIndex((h) => names.includes(h));
  const ni = idx(['name', 'church', 'church name', 'church_name']);
  const ui = idx(['url', 'website', 'site', 'web']);
  const ci = idx(['city', 'town']);
  const si = idx(['state', 'st']);
  const out: BatchChurch[] = [];
  for (const line of lines.slice(1)) {
    const cells = splitCsv(line);
    const name = (ni >= 0 ? cells[ni] : cells[0] ?? '').trim();
    if (!name) continue;
    out.push({ name, url: ui >= 0 ? cells[ui]?.trim() || null : null, city: ci >= 0 ? cells[ci]?.trim() || null : null, state: si >= 0 ? cells[si]?.trim() || null : null });
  }
  return out;
}
function normalize(o: Record<string, unknown>): BatchChurch {
  const s = (v: unknown) => (v == null ? null : String(v).trim() || null);
  return { name: String(o.name ?? o.church ?? '').trim(), url: s(o.url ?? o.website ?? o.site), city: s(o.city), state: s(o.state) };
}
function splitCsv(line: string): string[] {
  const out: string[] = []; let cur = ''; let q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === ',' && !q) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.replace(/^"|"$/g, ''));
}

/**
 * Research each church with bounded concurrency, persisting via the store.
 * A worker starts a job then polls it to completion before taking the next, so
 * at most `concurrency` pipelines run at once. Never throws on a single failure.
 */
export async function researchBatch(
  store: CipStore,
  pipeline: PipelineRunner,
  churches: BatchChurch[],
  opts: { concurrency?: number; onProgress?: (p: BatchProgress) => void; pollMs?: number } = {},
): Promise<BatchResult[]> {
  const jobs = new JobManager(store, pipeline);
  const conc = Math.max(1, opts.concurrency ?? 2);
  const pollMs = opts.pollMs ?? 250;
  const results: BatchResult[] = [];
  let next = 0;

  async function worker() {
    while (next < churches.length) {
      const ch = churches[next++];
      const body: KnownChurchInput = { name: ch.name, city: ch.city ?? null, state: ch.state ?? null, url: ch.url ?? null };
      try {
        const { job, church_id } = await jobs.startKnownChurch(body);
        let jr = await store.getJob(job.job_id);
        while (jr && (jr.status === 'queued' || jr.status === 'running')) { await sleep(pollMs); jr = await store.getJob(job.job_id); }
        const r: BatchResult = { name: ch.name, church_id, status: jr?.status ?? 'unknown', error: jr?.error ?? null };
        results.push(r);
        opts.onProgress?.({ done: results.length, total: churches.length, name: ch.name, status: r.status });
      } catch (e) {
        results.push({ name: ch.name, church_id: null, status: 'failed', error: e instanceof Error ? e.message : String(e) });
        opts.onProgress?.({ done: results.length, total: churches.length, name: ch.name, status: 'failed' });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(conc, churches.length || 1) }, worker));
  return results;
}
