export type IntegrationStatus = 'active' | 'inactive' | 'error' | 'pending';

export interface IntegrationConnection {
  id: string;
  tenantId: string;
  providerType: string;
  providerName: string;
  status: IntegrationStatus;
  configuration: Record<string, unknown>;
  secretReference: string | null;
  lastSyncAt: string | null;
  lastErrorAt: string | null;
  createdAt: string;
  updatedAt: string;
}
