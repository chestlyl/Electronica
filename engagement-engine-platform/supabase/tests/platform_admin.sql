-- ============================================================
-- Platform administrator RLS tests
-- Verifies the platform_admins table and user_is_platform_admin() function.
--
-- Run with: supabase test db
--
-- Identity reference (from dev_seed.sql):
--   cc000001  platform.admin    Platform administrator (platform_admins table)
--   aa000001  cs.admin          Cornerstone tenant-wide Administrator
--   bb000001  tc.admin          Test Church Administrator
-- ============================================================

begin;

select plan(21);

-- ══════════════════════════════════════════════════════════════
-- Section 1: user_is_platform_admin() correctness
-- ══════════════════════════════════════════════════════════════

-- 1. Valid platform admin satisfies user_is_platform_admin()
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"cc000001-0000-0000-0000-000000000001","aud":"authenticated","role":"authenticated","email":"platform.admin@example.invalid"}',
  true);

select ok(
  (select user_is_platform_admin()),
  'Platform admin: user_is_platform_admin() returns true'
);

-- 2. Cornerstone admin does NOT satisfy user_is_platform_admin()
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"aa000001-0000-0000-0000-000000000001","aud":"authenticated","role":"authenticated","email":"cs.admin@example.invalid"}',
  true);

select ok(
  not (select user_is_platform_admin()),
  'CS admin: user_is_platform_admin() returns false'
);

-- 3. Test Church admin does NOT satisfy user_is_platform_admin()
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"bb000001-0000-0000-0000-000000000001","aud":"authenticated","role":"authenticated","email":"tc.admin@example.invalid"}',
  true);

select ok(
  not (select user_is_platform_admin()),
  'TC admin: user_is_platform_admin() returns false'
);

-- 4. CS member does NOT satisfy user_is_platform_admin()
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"aa000002-0000-0000-0000-000000000002","aud":"authenticated","role":"authenticated","email":"cs.member@example.invalid"}',
  true);

select ok(
  not (select user_is_platform_admin()),
  'CS member: user_is_platform_admin() returns false'
);

-- 5. A tenant role named "platform-admin" does not grant platform authority
-- Verify: creating a tenant role with slug=platform-admin does NOT affect
-- user_is_platform_admin(), which queries platform_admins table, not roles.
-- (This is the critical security fix from migration 0009.)
set local role postgres;
insert into roles (id, tenant_id, name, slug, description, is_system_role)
values (
  'ffff0001-0000-0000-0000-000000000001',
  '11111111-1111-1111-1111-111111111111',
  'Platform Admin Impersonator', 'platform-admin',
  'Test: should NOT grant platform authority', false
) on conflict do nothing;

-- Assign this role to CS admin
insert into role_assignments (tenant_id, membership_id, role_id, campus_id, ministry_id)
values (
  '11111111-1111-1111-1111-111111111111',
  'ab100001-0000-0000-0000-000000000001',
  'ffff0001-0000-0000-0000-000000000001',
  null, null
) on conflict do nothing;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"aa000001-0000-0000-0000-000000000001","aud":"authenticated","role":"authenticated","email":"cs.admin@example.invalid"}',
  true);

select ok(
  not (select user_is_platform_admin()),
  'Tenant role slug=platform-admin does NOT grant platform authority'
);

-- Clean up impersonation test data
set local role postgres;
delete from role_assignments
where role_id = 'ffff0001-0000-0000-0000-000000000001';
delete from roles where id = 'ffff0001-0000-0000-0000-000000000001';

-- ══════════════════════════════════════════════════════════════
-- Section 2: platform_admins table access control
-- ══════════════════════════════════════════════════════════════

-- 6. Platform admin can see their own platform_admins row
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"cc000001-0000-0000-0000-000000000001","aud":"authenticated","role":"authenticated","email":"platform.admin@example.invalid"}',
  true);

select ok(
  exists(
    select 1 from platform_admins
    where user_id = 'cc000001-0000-0000-0000-000000000001'::uuid
  ),
  'Platform admin: can see own platform_admins row'
);

-- 7. CS admin cannot see the platform_admins table rows (not their user_id)
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"aa000001-0000-0000-0000-000000000001","aud":"authenticated","role":"authenticated","email":"cs.admin@example.invalid"}',
  true);

