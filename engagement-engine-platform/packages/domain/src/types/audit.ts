export type ActorType = 'user' | 'system' | 'service';

export interface AuditEvent {
  id: string;
  tenantId: string | null;
  actorUserId: string | null;
  actorType: ActorType;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Record<string, unknown>;
  requestId: string | null;
  createdAt: string;
}
