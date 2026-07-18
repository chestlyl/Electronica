export type PermissionKey =
  | 'tenant.view'
  | 'tenant.manage'
  | 'people.view'
  | 'people.create'
  | 'people.update'
  | 'people.archive'
  | 'households.view'
  | 'households.create'
  | 'households.update'
  | 'memberships.view'
  | 'memberships.manage'
  | 'roles.view'
  | 'roles.manage'
  | 'permissions.view'
  | 'invitations.create'
  | 'audit.view'
  | 'integrations.view'
  | 'integrations.manage'
  | 'settings.view'
  | 'settings.manage';

export interface ScopedPermission {
  key: PermissionKey;
  campusId: string | null;
  ministryId: string | null;
}

export interface EffectivePermissions {
  userId: string;
  tenantId: string;
  permissions: ScopedPermission[];
}
