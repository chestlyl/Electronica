import { Hono } from 'hono';
import type { AppVariables } from '../types.js';
import { createServerClient } from '@ee/database';
import {
  PermissionDeniedError,
  ValidationFailedError,
} from '@ee/domain';
import { hasPermission } from '@ee/permissions';
import { AssignRoleSchema } from '@ee/validation';
import { requireAuth } from '../middleware/require-auth.js';
import { requireTenantMembership } from '../middleware/require-tenant.js';

export const rolesRouter = new Hono<{ Variables: AppVariables }>();

rolesRouter.use('/:tenantId/roles*', requireAuth);
rolesRouter.use('/:tenantId/roles*', requireTenantMembership);

rolesRouter.post('/:tenantId/roles/assign', async (c) => {
  const tenantId = c.req.param('tenantId');
  const user = c.get('user');
  const db = c.get('supabaseClient');

  const allowed = await hasPermission(db, {
    userId: user.id,
    tenantId,
    permission: 'roles.manage',
  });

  if (!allowed) {
    throw new PermissionDeniedError();
  }

  const body = await c.req.json();
  const parsed = AssignRoleSchema.safeParse(body);

  if (!parsed.success) {
    throw new ValidationFailedError(
      'Invalid role assignment',
      parsed.error.flatten(),
    );
  }

  const { data: role } = await db
    .from('roles')
    .select('id, tenant_id')
    .eq('id', parsed.data.roleId)
    .maybeSingle();

  if (!role || (role.tenant_id !== null && role.tenant_id !== tenantId)) {
    throw new ValidationFailedError('Role does not belong to this tenant');
  }

  const serviceClient = createServerClient(
    process.env['NEXT_PUBLIC_SUPABASE_URL']!,
    process.env['SUPABASE_SERVICE_ROLE_KEY']!,
  );

  const { data: assignment, error } = await serviceClient
    .from('role_assignments')
    .insert({
      tenant_id: tenantId,
      membership_id: parsed.data.membershipId,
      role_id: parsed.data.roleId,
      campus_id: parsed.data.campusId ?? null,
      ministry_id: parsed.data.ministryId ?? null,
      expires_at: parsed.data.expiresAt ?? null,
    })
    .select()
    .single();

  if (error) {
    throw error;
  }

  await serviceClient.from('audit_events').insert({
    tenant_id: tenantId,
    actor_user_id: user.id,
    actor_type: 'user',
    action: 'role.assigned',
    entity_type: 'role_assignment',
    entity_id: (assignment as { id: string }).id,
    metadata: {
      membershipId: parsed.data.membershipId,
      roleId: parsed.data.roleId,
    },
  });

  return c.json({ assignment }, 201);
});
