import { createClient } from '@supabase/supabase-js';

interface TenantInfo {
  id: string;
  name: string;
  slug: string;
  status: string;
}

export async function resolveTenantByHostname(hostname: string): Promise<TenantInfo | null> {
  const supabaseUrl = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const serviceKey = process.env['SUPABASE_SERVICE_ROLE_KEY'];

  if (!supabaseUrl || !serviceKey) {
    return null;
  }

  const client = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data } = await client
    .from('tenant_domains')
    .select('tenant_id, tenants(id, name, slug, status)')
    .eq('hostname', hostname)
    .eq('verification_status', 'verified')
    .maybeSingle();

  if (!data?.tenants) return null;
  // Supabase types the join as array; in practice it's a single record
  const raw = data.tenants as unknown as TenantInfo | TenantInfo[];
  return Array.isArray(raw) ? (raw[0] ?? null) : raw;
}

export async function resolveTenantBySlug(slug: string): Promise<TenantInfo | null> {
  const supabaseUrl = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const serviceKey = process.env['SUPABASE_SERVICE_ROLE_KEY'];

  if (!supabaseUrl || !serviceKey) {
    return null;
  }

  const client = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data } = await client
    .from('tenants')
    .select('id, name, slug, status')
    .eq('slug', slug)
    .in('status', ['active', 'pilot', 'trial'])
    .maybeSingle();

  return (data as TenantInfo | null) ?? null;
}
