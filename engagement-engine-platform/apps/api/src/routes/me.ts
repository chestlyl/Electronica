import { Hono } from 'hono';
import type { AppVariables } from '../types.js';
import { getEffectivePermissions } from '@ee/permissions';
import { requireAuth } from '../middleware/require-auth.js';

export const meRouter = new Hono<{ Variables: AppVariables }>();

meRouter.use('*', requireAuth);

meRouter.get('/', (c) => {
  const user = c.get('user');
  return c.json({ user: { id: user.id, email: user.email } });
});

meRouter.get('/permissions/:tenantId', async (c) => {
  const user = c.get('user');
  const db = c.get('supabaseClient');
  const tenantId = c.req.param('tenantId');

  const effective = await getEffectivePermissions(db, user.id, tenantId);
  return c.json(effective);
});
