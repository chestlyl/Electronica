import { createHash, randomBytes } from 'crypto';
import { Hono } from 'hono';
import type { AppVariables } from '../types.js';
import { createServerClient } from '@ee/database';
import {
  PermissionDeniedError,
  ValidationFailedError,
} from '@ee/domain';
import { hasPermission } from '@ee/permissions';
import { CreateInvitationSchema } from '@ee/validation';
import { requireAuth } from '../middleware/require-auth.js';
import { requireTenantMembership } from '../middleware/require-tenant.js';

export const invitationsRouter = new Hono<{ Variables: AppVariables }>();

invitationsRouter.use('/:tenantId/invitations*', requireAuth);
invitationsRouter.use('/:tenantId/invitations*', requireTenantMembership);

invitationsRouter.post('/:tenantId/invitations', async (c) => {
  const tenantId = c.req.param('tenantId');
  const user = c.get('user');
  const db = c.get('supabaseClient');

  const allowed = await hasPermission(db, {
    userId: user.id,
    tenantId,
    permission: 'invitations.create',
  });

  if (!allowed) {
    throw new PermissionDeniedError();
  }

  const body = await c.req.json();
  const parsed = CreateInvitationSchema.safeParse(body);

  if (!parsed.success) {
    throw new ValidationFailedError(
      'Invalid invitation data',
      parsed.error.flatten(),
    );
  }

  const rawToken = randomBytes(32).toString('hex');
  const tokenHash = createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = parsed.data.expiresAt
    ? new Date(parsed.data.expiresAt)
    : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const serviceClient = createServerClient(
    process.env['NEXT_PUBLIC_SUPABASE_URL']!,
    process.env['SUPABASE_SERVICE_ROLE_KEY']!,
  );

  const { data: invitation, error } = await serviceClient
    .from('invitations')
    .insert({
      tenant_id: tenantId,
      email: parsed.data.email,
      invited_by_user_id: user.id,
      role_id: parsed.data.roleId,
      campus_id: parsed.data.campusId ?? null,
      ministry_id: parsed.data.ministryId ?? null,
      token_hash: tokenHash,
      status: 'pending',
      expires_at: expiresAt.toISOString(),
    })
    .select('id, email, status, expires_at, created_at')
    .single();

  if (error) {
    throw error;
  }

  await serviceClient.from('audit_events').insert({
    tenant_id: tenantId,
    actor_user_id: user.id,
    actor_type: 'user',
    action: 'invitation.created',
    entity_type: 'invitation',
    entity_id: (invitation as { id: string }).id,
    metadata: { email: parsed.data.email, roleId: parsed.data.roleId },
  });

  return c.json({ invitation }, 201);
});
