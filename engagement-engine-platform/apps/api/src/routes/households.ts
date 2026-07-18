import { Hono } from 'hono';
import type { AppVariables } from '../types.js';
import { requireAuth } from '../middleware/require-auth.js';
import { requireTenantMembership } from '../middleware/require-tenant.js';
import { listHouseholds, createHousehold } from '../services/household.service.js';

export const householdsRouter = new Hono<{ Variables: AppVariables }>();

householdsRouter.use('/:tenantId/households*', requireAuth);
householdsRouter.use('/:tenantId/households*', requireTenantMembership);

householdsRouter.get('/:tenantId/households', async (c) => {
  const tenantId = c.req.param('tenantId');
  const user = c.get('user');
  const db = c.get('supabaseClient');

  const households = await listHouseholds({ db, userId: user.id, tenantId, requestId: c.get('requestId') });
  return c.json({ households });
});

householdsRouter.post('/:tenantId/households', async (c) => {
  const tenantId = c.req.param('tenantId');
  const user = c.get('user');
  const db = c.get('supabaseClient');
  const body = await c.req.json();

  const household = await createHousehold(
    { db, userId: user.id, tenantId, requestId: c.get('requestId') },
    body,
  );
  return c.json({ household }, 201);
});
