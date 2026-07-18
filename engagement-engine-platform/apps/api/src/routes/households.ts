import { Hono } from 'hono';
import type { AppVariables } from '../types.js';
import { createServerClient } from '@ee/database';
import {
  PermissionDeniedError,
  ValidationFailedError,
} from '@ee/domain';
import { hasPermission } from '@ee/permissions';
import { CreateHouseholdSchema } from '@ee/validation';
import { requireAuth } from '../middleware/require-auth.js';
import { requireTenantMembership } from '../middleware/require-tenant.js';

export const householdsRouter = new Hono<{ Variables: AppVariables }>();

householdsRouter.use('/:tenantId/households*', requireAuth);
householdsRouter.use('/:tenantId/households*', requireTenantMembership);

householdsRouter.get('/:tenantId/households', async (c) => {
  const tenantId = c.req.param('tenantId');
  const user = c.get('user');
  const db = c.get('supabaseClient');

  const allowed = await hasPermission(db, {
    userId: user.id,
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

  if (error) {
    throw error;
  }

  return c.json({ households: data ?? [] });
});

householdsRouter.post('/:tenantId/households', async (c) => {
  const tenantId = c.req.param('tenantId');
  const user = c.get('user');
  const db = c.get('supabaseClient');

  const allowed = await hasPermission(db, {
    userId: user.id,
    tenantId,
    permission: 'households.create',
  });

  if (!allowed) {
    throw new PermissionDeniedError();
  }

  const body = await c.req.json();
  const parsed = CreateHouseholdSchema.safeParse(body);

  if (!parsed.success) {
    throw new ValidationFailedError(
      'Invalid household data',
      parsed.error.flatten(),
    );
  }

  const serviceClient = createServerClient(
    process.env['NEXT_PUBLIC_SUPABASE_URL']!,
    process.env['SUPABASE_SERVICE_ROLE_KEY']!,
  );

  const { data: household, error } = await serviceClient
    .from('households')
    .insert({
      tenant_id: tenantId,
      name: parsed.data.name,
      primary_campus_id: parsed.data.primaryCampusId ?? null,
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
    action: 'household.created',
    entity_type: 'household',
    entity_id: (household as { id: string }).id,
    metadata: { name: parsed.data.name },
  });

  return c.json({ household }, 201);
});
