import { Hono } from 'hono';
import type { AppVariables } from '../types.js';
import { requireAuth } from '../middleware/require-auth.js';
import { requireTenantMembership } from '../middleware/require-tenant.js';
import { rateLimiter } from '../middleware/rate-limit.js';
import { createInvitation, acceptInvitation } from '../services/invitation.service.js';

export const invitationsRouter = new Hono<{ Variables: AppVariables }>();

invitationsRouter.use('/:tenantId/invitations*', requireAuth);
invitationsRouter.use('/:tenantId/invitations*', requireTenantMembership);

const inviteCreateLimiter = rateLimiter({ limit: 20, windowMs: 60_000, label: 'invitation.create' });
invitationsRouter.use('/:tenantId/invitations', inviteCreateLimiter);

invitationsRouter.post('/:tenantId/invitations', async (c) => {
  const tenantId = c.req.param('tenantId');
  const user = c.get('user');
  const db = c.get('supabaseClient');
  const body = await c.req.json();

  const result = await createInvitation(
    { db, userId: user.id, tenantId, requestId: c.get('requestId') },
    body,
  );
  return c.json(result, 201);
});

// Acceptance endpoint: no tenantId in path — the invitation determines the tenant
const acceptLimiter = rateLimiter({ limit: 10, windowMs: 60_000, label: 'invitation.accept' });

invitationsRouter.post('/invitations/accept', requireAuth, acceptLimiter, async (c) => {
  const user = c.get('user');
  const userEmail = user.email;

  if (!userEmail) {
    return c.json({ error: 'Authenticated user has no email address' }, 400);
  }

  const body = await c.req.json<{ token?: string }>();

  const result = await acceptInvitation(
    user.id,
    userEmail,
    { token: body.token ?? '' },
    c.get('requestId'),
  );

  return c.json(result, 200);
});
