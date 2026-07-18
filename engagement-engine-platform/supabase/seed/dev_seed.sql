-- ============================================================
-- Development seed data
-- DO NOT run in production.
-- ============================================================

-- Platform permissions
insert into permissions (key, description, sensitivity_level) values
  ('tenant.view',           'View tenant information',              'internal'),
  ('tenant.manage',         'Manage tenant settings and structure', 'restricted'),
  ('people.view',           'View people records',                  'internal'),
  ('people.create',         'Create people records',                'internal'),
  ('people.update',         'Update people records',                'internal'),
  ('people.archive',        'Archive people records',               'restricted'),
  ('households.view',       'View households',                      'internal'),
  ('households.create',     'Create households',                    'internal'),
  ('households.update',     'Update households',                    'internal'),
  ('memberships.view',      'View memberships',                     'internal'),
  ('memberships.manage',    'Manage memberships',                   'restricted'),
  ('roles.view',            'View roles and assignments',           'internal'),
  ('roles.manage',          'Manage roles and assignments',         'restricted'),
  ('permissions.view',      'View permission catalog',              'internal'),
  ('invitations.create',    'Create invitations',                   'restricted'),
  ('audit.view',            'View audit events',                    'sensitive'),
  ('integrations.view',     'View integration connections',         'restricted'),
  ('integrations.manage',   'Manage integration connections',       'sensitive'),
  ('settings.view',         'View tenant settings',                 'internal'),
  ('settings.manage',       'Manage tenant settings',               'restricted')
on conflict (key) do nothing;

-- ── Tenant 1: Cornerstone Church ─────────────────────────────────────────
insert into tenants (id, name, slug, status, timezone, default_currency)
values (
  '11111111-1111-1111-1111-111111111111',
  'Cornerstone Church',
  'cornerstone-akron',
  'pilot',
  'America/New_York',
  'USD'
) on conflict (slug) do nothing;

insert into tenant_settings (tenant_id, settings)
values (
  '11111111-1111-1111-1111-111111111111',
  '{"city": "Akron", "state": "Ohio", "pilotStarted": true}'
) on conflict (tenant_id) do nothing;

-- Cornerstone campus
insert into campuses (id, tenant_id, name, slug, timezone, status, city, state, country)
values (
  'cc111111-1111-1111-1111-111111111111',
  '11111111-1111-1111-1111-111111111111',
  'Cornerstone Main Campus',
  'main',
  'America/New_York',
  'active',
  'Akron',
  'OH',
  'US'
) on conflict (tenant_id, slug) do nothing;

-- Cornerstone ministry (org-wide)
insert into ministries (id, tenant_id, campus_id, name, slug, status)
values (
  'cd111111-1111-1111-1111-111111111111',
  '11111111-1111-1111-1111-111111111111',
  null,
  'General Ministry',
  'general',
  'active'
) on conflict (tenant_id, slug) do nothing;

-- Cornerstone roles
insert into roles (id, tenant_id, name, slug, description, is_system_role) values
  ('ce111111-1111-1111-1111-111111111111',
   '11111111-1111-1111-1111-111111111111',
   'Administrator', 'admin',
   'Full administrative access to the tenant', true),
  ('ce222222-2222-2222-2222-222222222222',
   '11111111-1111-1111-1111-111111111111',
   'Member', 'member',
   'Basic member access', true)
on conflict (tenant_id, slug) do nothing;

-- Assign all permissions to Administrator role
insert into role_permissions (role_id, permission_id)
select 'ce111111-1111-1111-1111-111111111111', id from permissions
on conflict do nothing;

-- Assign read permissions to Member role
insert into role_permissions (role_id, permission_id)
select 'ce222222-2222-2222-2222-222222222222', id
from permissions
where key in ('tenant.view', 'people.view', 'households.view', 'memberships.view', 'roles.view', 'settings.view')
on conflict do nothing;

-- Fictional Cornerstone people (no real members)
insert into people (id, tenant_id, first_name, last_name, email, status, primary_campus_id) values
  ('ca111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111',
   'James', 'Whitfield', 'james.whitfield@example.invalid', 'active', 'cc111111-1111-1111-1111-111111111111'),
  ('ca222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111',
   'Sarah', 'Moreau', 'sarah.moreau@example.invalid', 'active', 'cc111111-1111-1111-1111-111111111111'),
  ('ca333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111',
   'David', 'Okafor', 'david.okafor@example.invalid', 'active', 'cc111111-1111-1111-1111-111111111111'),
  ('ca444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111',
   'Rachel', 'Kim', 'rachel.kim@example.invalid', 'active', 'cc111111-1111-1111-1111-111111111111')
