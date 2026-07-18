-- ============================================================
-- Development seed data  (DO NOT run in production)
-- ============================================================
-- Passwords below are fixed dev-only values committed intentionally
-- because this file is explicitly marked development-only.
-- They use fictional .invalid email addresses.
-- Never use these credentials or UUIDs in any production environment.
-- ============================================================

-- Platform permissions
insert into permissions (key, description, sensitivity_level) values
  ('tenant.view',           'View tenant information',              'internal'),
  ('tenant.manage',         'Manage tenant settings and structure', 'restricted'),
  ('people.view',           'View people records (administrative)', 'internal'),
  ('people.create',         'Create people records',                'internal'),
  ('people.update',         'Update people records',                'internal'),
  ('people.archive',        'Archive people records',               'restricted'),
  ('households.view',       'View households (administrative)',      'internal'),
  ('households.create',     'Create households',                    'internal'),
  ('households.update',     'Update households',                    'internal'),
  ('memberships.view',      'View memberships (administrative)',     'internal'),
  ('memberships.manage',    'Manage memberships',                   'restricted'),
  ('roles.view',            'View roles and assignments',           'internal'),
  ('roles.manage',          'Manage roles and assignments',         'restricted'),
  ('permissions.view',      'View permission catalog',              'internal'),
  ('invitations.create',    'Create invitations',                   'restricted'),
  ('audit.view',            'View audit events',                    'sensitive'),
  ('integrations.view',     'View integration connections',         'restricted'),
  ('integrations.manage',   'Manage integration connections',       'sensitive'),
  ('settings.view',         'View tenant settings (administrative)','internal'),
  ('settings.manage',       'Manage tenant settings',               'restricted'),
  -- Fine-grained member permissions (replace overbroad admin access)
  ('member.self_access',
   'Access own tenant membership and future member shell',          'internal'),
  ('member.directory',
   'Future: access privacy-gated member directory',                 'internal')
on conflict (key) do nothing;

-- ══════════════════════════════════════════════════════════════
-- Auth test users
-- Fixed UUIDs and dev-only passwords. All emails use .invalid TLD.
-- ══════════════════════════════════════════════════════════════

-- Cornerstone admin
insert into auth.users (
  id, instance_id, aud, role,
  email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data,
  is_super_admin, created_at, updated_at,
  confirmation_token, recovery_token
) values (
  'aa000001-0000-0000-0000-000000000001'::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated', 'authenticated',
  'cs.admin@example.invalid',
  crypt('Dev-Only-Admin-2026!', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}', '{}',
  false, now(), now(), '', ''
) on conflict (id) do nothing;

