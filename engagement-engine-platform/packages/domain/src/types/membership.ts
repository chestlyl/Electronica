export interface TenantMembership {
  id: string;
  tenantId: string;
  userId: string;
  status: 'invited' | 'active' | 'suspended' | 'removed';
  joinedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Role {
  id: string;
  tenantId: string | null;
  name: string;
  slug: string;
  description: string | null;
  isSystemRole: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Permission {
  id: string;
  key: string;
  description: string | null;
  sensitivityLevel: 'public' | 'internal' | 'restricted' | 'sensitive';
  createdAt: string;
}

export interface RolePermission {
  roleId: string;
  permissionId: string;
  createdAt: string;
}

export interface RoleAssignment {
  id: string;
  tenantId: string;
  membershipId: string;
  roleId: string;
  campusId: string | null;
  ministryId: string | null;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
}

export interface Invitation {
  id: string;
  tenantId: string;
  email: string;
  invitedByUserId: string;
  roleId: string;
  campusId: string | null;
  ministryId: string | null;
  tokenHash: string;
  status: 'pending' | 'accepted' | 'expired' | 'revoked';
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
}
