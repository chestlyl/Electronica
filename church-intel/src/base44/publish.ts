import { Base44Client } from './client.js';
import { mapDossierToBase44, type Base44Payload } from './mapper.js';
import { logger } from '../lib/logger.js';
import type { DossierBuild, ResearchTarget } from '../research/researchAgent.js';

/**
 * Publish a completed dossier into the Base44 front-end app's entities. The
 * Church record is UPSERTED (by website, else name); all child records are
 * REPLACED for that church_id so a re-run is clean (no duplicates). A
 * ResearchJob + ActivityLog are appended as history.
 */
export interface PublishResult {
  church_id: string;
  created: boolean;
  counts: Record<'contacts' | 'technologies' | 'signals' | 'coverage' | 'scores' | 'rawEvidence', number>;
}

const CHILDREN: { entity: string; key: keyof Base44Payload }[] = [
  { entity: 'Contact', key: 'contacts' },
  { entity: 'Technology', key: 'technologies' },
  { entity: 'StrategicSignal', key: 'signals' },
  { entity: 'CoverageItem', key: 'coverage' },
  { entity: 'ScoreDetail', key: 'scores' },
  { entity: 'RawEvidence', key: 'rawEvidence' },
];

async function upsertChurch(client: Base44Client, payload: Base44Payload): Promise<{ id: string; created: boolean }> {
  const { website, name } = payload.dedupe;
  let existing: { id?: string } | undefined;
  if (website) existing = (await client.list<{ id: string }>('Church', { q: { website }, limit: 1 }))[0];
  if (!existing) existing = (await client.list<{ id: string }>('Church', { q: { name }, limit: 1 }))[0];
  if (existing?.id) {
    await client.update('Church', existing.id, payload.church);
    return { id: existing.id, created: false };
  }
  const created = await client.create<{ id: string }>('Church', payload.church);
  return { id: created.id, created: true };
}

export async function publishDossierToBase44(
  target: ResearchTarget,
  build: DossierBuild,
  client: Base44Client = new Base44Client(),
): Promise<PublishResult> {
  const payload = mapDossierToBase44(target, build);
  const { id: church_id, created } = await upsertChurch(client, payload);

  const counts = { contacts: 0, technologies: 0, signals: 0, coverage: 0, scores: 0, rawEvidence: 0 } as PublishResult['counts'];
  const countKey: Record<string, keyof PublishResult['counts']> = {
    contacts: 'contacts', technologies: 'technologies', signals: 'signals', coverage: 'coverage', scores: 'scores', rawEvidence: 'rawEvidence',
  };
  for (const { entity, key } of CHILDREN) {
    const rows = (payload[key] as Record<string, unknown>[]).map((r) => ({ ...r, church_id }));
    // Replace prior records for this church (clean re-run). Tolerate a no-match delete.
    try { await client.deleteMany(entity, { church_id }); } catch (e) { logger.debug?.(`Base44 deleteMany ${entity}: ${(e as Error).message}`); }
    await client.bulkCreate(entity, rows);
    counts[countKey[key as string]] = rows.length;
  }

  const now = new Date().toISOString();
  await client.create('ResearchJob', { ...payload.job, church_id, start_time: now, end_time: now });
  await client.create('ActivityLog', { ...payload.activity, church_id });

  return { church_id, created, counts };
}
