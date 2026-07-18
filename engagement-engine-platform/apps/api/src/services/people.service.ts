import type { SupabaseClient } from '@supabase/supabase-js';
import { PermissionDeniedError, ValidationFailedError } from '@ee/domain';
import { hasPermission } from '@ee/permissions';
import { CreatePersonSchema } from '@ee/validation';
import { createServiceClient } from '../config.js';
import { writeAuditEvent } from './audit.service.js';

interface PeopleServiceDeps {
  /** Anon/JWT-scoped client for permission checks (respects RLS). */
  db: SupabaseClient;
  userId: string;
  tenantId: string;
  requestId?: string;
}

/**
 * Lists people in a tenant.
 * Requires people.view permission (tenant-wide or campus-scoped).
 * RLS on the database further enforces campus scope.
 */
export async function listPeople({ db, userId, tenantId }: PeopleServiceDeps) {
  const allowed = await hasPermission(db, {
    userId,
    tenantId,
    permission: 'people.view',
  });

  if (!allowed) {
    throw new PermissionDeniedError();
  }

  const { data, error } = await db
    .from('people')
    .select(
      'id, first_name, last_name, preferred_name, email, phone, status, primary_campus_id, created_at',
    )
    .eq('tenant_id', tenantId)
    .order('last_name');

  if (error) throw error;
  return data ?? [];
}

/**
 * Creates a person in a tenant.
 *
 * Authorization:
 *   - people.create is required (tenant-wide or campus-scoped).
 *   - If the actor only has campus-scoped people.create, the new person's
 *     primary_campus_id must match the campus the actor holds the permission
 *     for. A missing campus on the record is only allowed for tenant-wide
 *     admins.
 *   - The tenant_id on the new record is always set from the URL, never from
 *     the request body, preventing cross-tenant injection.
 */
export async function createPerson(
  { db, userId, tenantId, requestId }: PeopleServiceDeps,
  rawBody: unknown,
) {
  const parsed = CreatePersonSchema.safeParse(rawBody);
  if (!parsed.success) {
    throw new ValidationFailedError('Invalid person data', parsed.error.flatten());
  }

  const input = parsed.data;

  // Check tenant-wide permission first
  const hasTenantWide = await hasPermission(db, {
    userId,
    tenantId,
    permission: 'people.create',
  });

  if (!hasTenantWide) {
    // Check campus-scoped permission
    if (!input.primaryCampusId) {
      // Campus-scoped admin must supply a campus
      throw new PermissionDeniedError(
        'A campus is required when you do not hold tenant-wide people.create permission',
      );
    }
    const hasCampus = await hasPermission(db, {
      userId,
      tenantId,
      permission: 'people.create',
      campusId: input.primaryCampusId,
    });
    if (!hasCampus) {
      throw new PermissionDeniedError();
    }
  }

  const serviceClient = createServiceClient();

  const { data: person, error } = await serviceClient
    .from('people')
    .insert({
      tenant_id: tenantId,
      first_name: input.firstName,
      last_name: input.lastName,
      preferred_name: input.preferredName ?? null,
      email: input.email ?? null,
      phone: input.phone ?? null,
      status: input.status,
      primary_campus_id: input.primaryCampusId ?? null,
    })
    .select()
    .single();

  if (error) throw error;

  await writeAuditEvent(serviceClient, {
    tenantId,
    actorUserId: userId,
    action: 'person.created',
    entityType: 'person',
    entityId: (person as { id: string }).id,
    metadata: { firstName: input.firstName, lastName: input.lastName },
    requestId,
  });

  return person;
}
