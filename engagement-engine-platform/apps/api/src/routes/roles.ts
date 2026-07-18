import { Hono } from 'hono';
import type { AppVariables } from '../types.js';
import { requireAuth } from '../middleware/require-auth.js';
import { requireTenantMembership } from '../middleware/require-tenant.js';
import { assignRole } from '../services/role.service.js';

export const rolesRouter = new Hono<{ Variables: AppVariables }>();

rolesRouter.use('/:tenantId/roles*', requireAuth);
rolesRouter.use('/:tenantId/roles*', requireTenantMembership);

rolesRouter.post('/:tenantId/roles/assign', async (c) => {
  const tenantId = c.req.param('tenantId');
  const user = c.get('user');
  const db = c.get('supabaseClient');
  const body = await c.req.json();

  const assignment = await assignRole(
    { db, userId: user.id, tenantId, requestId: c.get('requestId') },
    body,
  );
  return c.json({ assignment }, 201);
});
