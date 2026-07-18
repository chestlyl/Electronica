-- ============================================================
-- Migration 0009: Platform Administrator Model
--
-- Decision: create new migration rather than editing 0006_rls_helpers.sql
-- because the Layer 1 dev branch has been run in at least one local
-- environment (the Copilot agent sandbox). New migrations are the safe
-- additive path and preserve auditability.
--
-- Replaces the unsafe user_is_platform_admin() implementation that relied
-- on tenant_memberships with a null tenant role — a model that allowed any
-- church tenant administrator to potentially elevate a user to platform
-- access by assigning a role with the right slug.
--
-- New model:
--   platform_admins(id, user_id, granted_by, notes, is_active, revoked_at)
--   - Completely separate from tenant memberships and roles.
--   - Only an existing platform admin (or the service role during bootstrap)
--     can insert rows.
--   - user_is_platform_admin() is replaced to query this table.
--   - SECURITY DEFINER bypasses RLS on platform_admins, preventing recursion.
-- ============================================================

-- ── 1. Create platform_admins table ──────────────────────────────────────
create table if not exists platform_admins (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null unique references auth.users(id) on delete cascade,
  granted_by  uuid references auth.users(id) on delete set null,
  notes       text,
  is_active   boolean not null default true,
  revoked_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index on platform_admins (user_id);
create index on platform_admins (is_active) where is_active = true;

-- ── 2. Enable RLS ─────────────────────────────────────────────────────────
alter table platform_admins enable row level security;

-- Each user can see their own record (e.g. to check their own status).
-- Full table access is via the SECURITY DEFINER helper below.
create policy "platform_admins_select_own"
  on platform_admins for select
  using (user_id = auth.uid());

-- Only platform admins can grant platform access.
-- user_is_platform_admin() is SECURITY DEFINER so it bypasses RLS when
-- querying platform_admins, preventing infinite recursion.
create policy "platform_admins_insert"
  on platform_admins for insert
  with check (user_is_platform_admin());

-- Only platform admins can revoke platform access.
create policy "platform_admins_update"
  on platform_admins for update
  using (user_is_platform_admin());

-- ── 3. Replace user_is_platform_admin() ──────────────────────────────────
-- The previous implementation (0006) checked for a role with
-- slug='platform-admin' and tenant_id=null in tenant_memberships.
-- That model is unsafe: a church admin could create such a role.
-- The new implementation queries the dedicated platform_admins table.
create or replace function user_is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from platform_admins pa
    where pa.user_id    = auth.uid()
      and pa.is_active  = true
      and pa.revoked_at is null
  );
$$;

-- ── 4. updated_at trigger ─────────────────────────────────────────────────
create trigger set_updated_at
  before update on platform_admins
  for each row execute function set_updated_at();
