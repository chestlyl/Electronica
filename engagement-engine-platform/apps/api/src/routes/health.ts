import { Hono } from 'hono';
import type { AppVariables } from '../types.js';

export const healthRouter = new Hono<{ Variables: AppVariables }>();

healthRouter.get('/', (c) => {
  return c.json({
    status: 'ok',
    service: 'engagement-engine-api',
    timestamp: new Date().toISOString(),
  });
});
