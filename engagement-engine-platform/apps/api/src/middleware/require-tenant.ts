import type { Context, Next } from 'hono';
import type { AppVariables } from '../types.js';

type AppContext = Context<{ Variables: AppVariables }>;
import { TenantMembershipRequiredError } from '@ee/domain';

export async function requireTenantMembership(c: AppContext, next: Next) {
  const tenantId = c.req.param('tenantId');
  const user = c.get('user');
  const db = c.get('supabaseClient');

  if (!tenantId || !user || !db) {
    throw new TenantMembershipRequiredError();
  }

  const { data: membership } = await db
    .from('tenant_memberships')
    .select('id, status')
    .eq('tenant_id', tenantId)
    .eq('user_id', user.id)
    .eq('status', 'active')
    .maybeSingle();

  if (!membership) {
    throw new TenantMembershipRequiredError(
      `No active membership in tenant ${tenantId}`,
    );
  }

  c.set('membership', membership);
  await next();
}
