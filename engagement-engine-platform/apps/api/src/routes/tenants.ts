import { Hono } from 'hono';
import type { AppVariables } from '../types.js';
import { requireAuth } from '../middleware/require-auth.js';

export const tenantsRouter = new Hono<{ Variables: AppVariables }>();

tenantsRouter.use('*', requireAuth);

tenantsRouter.get('/:tenantId', async (c) => {
  const tenantId = c.req.param('tenantId');
  const user = c.get('user');
  const db = c.get('supabaseClient');

  const { data: membership } = await db
    .from('tenant_memberships')
    .select('status')
    .eq('tenant_id', tenantId)
    .eq('user_id', user.id)
    .eq('status', 'active')
    .maybeSingle();

  if (!membership) {
    return c.json(
      {
        error: 'Tenant membership required',
        code: 'TENANT_MEMBERSHIP_REQUIRED',
      },
      403,
    );
  }

  const { data: tenant, error } = await db
    .from('tenants')
    .select('id, name, slug, status, timezone, default_currency')
    .eq('id', tenantId)
    .single();

  if (error || !tenant) {
    return c.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, 404);
  }

  return c.json({ tenant });
});
