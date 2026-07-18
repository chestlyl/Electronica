import type { SupabaseClient } from '@supabase/supabase-js';

const METADATA_MAX_BYTES = 4096;

interface AuditParams {
  tenantId: string;
  actorUserId: string;
  actorType?: 'user' | 'system' | 'service';
  action: string;
  entityType: string;
  entityId: string;
  metadata?: Record<string, unknown>;
  requestId?: string;
}

/**
 * Writes a single audit event using the provided service-role client.
 *
 * Metadata is truncated to METADATA_MAX_BYTES to prevent oversized payloads
 * from being stored. Sensitive fields (passwords, tokens) must never be
 * included in metadata before calling this function.
 *
 * Audit write failures are logged but do not throw — the business operation
 * has already succeeded by the time this is called.
 */
export async function writeAuditEvent(
  serviceClient: SupabaseClient,
  params: AuditParams,
): Promise<void> {
  let safeMetadata: Record<string, unknown> | null = null;

  if (params.metadata) {
    const serialized = JSON.stringify(params.metadata);
    if (serialized.length <= METADATA_MAX_BYTES) {
      safeMetadata = params.metadata;
    } else {
      safeMetadata = { _truncated: true, _reason: 'metadata_too_large' };
    }
  }

  const { error } = await serviceClient.from('audit_events').insert({
    tenant_id: params.tenantId,
    actor_user_id: params.actorUserId,
    actor_type: params.actorType ?? 'user',
    action: params.action,
    entity_type: params.entityType,
    entity_id: params.entityId,
    metadata: safeMetadata,
    request_id: params.requestId ?? null,
  });

  if (error) {
    console.error('[audit] Failed to write audit event', {
      action: params.action,
      entityId: params.entityId,
      requestId: params.requestId,
      error: error.message,
    });
  }
}
