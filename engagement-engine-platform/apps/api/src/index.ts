import 'dotenv/config';
// Validate all required environment variables before starting the server.
// This call will throw with a clear error message if any required variable is missing.
import { getConfig } from './config.js';
getConfig();

import { serve } from '@hono/node-server';
import { app } from './app.js';

const port = Number(process.env['PORT'] ?? 4000);

console.log(`[api] starting on port ${port}`);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[api] listening on http://localhost:${info.port}`);
});
