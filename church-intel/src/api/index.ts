import { createApp } from './app.js';
import { SupabaseCipStore } from './supabaseStore.js';
import { RealPipelineRunner } from './pipeline.js';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import type { KnownChurch } from '../research/prospect.js';

/**
 * Production entrypoint for the CIP API (`npm run api`). Wires the Supabase store
 * + the real research pipeline, then listens. The backend owns every secret;
 * Base44 reaches this server with a single bearer token.
 */
function main(): void {
  const store = new SupabaseCipStore();
  // Known roster for unknown-only discovery dedup = the CIP repository itself.
  const knownRoster = async (): Promise<KnownChurch[]> => {
    const { churches } = await store.listChurches({ limit: 100000 });
    return churches.map((c) => ({ name: c.name, website: c.website, city: c.city, state: c.state }));
  };
  const pipeline = new RealPipelineRunner({ knownRoster });
  const { app } = createApp({ store, pipeline, apiKey: config.api.cipApiKey });

  if (!config.api.cipApiKey) {
    logger.warn('CIP_API_KEY is not set — every request will be rejected with 401. Set CIP_API_KEY in .env.');
  }
  app.listen(config.api.port, () => {
    logger.info(`CIP API listening on http://localhost:${config.api.port}`);
  });
}

main();