on conflict do nothing;

-- Fictional Cornerstone households
insert into households (id, tenant_id, name, primary_campus_id) values
  ('cb111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111',
   'Whitfield Household', 'cc111111-1111-1111-1111-111111111111'),
  ('cb222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111',
   'Okafor Household', 'cc111111-1111-1111-1111-111111111111')
on conflict do nothing;

insert into household_members (tenant_id, household_id, person_id, relationship_type, is_primary_contact) values
  ('11111111-1111-1111-1111-111111111111',
   'cb111111-1111-1111-1111-111111111111',
   'ca111111-1111-1111-1111-111111111111',
   'head', true),
  ('11111111-1111-1111-1111-111111111111',
   'cb111111-1111-1111-1111-111111111111',
   'ca222222-2222-2222-2222-222222222222',
   'spouse', false),
  ('11111111-1111-1111-1111-111111111111',
   'cb222222-2222-2222-2222-222222222222',
   'ca333333-3333-3333-3333-333333333333',
   'head', true),
  ('11111111-1111-1111-1111-111111111111',
   'cb222222-2222-2222-2222-222222222222',
   'ca444444-4444-4444-4444-444444444444',
   'adult', false)
on conflict do nothing;

-- ── Tenant 2: Test Church (development/test only) ───────────────────────
insert into tenants (id, name, slug, status, timezone, default_currency)
values (
  '22222222-2222-2222-2222-222222222222',
  'Test Church',
  'test-church',
  'active',
  'America/Chicago',
  'USD'
) on conflict (slug) do nothing;

insert into tenant_settings (tenant_id, settings)
values (
  '22222222-2222-2222-2222-222222222222',
  '{"isTestTenant": true}'
) on conflict (tenant_id) do nothing;

-- Test church campus
insert into campuses (id, tenant_id, name, slug, timezone, status, city, state, country)
values (
  'dc111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  'Test Campus',
  'main',
  'America/Chicago',
  'active',
  'Test City',
  'IL',
  'US'
) on conflict (tenant_id, slug) do nothing;

-- Test Church roles
insert into roles (id, tenant_id, name, slug, description, is_system_role) values
  ('de111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222222',
   'Administrator', 'admin',
   'Full administrative access', true),
  ('de222222-2222-2222-2222-222222222222',
   '22222222-2222-2222-2222-222222222222',
   'Member', 'member',
   'Basic member access', true)
on conflict (tenant_id, slug) do nothing;

-- Assign all permissions to Test Church admin role
insert into role_permissions (role_id, permission_id)
select 'de111111-1111-1111-1111-111111111111', id from permissions
on conflict do nothing;

-- Test Church fictional people
insert into people (id, tenant_id, first_name, last_name, email, status, primary_campus_id) values
  ('da111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222',
   'Test', 'Admin', 'test.admin@example.invalid', 'active', 'dc111111-1111-1111-1111-111111111111'),
  ('da222222-2222-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222',
   'Test', 'Member', 'test.member@example.invalid', 'active', 'dc111111-1111-1111-1111-111111111111'),
  ('da333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222',
   'Alice', 'TestPerson', 'alice.test@example.invalid', 'active', 'dc111111-1111-1111-1111-111111111111')
on conflict do nothing;

-- Test Church household
insert into households (id, tenant_id, name, primary_campus_id) values
  ('db111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222',
   'Test Household', 'dc111111-1111-1111-1111-111111111111')
on conflict do nothing;

insert into household_members (tenant_id, household_id, person_id, relationship_type, is_primary_contact) values
  ('22222222-2222-2222-2222-222222222222',
   'db111111-1111-1111-1111-111111111111',
   'da111111-1111-1111-1111-111111111111',
   'head', true),
  ('22222222-2222-2222-2222-222222222222',
   'db111111-1111-1111-1111-111111111111',
   'da222222-2222-2222-2222-222222222222',
   'adult', false)
on conflict do nothing;
