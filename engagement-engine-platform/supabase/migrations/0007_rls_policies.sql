-- ============================================================
-- Row-Level Security policies for all tenant-owned tables
-- ============================================================

alter table tenants                 enable row level security;
alter table tenant_domains          enable row level security;
alter table tenant_settings         enable row level security;
alter table campuses                enable row level security;
alter table ministries              enable row level security;
alter table user_profiles           enable row level security;
alter table people                  enable row level security;
alter table households              enable row level security;
alter table household_members       enable row level security;
alter table tenant_memberships      enable row level security;
alter table roles                   enable row level security;
alter table permissions             enable row level security;
alter table role_permissions        enable row level security;
alter table role_assignments        enable row level security;
alter table invitations             enable row level security;
alter table audit_events            enable row level security;
alter table feature_flags           enable row level security;
alter table tenant_feature_flags    enable row level security;
alter table integration_connections enable row level security;

-- ── tenants ──────────────────────────────────────────────────────────────
create policy "tenants_select_member"
  on tenants for select
  using (user_belongs_to_tenant(id));

create policy "tenants_insert_platform_admin"
  on tenants for insert
  with check (user_is_platform_admin());

create policy "tenants_update_manage"
  on tenants for update
  using (user_has_permission(id, 'tenant.manage'))
  with check (user_has_permission(id, 'tenant.manage'));

-- ── tenant_domains ───────────────────────────────────────────────────────
create policy "tenant_domains_select"
  on tenant_domains for select
  using (user_belongs_to_tenant(tenant_id));

create policy "tenant_domains_insert"
  on tenant_domains for insert
  with check (user_has_permission(tenant_id, 'tenant.manage'));

create policy "tenant_domains_update"
  on tenant_domains for update
  using (user_has_permission(tenant_id, 'tenant.manage'));

-- ── tenant_settings ──────────────────────────────────────────────────────
create policy "tenant_settings_select"
  on tenant_settings for select
  using (user_belongs_to_tenant(tenant_id) and user_has_permission(tenant_id, 'settings.view'));

create policy "tenant_settings_upsert"
  on tenant_settings for insert
  with check (user_has_permission(tenant_id, 'settings.manage'));

create policy "tenant_settings_update"
  on tenant_settings for update
  using (user_has_permission(tenant_id, 'settings.manage'));

-- ── campuses ─────────────────────────────────────────────────────────────
create policy "campuses_select"
  on campuses for select
  using (user_belongs_to_tenant(tenant_id));

create policy "campuses_insert"
  on campuses for insert
  with check (user_has_permission(tenant_id, 'tenant.manage'));

create policy "campuses_update"
  on campuses for update
  using (user_has_permission(tenant_id, 'tenant.manage'));

-- ── ministries ───────────────────────────────────────────────────────────
create policy "ministries_select"
  on ministries for select
  using (user_belongs_to_tenant(tenant_id));

create policy "ministries_insert"
  on ministries for insert
  with check (user_has_permission(tenant_id, 'tenant.manage'));

create policy "ministries_update"
  on ministries for update
  using (user_has_permission(tenant_id, 'tenant.manage'));

-- ── user_profiles ────────────────────────────────────────────────────────
create policy "user_profiles_select_own"
  on user_profiles for select
  using (user_id = auth.uid());

create policy "user_profiles_insert_own"
  on user_profiles for insert
  with check (user_id = auth.uid());

create policy "user_profiles_update_own"
  on user_profiles for update
  using (user_id = auth.uid());

-- ── people ───────────────────────────────────────────────────────────────
create policy "people_select"
  on people for select
  using (user_has_permission(tenant_id, 'people.view'));

create policy "people_insert"
  on people for insert
  with check (user_has_permission(tenant_id, 'people.create'));

create policy "people_update"
  on people for update
  using (user_has_permission(tenant_id, 'people.update'));

create policy "people_archive"
  on people for delete
  using (user_has_permission(tenant_id, 'people.archive'));

-- ── households ───────────────────────────────────────────────────────────
create policy "households_select"
  on households for select
  using (user_has_permission(tenant_id, 'households.view'));

create policy "households_insert"
  on households for insert
  with check (user_has_permission(tenant_id, 'households.create'));

