export interface Tenant {
  id: string;
  name: string;
  slug: string;
  status: 'pilot' | 'trial' | 'active' | 'suspended' | 'archived';
  timezone: string;
  defaultCurrency: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface TenantDomain {
  id: string;
  tenantId: string;
  hostname: string;
  domainType: 'primary' | 'alias' | 'redirect';
  isPrimary: boolean;
  verificationStatus: 'pending' | 'verified' | 'failed';
  createdAt: string;
  updatedAt: string;
}

export interface TenantSettings {
  id: string;
  tenantId: string;
  settings: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}
