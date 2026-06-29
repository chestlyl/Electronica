import { config } from '../config.js';
import { logger } from '../lib/logger.js';

/**
 * Minimal REST client for the Base44 entity API (the front-end app's data store).
 * The agent PUBLISHES dossier results into these entities; the Base44 UI reads
 * its own records. Auth is the documented `api_key` header. No SDK dependency —
 * plain fetch so it stays testable with a mock.
 *
 * Base URL + keys come from .env (BASE44_APP_ID / BASE44_API_KEY / BASE44_BASE_URL).
 */
export interface Base44Options {
  appId?: string;
  apiKey?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;        // injectable for tests
}

export interface ListQuery {
  q?: Record<string, unknown>;
  limit?: number;
  skip?: number;
  sort_by?: string;
}

const TIMEOUT_MS = 30000;

export class Base44Client {
  readonly appId: string;
  private readonly apiKey: string;
  readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: Base44Options = {}) {
    this.appId = opts.appId ?? config.base44.appId;
    this.apiKey = opts.apiKey ?? config.base44.apiKey;
    this.baseUrl = (opts.baseUrl ?? config.base44.baseUrl).replace(/\/+$/, '');
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  isConfigured(): boolean {
    return !!this.apiKey && !!this.baseUrl;
  }

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: { 'api_key': this.apiKey, 'content-type': 'application/json', accept: 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Base44 ${method} ${path} → ${res.status} ${detail}`.slice(0, 400));
    }
    const text = await res.text();
    return (text ? JSON.parse(text) : null) as T;
  }

  async list<T = Record<string, unknown>>(entity: string, query: ListQuery = {}): Promise<T[]> {
    const p = new URLSearchParams();
    if (query.q) p.set('q', JSON.stringify(query.q));
    if (query.limit != null) p.set('limit', String(query.limit));
    if (query.skip != null) p.set('skip', String(query.skip));
    if (query.sort_by) p.set('sort_by', query.sort_by);
    const qs = p.toString();
    const out = await this.req<T[] | { records?: T[] }>('GET', `/entities/${entity}${qs ? `?${qs}` : ''}`);
    return Array.isArray(out) ? out : (out?.records ?? []);
  }

  async create<T = Record<string, unknown>>(entity: string, record: Record<string, unknown>): Promise<T> {
    return this.req<T>('POST', `/entities/${entity}`, record);
  }

  async bulkCreate<T = Record<string, unknown>>(entity: string, records: Record<string, unknown>[]): Promise<T[]> {
    if (!records.length) return [];
    return this.req<T[]>('POST', `/entities/${entity}/bulk`, records);
  }

  async update<T = Record<string, unknown>>(entity: string, id: string, fields: Record<string, unknown>): Promise<T> {
    return this.req<T>('PUT', `/entities/${entity}/${id}`, fields);
  }

  /** Delete records matching a NON-EMPTY query. Guarded: an empty filter would
   *  wipe the whole entity, so we refuse it. */
  async deleteMany(entity: string, query: Record<string, unknown>): Promise<void> {
    if (!query || Object.keys(query).length === 0) {
      throw new Error(`Base44 deleteMany on ${entity} refused: empty query would delete ALL records`);
    }
    await this.req('DELETE', `/entities/${entity}`, query);
  }

  async deleteOne(entity: string, id: string): Promise<void> {
    await this.req('DELETE', `/entities/${entity}/${id}`);
  }
}

export function assertBase44Configured(): void {
  if (!config.base44.apiKey) {
    throw new Error('Base44 is not configured. Set BASE44_API_KEY (+ BASE44_APP_ID) in .env');
  }
}

export function logBase44Target(): void {
  logger.info(`Base44 target: ${config.base44.baseUrl}${config.base44.appId ? ` (app ${config.base44.appId})` : ''}`);
}
