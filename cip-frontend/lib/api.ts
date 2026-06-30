import type { ChurchFilters, ChurchRow, DashboardStats, Dossier, Job } from './types';

/** Client-side fetchers. All requests go through the Next.js proxy (/api/cip/*),
 *  which injects the CIP bearer key server-side. */
async function j<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/cip/${path}`, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
  return data as T;
}

function qs(params: Record<string, unknown> = {}): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

export const api = {
  dashboard: () => j<DashboardStats>('dashboard/stats'),

  churches: (f: ChurchFilters = {}) => j<{ churches: ChurchRow[]; total: number }>(`churches${qs(f as Record<string, unknown>)}`),
  church: (id: string) => j<ChurchRow>(`churches/${id}`),
  dossier: (id: string) => j<Dossier>(`churches/${id}/dossier`),

  jobs: (f: { status?: string; input_type?: string; limit?: number } = {}) => j<{ jobs: Job[]; total: number }>(`research/jobs${qs(f)}`),
  job: (id: string) => j<Job>(`research/jobs/${id}`),
  retryJob: (id: string) => j<Job>(`research/jobs/${id}/retry`, { method: 'POST' }),

  startKnownChurch: (body: { name: string; url?: string; city?: string; state?: string }) =>
    j<{ job_id: string; church_id: string; status: string; message: string }>('research/known-church', { method: 'POST', body: JSON.stringify(body) }),
  startDiscovery: (body: { metro: string; state?: string; limit?: number; filters?: Record<string, unknown> }) =>
    j<{ job_id: string; status: string; message: string }>('research/discovery-query', { method: 'POST', body: JSON.stringify(body) }),
};
