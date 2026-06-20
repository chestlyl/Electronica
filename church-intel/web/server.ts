import express from 'express';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config } from '../src/config.js';
import { logger } from '../src/lib/logger.js';
import { SupabaseStore } from '../src/db/supabase.js';
import { JsonStore } from '../src/db/jsonStore.js';
import { setReviewStatus, processReviewQueue } from '../src/review.js';
import type { Store } from '../src/db/store.js';
import type { ChurchFilter, ReviewStatus } from '../src/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function pickStore(): { store: Store; mode: string } {
  if (config.supabase.url && config.supabase.serviceRoleKey) {
    return { store: new SupabaseStore(), mode: 'supabase' };
  }
  const demoDb = join(process.cwd(), 'data', 'output', 'demo_db.json');
  if (existsSync(demoDb)) {
    logger.warn('Supabase not configured — serving the offline demo store (read-mostly).');
    return { store: new JsonStore(demoDb), mode: 'demo-json' };
  }
  throw new Error('No data source: configure Supabase in .env, or run `npm run demo` first.');
}

const { store, mode } = pickStore();
const app = express();
app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

function parseFilter(q: any): ChurchFilter {
  const f: ChurchFilter = {};
  if (q.state) f.state = String(q.state);
  if (q.activeStatus) f.activeStatus = q.activeStatus;
  if (q.missingWebsite === 'true') f.missingWebsite = true;
  if (q.missingEmail === 'true') f.missingEmail = true;
  if (q.missingPastor === 'true') f.missingPastor = true;
  if (q.minMmcFit) f.minMmcFit = Number(q.minMmcFit);
  if (q.search) f.search = String(q.search);
  f.limit = q.limit ? Number(q.limit) : 100;
  f.offset = q.offset ? Number(q.offset) : 0;
  return f;
}

app.get('/api/meta', (_req, res) => res.json({ mode }));

app.get('/api/churches', async (req, res) => {
  try {
    const rows = await store.listChurches(parseFilter(req.query));
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.get('/api/churches/:id', async (req, res) => {
  try {
    const church = await store.getChurch(req.params.id);
    if (!church) return res.status(404).json({ error: 'not found' });
    const evidence = await store.listEvidence(req.params.id);
    res.json({ church, evidence });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.get('/api/review-queue', async (req, res) => {
  try {
    const status = (req.query.status as ReviewStatus) || 'pending';
    res.json(await store.listReviewQueue(status));
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.post('/api/review/:id', async (req, res) => {
  try {
    const { status, notes } = req.body as { status: ReviewStatus; notes?: string };
    await setReviewStatus(store, req.params.id, status, notes);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.post('/api/review-queue/process', async (_req, res) => {
  try {
    res.json(await processReviewQueue(store));
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

const port = config.dashboard.port;
app.listen(port, () => {
  logger.info(`Dashboard (${mode}) running at http://localhost:${port}`);
});
