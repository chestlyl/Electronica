import 'dotenv/config';
import { healthCheckJob } from './jobs/health-check.js';
import { registry } from './job-registry.js';

registry.register(healthCheckJob);

console.log('[worker] starting');
console.log('[worker] registered jobs:', registry.list());

registry
  .run('health-check')
  .then(() => {
    console.log('[worker] demonstration job complete');
  })
  .catch((err: unknown) => {
    console.error('[worker] job failed', err);
  });