create policy "households_update"
  on households for update
  using (user_has_permission(tenant_id, 'households.update'));

-- ── household_members ────────────────────────────────────────────────────
create policy "household_members_select"
  on household_members for select
  using (user_has_permission(tenant_id, 'households.view'));

create policy "household_members_insert"
  on household_members for insert
  with check (user_has_permission(tenant_id, 'households.create'));

create policy "household_members_update"
  on household_members for update
  using (user_has_permission(tenant_id, 'households.update'));

-- ── tenant_memberships ───────────────────────────────────────────────────
create policy "tenant_memberships_select"
  on tenant_memberships for select
  using (
    user_id = auth.uid()
    or user_has_permission(tenant_id, 'memberships.view')
  );

create policy "tenant_memberships_insert"
  on tenant_memberships for insert
  with check (user_has_permission(tenant_id, 'memberships.manage'));

create policy "tenant_memberships_update"
  on tenant_memberships for update
  using (user_has_permission(tenant_id, 'memberships.manage'));

-- ── roles ────────────────────────────────────────────────────────────────
create policy "roles_select"
  on roles for select
  using (
    tenant_id is null
    or user_has_permission(tenant_id, 'roles.view')
  );

create policy "roles_insert"
  on roles for insert
  with check (
    tenant_id is not null
    and user_has_permission(tenant_id, 'roles.manage')
  );

create policy "roles_update"
  on roles for update
  using (
    tenant_id is not null
    and user_has_permission(tenant_id, 'roles.manage')
  );

-- ── permissions ──────────────────────────────────────────────────────────
create policy "permissions_select"
  on permissions for select
  using (auth.uid() is not null);

create policy "permissions_insert_service"
  on permissions for insert
  with check (false);

-- ── role_permissions ─────────────────────────────────────────────────────
create policy "role_permissions_select"
  on role_permissions for select
  using (
    exists (
      select 1 from roles r
      where r.id = role_id
        and (r.tenant_id is null or user_belongs_to_tenant(r.tenant_id))
    )
  );

-- ── role_assignments ─────────────────────────────────────────────────────
create policy "role_assignments_select"
  on role_assignments for select
  using (
    user_has_permission(tenant_id, 'roles.view')
    or exists (
      select 1 from tenant_memberships tm
      where tm.id = membership_id and tm.user_id = auth.uid()
    )
  );

create policy "role_assignments_insert"
  on role_assignments for insert
  with check (user_has_permission(tenant_id, 'roles.manage'));

create policy "role_assignments_update"
  on role_assignments for update
  using (user_has_permission(tenant_id, 'roles.manage'));

-- ── invitations ──────────────────────────────────────────────────────────
create policy "invitations_select"
  on invitations for select
  using (user_has_permission(tenant_id, 'invitations.create'));

create policy "invitations_insert"
  on invitations for insert
  with check (user_has_permission(tenant_id, 'invitations.create'));

-- ── audit_events ─────────────────────────────────────────────────────────
create policy "audit_events_select"
  on audit_events for select
  using (
    (tenant_id is null and user_is_platform_admin())
    or (tenant_id is not null and user_has_permission(tenant_id, 'audit.view'))
  );

create policy "audit_events_insert"
  on audit_events for insert
  with check (false);

-- ── feature_flags ────────────────────────────────────────────────────────
create policy "feature_flags_select"
  on feature_flags for select
  using (auth.uid() is not null);

-- ── tenant_feature_flags ─────────────────────────────────────────────────
create policy "tenant_feature_flags_select"
  on tenant_feature_flags for select
  using (user_belongs_to_tenant(tenant_id));

create policy "tenant_feature_flags_upsert"
  on tenant_feature_flags for insert
  with check (user_has_permission(tenant_id, 'settings.manage'));

-- ── integration_connections ─────────────────────────────────────────────
create policy "integration_connections_select"
  on integration_connections for select
  using (user_has_permission(tenant_id, 'integrations.view'));

create policy "integration_connections_insert"
  on integration_connections for insert
  with check (user_has_permission(tenant_id, 'integrations.manage'));

create policy "integration_connections_update"
  on integration_connections for update
  using (user_has_permission(tenant_id, 'integrations.manage'));