insert into auth.identities (id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
values (
  'aa000001-0000-0000-0000-000000000001'::uuid,
  'aa000001-0000-0000-0000-000000000001'::uuid,
  '{"sub":"aa000001-0000-0000-0000-000000000001","email":"cs.admin@example.invalid"}',
  'email', now(), now(), now()
) on conflict (id) do nothing;

-- Cornerstone member
insert into auth.users (
  id, instance_id, aud, role,
  email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data,
  is_super_admin, created_at, updated_at,
  confirmation_token, recovery_token
) values (
  'aa000002-0000-0000-0000-000000000002'::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated', 'authenticated',
  'cs.member@example.invalid',
  crypt('Dev-Only-Member-2026!', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}', '{}',
  false, now(), now(), '', ''
) on conflict (id) do nothing;

insert into auth.identities (id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
values (
  'aa000002-0000-0000-0000-000000000002'::uuid,
  'aa000002-0000-0000-0000-000000000002'::uuid,
  '{"sub":"aa000002-0000-0000-0000-000000000002","email":"cs.member@example.invalid"}',
  'email', now(), now(), now()
) on conflict (id) do nothing;

-- Cornerstone Campus A administrator
insert into auth.users (
  id, instance_id, aud, role,
  email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data,
  is_super_admin, created_at, updated_at,
  confirmation_token, recovery_token
) values (
  'aa000003-0000-0000-0000-000000000003'::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated', 'authenticated',
  'cs.campus-a-admin@example.invalid',
  crypt('Dev-Only-CampusA-2026!', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}', '{}',
  false, now(), now(), '', ''
) on conflict (id) do nothing;

insert into auth.identities (id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
values (
  'aa000003-0000-0000-0000-000000000003'::uuid,
  'aa000003-0000-0000-0000-000000000003'::uuid,
  '{"sub":"aa000003-0000-0000-0000-000000000003","email":"cs.campus-a-admin@example.invalid"}',
  'email', now(), now(), now()
) on conflict (id) do nothing;

-- Cornerstone Campus B restricted user (scoped to Campus B only)
insert into auth.users (
  id, instance_id, aud, role,
  email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data,
  is_super_admin, created_at, updated_at,
  confirmation_token, recovery_token
) values (
  'aa000004-0000-0000-0000-000000000004'::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated', 'authenticated',
  'cs.campus-b-user@example.invalid',
  crypt('Dev-Only-CampusB-2026!', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}', '{}',
  false, now(), now(), '', ''
) on conflict (id) do nothing;

insert into auth.identities (id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
values (
  'aa000004-0000-0000-0000-000000000004'::uuid,
  'aa000004-0000-0000-0000-000000000004'::uuid,
  '{"sub":"aa000004-0000-0000-0000-000000000004","email":"cs.campus-b-user@example.invalid"}',
  'email', now(), now(), now()
) on conflict (id) do nothing;

-- Cornerstone ministry-scoped leader
insert into auth.users (
  id, instance_id, aud, role,
  email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data,
  is_super_admin, created_at, updated_at,
  confirmation_token, recovery_token
) values (
  'aa000005-0000-0000-0000-000000000005'::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated', 'authenticated',
  'cs.ministry-leader@example.invalid',
  crypt('Dev-Only-Ministry-2026!', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}', '{}',
  false, now(), now(), '', ''
) on conflict (id) do nothing;

insert into auth.identities (id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
values (
  'aa000005-0000-0000-0000-000000000005'::uuid,
  'aa000005-0000-0000-0000-000000000005'::uuid,
  '{"sub":"aa000005-0000-0000-0000-000000000005","email":"cs.ministry-leader@example.invalid"}',
  'email', now(), now(), now()
) on conflict (id) do nothing;

-- Suspended Cornerstone user
insert into auth.users (
  id, instance_id, aud, role,
  email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data,
  is_super_admin, created_at, updated_at,
  confirmation_token, recovery_token
) values (
  'aa000006-0000-0000-0000-000000000006'::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated', 'authenticated',
  'cs.suspended@example.invalid',
  crypt('Dev-Only-Suspended-2026!', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}', '{}',
  false, now(), now(), '', ''
) on conflict (id) do nothing;

insert into auth.identities (id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
values (
  'aa000006-0000-0000-0000-000000000006'::uuid,
  'aa000006-0000-0000-0000-000000000006'::uuid,
  '{"sub":"aa000006-0000-0000-0000-000000000006","email":"cs.suspended@example.invalid"}',
  'email', now(), now(), now()
) on conflict (id) do nothing;

-- Test Church admin
insert into auth.users (
  id, instance_id, aud, role,
  email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data,
  is_super_admin, created_at, updated_at,
  confirmation_token, recovery_token
) values (
  'bb000001-0000-0000-0000-000000000001'::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated', 'authenticated',
  'tc.admin@example.invalid',
  crypt('Dev-Only-TCA-2026!', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}', '{}',
  false, now(), now(), '', ''
) on conflict (id) do nothing;

insert into auth.identities (id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
values (
  'bb000001-0000-0000-0000-000000000001'::uuid,
  'bb000001-0000-0000-0000-000000000001'::uuid,
  '{"sub":"bb000001-0000-0000-0000-000000000001","email":"tc.admin@example.invalid"}',
  'email', now(), now(), now()
) on conflict (id) do nothing;

-- Test Church member
insert into auth.users (
  id, instance_id, aud, role,
  email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data,
  is_super_admin, created_at, updated_at,
  confirmation_token, recovery_token
) values (
  'bb000002-0000-0000-0000-000000000002'::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated', 'authenticated',
  'tc.member@example.invalid',
  crypt('Dev-Only-TCM-2026!', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}', '{}',
  false, now(), now(), '', ''
) on conflict (id) do nothing;

insert into auth.identities (id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
values (
  'bb000002-0000-0000-0000-000000000002'::uuid,
  'bb000002-0000-0000-0000-000000000002'::uuid,
  '{"sub":"bb000002-0000-0000-0000-000000000002","email":"tc.member@example.invalid"}',
  'email', now(), now(), now()
) on conflict (id) do nothing;

-- Platform administrator
insert into auth.users (
  id, instance_id, aud, role,
  email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data,
  is_super_admin, created_at, updated_at,
  confirmation_token, recovery_token
) values (
  'cc000001-0000-0000-0000-000000000001'::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated', 'authenticated',
  'platform.admin@example.invalid',
  crypt('Dev-Only-Platform-2026!', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}', '{}',
  false, now(), now(), '', ''
) on conflict (id) do nothing;

insert into auth.identities (id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
values (
  'cc000001-0000-0000-0000-000000000001'::uuid,
  'cc000001-0000-0000-0000-000000000001'::uuid,
  '{"sub":"cc000001-0000-0000-0000-000000000001","email":"platform.admin@example.invalid"}',
  'email', now(), now(), now()
) on conflict (id) do nothing;

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

-- Cornerstone Campus A (Main Campus)
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

-- Cornerstone Campus B (for scope-isolation testing)
insert into campuses (id, tenant_id, name, slug, timezone, status, city, state, country)
values (
  'cc222222-2222-2222-2222-222222222222',
  '11111111-1111-1111-1111-111111111111',
  'Cornerstone East Campus',
  'east',
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

-- Cornerstone second ministry (for ministry-scope testing)
insert into ministries (id, tenant_id, campus_id, name, slug, status)
values (
  'cd222222-2222-2222-2222-222222222222',
  '11111111-1111-1111-1111-111111111111',
  'cc111111-1111-1111-1111-111111111111',
  'Youth Ministry',
  'youth',
  'active'
) on conflict (tenant_id, slug) do nothing;

-- Cornerstone roles
insert into roles (id, tenant_id, name, slug, description, is_system_role) values
  ('ce111111-1111-1111-1111-111111111111',
   '11111111-1111-1111-1111-111111111111',
   'Administrator', 'admin',
   'Full administrative access to the tenant. Can manage people, households, memberships, roles, settings, and integrations.', true),
  ('ce222222-2222-2222-2222-222222222222',
   '11111111-1111-1111-1111-111111111111',
   'Member', 'member',
   'Ordinary member. Can access own membership record and the future member shell only. Does not have administrative access to other members'' records, households, settings, or roles.', true),
  ('ce333333-3333-3333-3333-333333333333',
   '11111111-1111-1111-1111-111111111111',
   'Campus Administrator', 'campus-admin',
   'Administrative access scoped to an assigned campus.', true)
on conflict (tenant_id, slug) do nothing;

-- Assign all permissions to Administrator role
insert into role_permissions (role_id, permission_id)
select 'ce111111-1111-1111-1111-111111111111', id from permissions
on conflict do nothing;

-- Member: ONLY member.self_access
-- people.view, households.view, memberships.view, roles.view, settings.view
-- are NOT granted — there is no privacy-aware directory system in Layer 1.
insert into role_permissions (role_id, permission_id)
select 'ce222222-2222-2222-2222-222222222222', id
from permissions
where key in ('member.self_access')
on conflict do nothing;

-- Campus Administrator: people/household/membership management (assigned with campus scope)
insert into role_permissions (role_id, permission_id)
select 'ce333333-3333-3333-3333-333333333333', id
from permissions
where key in (
  'people.view', 'people.create', 'people.update', 'people.archive',
  'households.view', 'households.create', 'households.update',
  'memberships.view', 'roles.view', 'invitations.create'
)
on conflict do nothing;

-- Fictional Cornerstone people (no real members)
-- Campus A people
insert into people (id, tenant_id, first_name, last_name, email, status, primary_campus_id) values
  ('ca111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111',
   'James', 'Whitfield', 'james.whitfield@example.invalid', 'active', 'cc111111-1111-1111-1111-111111111111'),
  ('ca222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111',
   'Sarah', 'Moreau', 'sarah.moreau@example.invalid', 'active', 'cc111111-1111-1111-1111-111111111111')
on conflict do nothing;

-- Campus B people (for campus-scope isolation testing)
insert into people (id, tenant_id, first_name, last_name, email, status, primary_campus_id) values
  ('ca333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111',
   'David', 'Okafor', 'david.okafor@example.invalid', 'active', 'cc222222-2222-2222-2222-222222222222'),
  ('ca444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111',
   'Rachel', 'Kim', 'rachel.kim@example.invalid', 'active', 'cc222222-2222-2222-2222-222222222222')
on conflict do nothing;

-- Fictional Cornerstone households
insert into households (id, tenant_id, name, primary_campus_id) values
  ('cb111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111',
   'Whitfield Household', 'cc111111-1111-1111-1111-111111111111'),
  ('cb222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111',
   'Okafor Household', 'cc222222-2222-2222-2222-222222222222')
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

-- Cornerstone user_profiles
insert into user_profiles (user_id, display_name)
values
  ('aa000001-0000-0000-0000-000000000001', 'CS Admin'),
  ('aa000002-0000-0000-0000-000000000002', 'CS Member'),
  ('aa000003-0000-0000-0000-000000000003', 'Campus A Admin'),
  ('aa000004-0000-0000-0000-000000000004', 'Campus B User'),
  ('aa000005-0000-0000-0000-000000000005', 'Ministry Leader'),
  ('aa000006-0000-0000-0000-000000000006', 'Suspended User')
on conflict (user_id) do nothing;

-- Cornerstone tenant_memberships
insert into tenant_memberships (id, tenant_id, user_id, status, joined_at) values
  ('tm100001-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'aa000001-0000-0000-0000-000000000001', 'active', now()),
  ('tm100002-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'aa000002-0000-0000-0000-000000000002', 'active', now()),
  ('tm100003-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
   'aa000003-0000-0000-0000-000000000003', 'active', now()),
  ('tm100004-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111',
   'aa000004-0000-0000-0000-000000000004', 'active', now()),
  ('tm100005-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111',
   'aa000005-0000-0000-0000-000000000005', 'active', now()),
  ('tm100006-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111',
   'aa000006-0000-0000-0000-000000000006', 'suspended', now())
on conflict (tenant_id, user_id) do nothing;

-- Cornerstone role_assignments
-- cs.admin → tenant-wide Administrator
insert into role_assignments (tenant_id, membership_id, role_id, campus_id, ministry_id)
values (
  '11111111-1111-1111-1111-111111111111',
  'tm100001-0000-0000-0000-000000000001',
  'ce111111-1111-1111-1111-111111111111',
  null, null
) on conflict do nothing;

-- cs.member → tenant-wide Member (member.self_access only)
insert into role_assignments (tenant_id, membership_id, role_id, campus_id, ministry_id)
values (
  '11111111-1111-1111-1111-111111111111',
  'tm100002-0000-0000-0000-000000000002',
  'ce222222-2222-2222-2222-222222222222',
  null, null
) on conflict do nothing;

-- campus-a-admin → Campus Administrator scoped to Campus A only
insert into role_assignments (tenant_id, membership_id, role_id, campus_id, ministry_id)
values (
  '11111111-1111-1111-1111-111111111111',
  'tm100003-0000-0000-0000-000000000003',
  'ce333333-3333-3333-3333-333333333333',
  'cc111111-1111-1111-1111-111111111111',
  null
) on conflict do nothing;

-- campus-b-user → Campus Administrator scoped to Campus B only
insert into role_assignments (tenant_id, membership_id, role_id, campus_id, ministry_id)
values (
  '11111111-1111-1111-1111-111111111111',
  'tm100004-0000-0000-0000-000000000004',
  'ce333333-3333-3333-3333-333333333333',
  'cc222222-2222-2222-2222-222222222222',
  null
) on conflict do nothing;

-- ministry-leader → campus-admin role scoped to Youth Ministry
insert into role_assignments (tenant_id, membership_id, role_id, campus_id, ministry_id)
values (
  '11111111-1111-1111-1111-111111111111',
  'tm100005-0000-0000-0000-000000000005',
  'ce333333-3333-3333-3333-333333333333',
  null,
  'cd222222-2222-2222-2222-222222222222'
) on conflict do nothing;

-- suspended user: member role but membership status = 'suspended'
insert into role_assignments (tenant_id, membership_id, role_id, campus_id, ministry_id)
values (
  '11111111-1111-1111-1111-111111111111',
  'tm100006-0000-0000-0000-000000000006',
  'ce222222-2222-2222-2222-222222222222',
  null, null
) on conflict do nothing;

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
   'Ordinary member — member.self_access only', true)
on conflict (tenant_id, slug) do nothing;

-- Assign all permissions to Test Church admin role
insert into role_permissions (role_id, permission_id)
select 'de111111-1111-1111-1111-111111111111', id from permissions
on conflict do nothing;

-- Test Church member: member.self_access only
insert into role_permissions (role_id, permission_id)
select 'de222222-2222-2222-2222-222222222222', id
from permissions where key = 'member.self_access'
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

-- Test Church auth user profiles, memberships, role assignments
insert into user_profiles (user_id, display_name)
values
  ('bb000001-0000-0000-0000-000000000001', 'TC Admin'),
  ('bb000002-0000-0000-0000-000000000002', 'TC Member')
on conflict (user_id) do nothing;

insert into tenant_memberships (id, tenant_id, user_id, status, joined_at) values
  ('tm200001-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
   'bb000001-0000-0000-0000-000000000001', 'active', now()),
  ('tm200002-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'bb000002-0000-0000-0000-000000000002', 'active', now())
on conflict (tenant_id, user_id) do nothing;

insert into role_assignments (tenant_id, membership_id, role_id, campus_id, ministry_id)
values
  ('22222222-2222-2222-2222-222222222222',
   'tm200001-0000-0000-0000-000000000001', 'de111111-1111-1111-1111-111111111111',
   null, null),
  ('22222222-2222-2222-2222-222222222222',
   'tm200002-0000-0000-0000-000000000002', 'de222222-2222-2222-2222-222222222222',
   null, null)
on conflict do nothing;

-- ══════════════════════════════════════════════════════════════
-- Platform administrator
-- Dev-only bootstrap. In production use production_bootstrap.sql.
-- ══════════════════════════════════════════════════════════════
insert into user_profiles (user_id, display_name)
values ('cc000001-0000-0000-0000-000000000001', 'Platform Admin')
on conflict (user_id) do nothing;

insert into platform_admins (user_id, notes)
values (
  'cc000001-0000-0000-0000-000000000001',
  'Development-only platform administrator — do not use in production'
)
on conflict (user_id) do nothing;