select is(
  (select count(*)::int from platform_admins),
  0,
  'CS admin: cannot read platform_admins (RLS blocks non-own rows)'
);

-- 8. CS admin cannot insert into platform_admins
select throws_ok(
  $$
    insert into platform_admins (user_id, notes)
    values (
      'aa000001-0000-0000-0000-000000000001',
      'Attempted elevation'
    )
  $$,
  null, null,
  'CS admin: cannot insert into platform_admins'
);

-- 9. TC admin cannot insert into platform_admins
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"bb000001-0000-0000-0000-000000000001","aud":"authenticated","role":"authenticated","email":"tc.admin@example.invalid"}',
  true);

select throws_ok(
  $$
    insert into platform_admins (user_id, notes)
    values (
      'bb000001-0000-0000-0000-000000000001',
      'Attempted elevation'
    )
  $$,
  null, null,
  'TC admin: cannot insert into platform_admins'
);

-- 10. CS member cannot insert into platform_admins
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"aa000002-0000-0000-0000-000000000002","aud":"authenticated","role":"authenticated","email":"cs.member@example.invalid"}',
  true);

select throws_ok(
  $$
    insert into platform_admins (user_id, notes)
    values (
      'aa000002-0000-0000-0000-000000000002',
      'Attempted elevation'
    )
  $$,
  null, null,
  'CS member: cannot insert into platform_admins'
);

-- 11. CS admin cannot update platform_admins (RLS filters rows; UPDATE affects 0 rows)
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"aa000001-0000-0000-0000-000000000001","aud":"authenticated","role":"authenticated","email":"cs.admin@example.invalid"}',
  true);

do $$
begin
  update platform_admins set notes = 'Hacked'
  where user_id = 'cc000001-0000-0000-0000-000000000001'::uuid;
end $$;

-- Verify via service role that the row was NOT changed
set local role postgres;
select isnt(
  (select notes from platform_admins
   where user_id = 'cc000001-0000-0000-0000-000000000001'::uuid),
  'Hacked',
  'CS admin: cannot update platform_admins'
);

-- ══════════════════════════════════════════════════════════════
-- Section 3: Platform admin removal revokes authority immediately
-- ══════════════════════════════════════════════════════════════

-- 12. Insert a temporary platform admin
set local role postgres;
insert into platform_admins (user_id, notes)
values (
  'aa000003-0000-0000-0000-000000000003',
  'Temporary platform admin for revocation test'
) on conflict (user_id) do update set is_active = true, revoked_at = null;

-- Verify they are platform admin
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"aa000003-0000-0000-0000-000000000003","aud":"authenticated","role":"authenticated","email":"cs.campus-a-admin@example.invalid"}',
  true);

select ok(
  (select user_is_platform_admin()),
  'Temporary platform admin: user_is_platform_admin() returns true before revocation'
);

-- 13. Revoke by setting is_active = false and revoked_at
set local role postgres;
update platform_admins
set is_active = false, revoked_at = now()
where user_id = 'aa000003-0000-0000-0000-000000000003'::uuid;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"aa000003-0000-0000-0000-000000000003","aud":"authenticated","role":"authenticated","email":"cs.campus-a-admin@example.invalid"}',
  true);

-- 14. After revocation, user_is_platform_admin() returns false immediately
select ok(
  not (select user_is_platform_admin()),
  'Revoked platform admin: user_is_platform_admin() returns false immediately'
);

-- Clean up temporary platform admin row
set local role postgres;
delete from platform_admins
where user_id = 'aa000003-0000-0000-0000-000000000003'::uuid;

-- ══════════════════════════════════════════════════════════════
-- Section 4: Platform admin audit isolation
-- ══════════════════════════════════════════════════════════════

-- 15. Platform admin can read platform-level audit events (tenant_id is null)
set local role postgres;
insert into audit_events (
  tenant_id, actor_user_id, action, entity_type, entity_id
) values (
  null,
  'cc000001-0000-0000-0000-000000000001',
  'platform.test_event', 'platform', 'cc000001-0000-0000-0000-000000000001'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"cc000001-0000-0000-0000-000000000001","aud":"authenticated","role":"authenticated","email":"platform.admin@example.invalid"}',
  true);

