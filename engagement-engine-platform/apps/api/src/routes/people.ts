import { Hono } from 'hono';
import type { AppVariables } from '../types.js';
import { createServerClient } from '@ee/database';
import {
  PermissionDeniedError,
  ValidationFailedError,
} from '@ee/domain';
import { hasPermission } from '@ee/permissions';
import { CreatePersonSchema } from '@ee/validation';
import { requireAuth } from '../middleware/require-auth.js';
import { requireTenantMembership } from '../middleware/require-tenant.js';

export const peopleRouter = new Hono<{ Variables: AppVariables }>();

peopleRouter.use('/:tenantId/people*', requireAuth);
peopleRouter.use('/:tenantId/people*', requireTenantMembership);

peopleRouter.get('/:tenantId/people', async (c) => {
  const tenantId = c.req.param('tenantId');
  const user = c.get('user');
  const db = c.get('supabaseClient');

  const allowed = await hasPermission(db, {
    userId: user.id,
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

  if (error) {
    throw error;
  }

  return c.json({ people: data ?? [] });
});

peopleRouter.post('/:tenantId/people', async (c) => {
  const tenantId = c.req.param('tenantId');
  const user = c.get('user');
  const db = c.get('supabaseClient');

  const allowed = await hasPermission(db, {
    userId: user.id,
    tenantId,
    permission: 'people.create',
  });

  if (!allowed) {
    throw new PermissionDeniedError();
  }

  const body = await c.req.json();
  const parsed = CreatePersonSchema.safeParse(body);

  if (!parsed.success) {
    throw new ValidationFailedError(
      'Invalid person data',
      parsed.error.flatten(),
    );
  }

  const input = parsed.data;
  const serviceUrl = process.env['NEXT_PUBLIC_SUPABASE_URL']!;
  const serviceKey = process.env['SUPABASE_SERVICE_ROLE_KEY']!;
  const serviceClient = createServerClient(serviceUrl, serviceKey);

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

  if (error) {
    throw error;
  }

  await serviceClient.from('audit_events').insert({
    tenant_id: tenantId,
    actor_user_id: user.id,
    actor_type: 'user',
    action: 'person.created',
    entity_type: 'person',
    entity_id: (person as { id: string }).id,
    metadata: { firstName: input.firstName, lastName: input.lastName },
  });

  return c.json({ person }, 201);
});
