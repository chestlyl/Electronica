import { Hono } from 'hono';
import type { AppVariables } from '../types.js';
import { requireAuth } from '../middleware/require-auth.js';
import { requireTenantMembership } from '../middleware/require-tenant.js';
import { listPeople, createPerson } from '../services/people.service.js';

export const peopleRouter = new Hono<{ Variables: AppVariables }>();

peopleRouter.use('/:tenantId/people*', requireAuth);
peopleRouter.use('/:tenantId/people*', requireTenantMembership);

peopleRouter.get('/:tenantId/people', async (c) => {
  const tenantId = c.req.param('tenantId');
  const user = c.get('user');
  const db = c.get('supabaseClient');

  const people = await listPeople({ db, userId: user.id, tenantId, requestId: c.get('requestId') });
  return c.json({ people });
});

peopleRouter.post('/:tenantId/people', async (c) => {
  const tenantId = c.req.param('tenantId');
  const user = c.get('user');
  const db = c.get('supabaseClient');
  const body = await c.req.json();

  const person = await createPerson(
    { db, userId: user.id, tenantId, requestId: c.get('requestId') },
    body,
  );
  return c.json({ person }, 201);
});
