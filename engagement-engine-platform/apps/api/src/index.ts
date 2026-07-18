import 'dotenv/config';
import { serve } from '@hono/node-server';
import { app } from './app.js';

const port = Number(process.env['PORT'] ?? 4000);

console.log(`[api] starting on port ${port}`);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[api] listening on http://localhost:${info.port}`);
});
