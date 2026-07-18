-- ============================================================
-- updated_at auto-update trigger
-- ============================================================

create or replace function set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'tenants',
    'tenant_domains',
    'tenant_settings',
    'campuses',
    'ministries',
    'user_profiles',
    'people',
    'households',
    'household_members',
    'tenant_memberships',
    'roles',
    'feature_flags',
    'tenant_feature_flags',
    'integration_connections'
  ] loop
    execute format(
      'create trigger set_updated_at before update on %I
       for each row execute function set_updated_at()',
      tbl
    );
  end loop;
end;
$$;
