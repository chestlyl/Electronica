import type { SupabaseClient, User } from '@supabase/supabase-js';
import {
  AuthenticationRequiredError,
  TenantMembershipRequiredError,
} from '@ee/domain';
import type { TenantMembership } from '@ee/domain';

export async function requireUser(client: SupabaseClient): Promise<User> {
  const {
    data: { user },
    error,
  } = await client.auth.getUser();
  if (error || !user) {
    throw new AuthenticationRequiredError();
  }
  return user;
}

export async function requireTenantMembership(
  client: SupabaseClient,
  userId: string,
  tenantId: string,
): Promise<TenantMembership> {
  const { data, error } = await client
    .from('tenant_memberships')
    .select('*')
    .eq('user_id', userId)
    .eq('tenant_id', tenantId)
    .eq('status', 'active')
    .single();

  if (error || !data) {
    throw new TenantMembershipRequiredError(
      `User ${userId} does not have active membership in tenant ${tenantId}`,
    );
  }

  return {
    id: data.id as string,
    tenantId: data.tenant_id as string,
    userId: data.user_id as string,
    status: data.status as TenantMembership['status'],
    joinedAt: data.joined_at as string | null,
    createdAt: data.created_at as string,
    updatedAt: data.updated_at as string,
  };
}
