import type { SupabaseClient } from '@supabase/supabase-js';
import { PermissionDeniedError, ValidationFailedError } from '@ee/domain';
import { hasPermission } from '@ee/permissions';
import { CreateHouseholdSchema } from '@ee/validation';
import { createServiceClient } from '../config.js';
import { writeAuditEvent } from './audit.service.js';

interface HouseholdServiceDeps {
  db: SupabaseClient;
  userId: string;
  tenantId: string;
  requestId?: string;
}

export async function listHouseholds({ db, userId, tenantId }: HouseholdServiceDeps) {
  const allowed = await hasPermission(db, {
    userId,
    tenantId,
    permission: 'households.view',
  });

  if (!allowed) {
    throw new PermissionDeniedError();
  }

  const { data, error } = await db
    .from('households')
    .select('id, name, primary_campus_id, created_at')
    .eq('tenant_id', tenantId)
    .order('name');

  if (error) throw error;
  return data ?? [];
}

export async function createHousehold(
  { db, userId, tenantId, requestId }: HouseholdServiceDeps,
  rawBody: unknown,
) {
  const parsed = CreateHouseholdSchema.safeParse(rawBody);
  if (!parsed.success) {
    throw new ValidationFailedError('Invalid household data', parsed.error.flatten());
  }

  const input = parsed.data;

  const hasTenantWide = await hasPermission(db, {
    userId,
    tenantId,
    permission: 'households.create',
  });

  if (!hasTenantWide) {
    if (!input.primaryCampusId) {
      throw new PermissionDeniedError(
        'A campus is required when you do not hold tenant-wide households.create permission',
      );
    }
    const hasCampus = await hasPermission(db, {
      userId,
      tenantId,
      permission: 'households.create',
      campusId: input.primaryCampusId,
    });
    if (!hasCampus) {
      throw new PermissionDeniedError();
    }
  }

  const serviceClient = createServiceClient();

  const { data: household, error } = await serviceClient
    .from('households')
    .insert({
      tenant_id: tenantId,
      name: input.name,
      primary_campus_id: input.primaryCampusId ?? null,
    })
    .select()
    .single();

  if (error) throw error;

  await writeAuditEvent(serviceClient, {
    tenantId,
    actorUserId: userId,
    action: 'household.created',
    entityType: 'household',
    entityId: (household as { id: string }).id,
    metadata: { name: input.name },
    requestId,
  });

  return household;
}
