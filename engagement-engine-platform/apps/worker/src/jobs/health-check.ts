import type { Job } from '../job-registry.js';

export const healthCheckJob: Job = {
  name: 'health-check',
  description: 'Verifies worker is running and environment is configured',
  async run() {
    const supabaseUrl = process.env['NEXT_PUBLIC_SUPABASE_URL'];
    const status = {
      worker: 'ok',
      supabaseConfigured: Boolean(supabaseUrl),
      timestamp: new Date().toISOString(),
    };

    console.log('[health-check]', JSON.stringify(status));
  },
};
