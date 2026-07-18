-- ============================================================
-- RLS helper functions
-- These are SECURITY DEFINER and must have a fixed search_path.
-- ============================================================

-- Returns the current authenticated user's UUID from the JWT
create or replace function auth_user_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid();
$$;

-- Returns true if the current user has an active membership in the given tenant
create or replace function user_belongs_to_tenant(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from tenant_memberships tm
    where tm.tenant_id = p_tenant_id
      and tm.user_id   = auth.uid()
      and tm.status    = 'active'
  );
$$;

-- Returns true if the current user holds a role with the given permission key
-- within the given tenant (with optional campus/ministry scope)
create or replace function user_has_permission(
  p_tenant_id   uuid,
  p_permission  text,
  p_campus_id   uuid default null,
  p_ministry_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from tenant_memberships     tm
    join role_assignments        ra on ra.membership_id = tm.id
    join role_permissions        rp on rp.role_id       = ra.role_id
    join permissions             pe on pe.id            = rp.permission_id
    where tm.tenant_id = p_tenant_id
      and tm.user_id   = auth.uid()
      and tm.status    = 'active'
      and pe.key       = p_permission
      and ra.revoked_at is null
      and (ra.expires_at is null or ra.expires_at > now())
      and (
        (ra.campus_id is null and ra.ministry_id is null)
        or (p_campus_id   is not null and ra.campus_id   = p_campus_id)
        or (p_ministry_id is not null and ra.ministry_id = p_ministry_id)
      )
  );
$$;

-- Returns true if current user has an active campus-scoped or tenant-wide role
-- that grants access to the given campus
create or replace function user_has_campus_access(p_campus_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from campuses c
    where c.id = p_campus_id
      and user_belongs_to_tenant(c.tenant_id)
  );
$$;

-- Returns true if the current user has an active ministry-scoped or tenant-wide
-- role granting access to the given ministry
create or replace function user_has_ministry_access(p_ministry_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from ministries m
    where m.id = p_ministry_id
      and user_belongs_to_tenant(m.tenant_id)
  );
$$;

-- Returns true if the current user is a platform administrator
-- (role slug = 'platform-admin' with null tenant_id)
create or replace function user_is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from tenant_memberships tm
    join role_assignments   ra on ra.membership_id = tm.id
    join roles              r  on r.id             = ra.role_id
    where tm.user_id     = auth.uid()
      and r.slug         = 'platform-admin'
      and r.tenant_id    is null
      and ra.revoked_at  is null
      and (ra.expires_at is null or ra.expires_at > now())
  );
$$;