select ok(
  exists(
    select 1 from audit_events
    where tenant_id is null
      and action = 'platform.test_event'
  ),
  'Platform admin: can read platform-level (null tenant) audit events'
);

-- 16. CS admin cannot read platform-level (null tenant) audit events
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"aa000001-0000-0000-0000-000000000001","aud":"authenticated","role":"authenticated","email":"cs.admin@example.invalid"}',
  true);

select is(
  (select count(*)::int from audit_events
   where tenant_id is null),
  0,
  'CS admin: cannot read platform-level audit events'
);

-- ══════════════════════════════════════════════════════════════
-- Section 5: Platform admin scope beyond tenants
-- ══════════════════════════════════════════════════════════════

-- 17. Platform admin can insert a new tenant (uses tenants_insert_platform_admin policy)
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"cc000001-0000-0000-0000-000000000001","aud":"authenticated","role":"authenticated","email":"platform.admin@example.invalid"}',
  true);

select lives_ok(
  $$
    insert into tenants (id, name, slug, status, timezone, default_currency)
    values (
      'ffffffff-ffff-ffff-ffff-000000000001',
      'Test Insertion Church', 'test-insertion', 'active',
      'America/New_York', 'USD'
    )
  $$,
  'Platform admin: can insert a new tenant'
);

-- 18. CS admin cannot insert a new tenant
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"aa000001-0000-0000-0000-000000000001","aud":"authenticated","role":"authenticated","email":"cs.admin@example.invalid"}',
  true);

select throws_ok(
  $$
    insert into tenants (id, name, slug, status, timezone, default_currency)
    values (
      'ffffffff-ffff-ffff-ffff-000000000002',
      'Unauthorized Church', 'unauthorized-church', 'active',
      'America/New_York', 'USD'
    )
  $$,
  null, null,
  'CS admin: cannot insert a new tenant'
);

-- 19. TC admin cannot insert a new tenant
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"bb000001-0000-0000-0000-000000000001","aud":"authenticated","role":"authenticated","email":"tc.admin@example.invalid"}',
  true);

select throws_ok(
  $$
    insert into tenants (id, name, slug, status, timezone, default_currency)
    values (
      'ffffffff-ffff-ffff-ffff-000000000003',
      'TC Unauthorized Church', 'tc-unauthorized', 'active',
      'America/Chicago', 'USD'
    )
  $$,
  null, null,
  'TC admin: cannot insert a new tenant'
);

-- Clean up test tenant
set local role postgres;
delete from tenants where id = 'ffffffff-ffff-ffff-ffff-000000000001';
delete from audit_events where action = 'platform.test_event';

-- ══════════════════════════════════════════════════════════════
-- Section 6: Platform admin isolation from church roles
-- ══════════════════════════════════════════════════════════════

-- 20. Anonymous user cannot read platform_admins
set local role anon;
select set_config('request.jwt.claims', '{}', true);

select is(
  (select count(*)::int from platform_admins),
  0,
  'Anonymous: cannot read platform_admins'
);

-- 21. Anonymous user cannot insert into platform_admins
select throws_ok(
  $$
    insert into platform_admins (user_id, notes)
    values (
      'aa000001-0000-0000-0000-000000000001',
      'Anonymous elevation attempt'
    )
  $$,
  null, null,
  'Anonymous: cannot insert into platform_admins'
);

-- 22. Revoked platform admin cannot elevate others
-- (The RLS insert policy requires user_is_platform_admin(); revoked admin fails that check)
-- Use the platform admin account in revoked state by temporarily updating the row
set local role postgres;
update platform_admins
set is_active = false, revoked_at = now()
where user_id = 'cc000001-0000-0000-0000-000000000001'::uuid;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"cc000001-0000-0000-0000-000000000001","aud":"authenticated","role":"authenticated","email":"platform.admin@example.invalid"}',
  true);

select throws_ok(
  $$
    insert into platform_admins (user_id, notes)
    values (
      'aa000001-0000-0000-0000-000000000001',
      'Revoked admin attempts to elevate another user'
    )
  $$,
  null, null,
  'Revoked platform admin: cannot grant platform access to others'
);

-- Restore platform admin status
set local role postgres;
update platform_admins
set is_active = true, revoked_at = null
where user_id = 'cc000001-0000-0000-0000-000000000001'::uuid;

select * from finish();
rollback;
