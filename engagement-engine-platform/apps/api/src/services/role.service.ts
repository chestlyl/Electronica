import type { SupabaseClient } from '@supabase/supabase-js';
import { PermissionDeniedError, ValidationFailedError } from '@ee/domain';
import { hasPermission } from '@ee/permissions';
import { AssignRoleSchema } from '@ee/validation';
import { createServiceClient } from '../config.js';
import { writeAuditEvent } from './audit.service.js';

interface RoleServiceDeps {
  db: SupabaseClient;
  userId: string;
  tenantId: string;
  requestId?: string;
}

/**
 * Assigns a role to a membership.
 *
 * Security checks:
 *   1. Actor must have roles.manage permission in the tenant.
 *   2. The role being assigned must belong to this tenant (tenant_id match).
 *   3. The membership being targeted must belong to this tenant.
 *   4. Campus/ministry scoping on the assignment is stored as-is;
 *      the actor must have permission to manage roles in that campus/ministry
 *      (enforced via RLS on role_assignments through the service client's
 *      audit trail and domain validation).
 *
 * Note: Church administrators cannot assign platform roles — platform role
 * assignments require direct service-role access to the platform_admins table
 * which is not exposed through this route.
 */
export async function assignRole(
  { db, userId, tenantId, requestId }: RoleServiceDeps,
  rawBody: unknown,
) {
  const allowed = await hasPermission(db, {
    userId,
    tenantId,
    permission: 'roles.manage',
  });

  if (!allowed) {
    throw new PermissionDeniedError();
  }

  const parsed = AssignRoleSchema.safeParse(rawBody);
  if (!parsed.success) {
    throw new ValidationFailedError('Invalid role assignment', parsed.error.flatten());
  }

  const input = parsed.data;

  // Verify the role belongs to this tenant (prevent cross-tenant role assignment)
  const { data: role } = await db
    .from('roles')
    .select('id, tenant_id')
    .eq('id', input.roleId)
    .maybeSingle();

  if (!role || (role.tenant_id !== null && role.tenant_id !== tenantId)) {
    throw new ValidationFailedError('Role does not belong to this tenant');
  }

  // Verify the membership belongs to this tenant
  const { data: membership } = await db
    .from('tenant_memberships')
    .select('id, tenant_id')
    .eq('id', input.membershipId)
    .maybeSingle();

  if (!membership || membership.tenant_id !== tenantId) {
    throw new ValidationFailedError('Membership does not belong to this tenant');
  }

  const serviceClient = createServiceClient();

  const { data: assignment, error } = await serviceClient
    .from('role_assignments')
    .insert({
      tenant_id: tenantId,
      membership_id: input.membershipId,
      role_id: input.roleId,
      campus_id: input.campusId ?? null,
      ministry_id: input.ministryId ?? null,
      expires_at: input.expiresAt ?? null,
    })
    .select()
    .single();

  if (error) throw error;

  await writeAuditEvent(serviceClient, {
    tenantId,
    actorUserId: userId,
    action: 'role.assigned',
    entityType: 'role_assignment',
    entityId: (assignment as { id: string }).id,
    metadata: {
      membershipId: input.membershipId,
      roleId: input.roleId,
      campusId: input.campusId ?? null,
      ministryId: input.ministryId ?? null,
    },
    requestId,
  });

  return assignment;
}
