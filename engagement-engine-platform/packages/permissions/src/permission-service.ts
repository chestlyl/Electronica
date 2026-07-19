import type { SupabaseClient } from '@supabase/supabase-js';
import type { EffectivePermissions, PermissionKey, ScopedPermission } from '@ee/domain';

export interface HasPermissionOptions {
  userId: string;
  tenantId: string;
  permission: PermissionKey;
  campusId?: string;
  ministryId?: string;
}

/**
 * Returns all effective permissions for a user in a tenant.
 * Preserves campus/ministry scope — does NOT flatten to a permission name-only set.
 *
 * Denial is the default: if no matching role assignment + permission exists, false is returned.
 */
export async function getEffectivePermissions(
  db: SupabaseClient,
  userId: string,
  tenantId: string,
): Promise<EffectivePermissions> {
  const { data: membership, error: membershipError } = await db
    .from('tenant_memberships')
    .select('id, status')
    .eq('user_id', userId)
    .eq('tenant_id', tenantId)
    .eq('status', 'active')
    .maybeSingle();

  if (membershipError || !membership) {
    return { userId, tenantId, permissions: [] };
  }

  const now = new Date().toISOString();

  const { data: assignments, error: assignmentError } = await db
    .from('role_assignments')
    .select('role_id, campus_id, ministry_id')
    .eq('membership_id', membership.id)
    .eq('tenant_id', tenantId)
    .is('revoked_at', null)
    .or(`expires_at.is.null,expires_at.gt.${now}`);

  if (assignmentError || !assignments || assignments.length === 0) {
    return { userId, tenantId, permissions: [] };
  }

  const roleIds = [...new Set(assignments.map((a) => a.role_id as string))];

  const { data: rolePerms, error: rolePermsError } = await db
    .from('role_permissions')
    .select('role_id, permissions(key)')
    .in('role_id', roleIds);

  if (rolePermsError || !rolePerms) {
    return { userId, tenantId, permissions: [] };
  }

  const permissions: ScopedPermission[] = [];

  for (const assignment of assignments) {
    const matchingPerms = rolePerms.filter((rp) => rp.role_id === assignment.role_id);
    for (const rp of matchingPerms) {
      const perm = rp.permissions as unknown as { key: string } | null;
      if (perm?.key) {
        permissions.push({
          key: perm.key as PermissionKey,
          campusId: (assignment.campus_id as string | null) ?? null,
          ministryId: (assignment.ministry_id as string | null) ?? null,
        });
      }
    }
  }

  return { userId, tenantId, permissions };
}

/**
 * Answers whether a user holds a specific permission,
 * optionally scoped to a campus and/or ministry.
 *
 * Denial by default: returns false unless an explicit grant is found.
 */
export async function hasPermission(
  db: SupabaseClient,
  opts: HasPermissionOptions,
): Promise<boolean> {
  const effective = await getEffectivePermissions(db, opts.userId, opts.tenantId);

  return effective.permissions.some((p) => {
    if (p.key !== opts.permission) return false;

    if (p.campusId === null && p.ministryId === null) return true;

    if (opts.campusId && p.campusId === opts.campusId && p.ministryId === null) return true;

    if (opts.ministryId && p.ministryId === opts.ministryId) return true;

    return false;
  });
}
