import { Hono } from 'hono';
import type { AppVariables } from '../types.js';
import { PermissionDeniedError } from '@ee/domain';
import { hasPermission } from '@ee/permissions';
import { requireAuth } from '../middleware/require-auth.js';
import { requireTenantMembership } from '../middleware/require-tenant.js';

export const auditRouter = new Hono<{ Variables: AppVariables }>();

auditRouter.use('/:tenantId/audit*', requireAuth);
auditRouter.use('/:tenantId/audit*', requireTenantMembership);

auditRouter.get('/:tenantId/audit', async (c) => {
  const tenantId = c.req.param('tenantId');
  const user = c.get('user');
  const db = c.get('supabaseClient');

  const allowed = await hasPermission(db, {
    userId: user.id,
    tenantId,
    permission: 'audit.view',
  });

  if (!allowed) {
    throw new PermissionDeniedError();
  }

  const limit = Math.min(Number(c.req.query('limit') ?? 50), 200);
  const { data, error } = await db
    .from('audit_events')
    .select(
      'id, actor_user_id, actor_type, action, entity_type, entity_id, created_at',
    )
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    throw error;
  }

  return c.json({ events: data ?? [] });
});
