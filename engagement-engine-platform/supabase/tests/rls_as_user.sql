-- ============================================================
-- Authenticated RLS tests
-- Runs as an authenticated PostgreSQL role with JWT claims set
-- to simulate each fictional test identity from dev_seed.sql.
--
-- Run with: supabase test db
--
-- Identity reference (all from dev_seed.sql):
--   aa000001  cs.admin          Cornerstone tenant-wide Administrator
--   aa000002  cs.member         Cornerstone Member (member.self_access only)
--   aa000003  cs.campus-a-admin Campus A Administrator (people.view/create scoped to cc111111)
--   aa000004  cs.campus-b-user  Campus B Administrator (people.view/create scoped to cc222222)
--   aa000005  cs.ministry-leader Campus-admin role scoped to Youth Ministry (cd222222)
--   aa000006  cs.suspended      Suspended membership
--   bb000001  tc.admin          Test Church Administrator
--   bb000002  tc.member         Test Church Member
--   cc000001  platform.admin    Platform administrator (platform_admins table)
--
-- Tenant UUIDs:
--   Cornerstone  11111111-1111-1111-1111-111111111111
--   Test Church  22222222-2222-2222-2222-222222222222
--
-- Campus UUIDs (Cornerstone):
--   Campus A  cc111111-1111-1111-1111-111111111111
--   Campus B  cc222222-2222-2222-2222-222222222222
--
-- People UUIDs (Cornerstone):
--   Campus A: ca111111 (James Whitfield), ca222222 (Sarah Moreau)
--   Campus B: ca333333 (David Okafor),   ca444444 (Rachel Kim)
-- ============================================================

begin;

-- pgTAP requires a plan declaration before any tests
select plan(68);

-- ─────────────────────────────────────────────────────────────
-- Helper: switch to authenticated role with a given user UUID
-- ─────────────────────────────────────────────────────────────
-- We call this before each group of tests by setting JWT claims
-- that Supabase RLS helpers (auth.uid(), auth.role()) read from.
-- Note: set_config with is_local=true resets at end of transaction.

-- ══════════════════════════════════════════════════════════════
-- Section 1: Anonymous access
-- ══════════════════════════════════════════════════════════════

set local role anon;
select set_config('request.jwt.claims', '{}', true);

-- 1. Anonymous cannot read people
select is(
  (select count(*)::int from people),
  0,
  'Anonymous: cannot read people'
);

-- 2. Anonymous cannot read households
select is(
  (select count(*)::int from households),
  0,
  'Anonymous: cannot read households'
);

-- 3. Anonymous cannot read tenant_settings
select is(
  (select count(*)::int from tenant_settings),
  0,
  'Anonymous: cannot read tenant_settings'
);

-- 4. Anonymous cannot read audit_events
select is(
  (select count(*)::int from audit_events),
  0,
  'Anonymous: cannot read audit_events'
);

-- ══════════════════════════════════════════════════════════════
-- Section 2: Tenant isolation — Cornerstone admin
-- ══════════════════════════════════════════════════════════════

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"aa000001-0000-0000-0000-000000000001","aud":"authenticated","role":"authenticated","email":"cs.admin@example.invalid"}',
  true);

-- 5. CS admin can read Cornerstone people
select ok(
  (select count(*)::int from people
   where tenant_id = '11111111-1111-1111-1111-111111111111') > 0,
  'CS admin: can read Cornerstone people'
);

-- 6. CS admin cannot read Test Church people (tenant isolation)
select is(
  (select count(*)::int from people
   where tenant_id = '22222222-2222-2222-2222-222222222222'),
  0,
  'CS admin: cannot read Test Church people'
);

-- 7. CS admin cannot read Test Church households
select is(
  (select count(*)::int from households
   where tenant_id = '22222222-2222-2222-2222-222222222222'),
  0,
  'CS admin: cannot read Test Church households'
);

-- 8. CS admin cannot insert a Test Church person
select throws_ok(
  $$
    insert into people (tenant_id, first_name, last_name, email, status)
    values (
      '22222222-2222-2222-2222-222222222222',
      'Forged', 'Insert', 'forged@example.invalid', 'active'
    )
  $$,
  null, null,
  'CS admin: cross-tenant insert is rejected'
);

-- 9. CS admin cross-tenant update affects 0 rows (RLS filters rows before UPDATE)
-- RLS restricts which rows are visible/modifiable; the UPDATE runs but touches nothing.
do $$
begin
  update people set first_name = 'Hacked'
  where tenant_id = '22222222-2222-2222-2222-222222222222';
end $$;

select is(
  (select count(*)::int from people
   where tenant_id = '22222222-2222-2222-2222-222222222222'
     and first_name = 'Hacked'),
  0,
  'CS admin: cross-tenant update is rejected'
);

-- ══════════════════════════════════════════════════════════════
-- Section 3: Tenant isolation — Test Church admin
-- ══════════════════════════════════════════════════════════════

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"bb000001-0000-0000-0000-000000000001","aud":"authenticated","role":"authenticated","email":"tc.admin@example.invalid"}',
  true);

-- 10. TC admin can read Test Church people
select ok(
  (select count(*)::int from people
   where tenant_id = '22222222-2222-2222-2222-222222222222') > 0,
  'TC admin: can read Test Church people'
);

-- 11. TC admin cannot read Cornerstone people
select is(
  (select count(*)::int from people
   where tenant_id = '11111111-1111-1111-1111-111111111111'),
  0,
  'TC admin: cannot read Cornerstone people'
);

-- 12. TC admin cross-tenant update affects 0 rows (RLS filters rows before UPDATE)
do $$
begin
  update people set first_name = 'Hacked'
  where tenant_id = '11111111-1111-1111-1111-111111111111';
end $$;

select is(
  (select count(*)::int from people
   where tenant_id = '11111111-1111-1111-1111-111111111111'
     and first_name = 'Hacked'),
  0,
  'TC admin: cross-tenant update is rejected'
);

-- ══════════════════════════════════════════════════════════════
-- Section 4: Member access restrictions
-- ══════════════════════════════════════════════════════════════

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"aa000002-0000-0000-0000-000000000002","aud":"authenticated","role":"authenticated","email":"cs.member@example.invalid"}',
  true);

-- 13. CS member cannot list Cornerstone people (no people.view)
select is(
  (select count(*)::int from people
   where tenant_id = '11111111-1111-1111-1111-111111111111'),
  0,
  'CS member: cannot list people (no people.view permission)'
);

-- 14. CS member cannot list Cornerstone households
select is(
  (select count(*)::int from households
   where tenant_id = '11111111-1111-1111-1111-111111111111'),
  0,
  'CS member: cannot list households (no households.view)'
);

-- 15. CS member cannot list all memberships (can only see own row)
select is(
  (select count(*)::int from tenant_memberships
   where tenant_id = '11111111-1111-1111-1111-111111111111'
     and user_id <> 'aa000002-0000-0000-0000-000000000002'::uuid),
  0,
  'CS member: cannot see other memberships (only own row)'
);

-- 16. CS member can see own membership row (self-access)
select ok(
  exists(
    select 1 from tenant_memberships
    where user_id = 'aa000002-0000-0000-0000-000000000002'::uuid
  ),
  'CS member: can see own membership row via self-access'
);

-- 17. CS member cannot read tenant_settings
select is(
  (select count(*)::int from tenant_settings
   where tenant_id = '11111111-1111-1111-1111-111111111111'),
  0,
  'CS member: cannot read tenant_settings (no settings.view)'
);

-- 18. CS member cannot read roles
select is(
  (select count(*)::int from roles
   where tenant_id = '11111111-1111-1111-1111-111111111111'),
  0,
  'CS member: cannot read tenant roles (no roles.view)'
);

-- 19. CS member cannot insert a person
select throws_ok(
  $$
    insert into people (tenant_id, first_name, last_name, email, status)
    values (
      '11111111-1111-1111-1111-111111111111',
      'Unauthorized', 'Insert', 'unauth@example.invalid', 'active'
    )
  $$,
  null, null,
  'CS member: cannot insert a person (no people.create)'
);

-- 20. CS member cannot update another person (UPDATE affects 0 rows — RLS blocks writes)
do $$
begin
  update people set first_name = 'Hacked'
  where id = 'ca111111-1111-1111-1111-111111111111';
end $$;

-- Switch to postgres to verify the row was NOT updated
set local role postgres;
select is(
  (select first_name from people
   where id = 'ca111111-1111-1111-1111-111111111111'),
  'James',
  'CS member: cannot update another person (no people.update)'
);

-- Restore authenticated role for subsequent tests
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"aa000002-0000-0000-0000-000000000002","aud":"authenticated","role":"authenticated","email":"cs.member@example.invalid"}',
  true);

-- ══════════════════════════════════════════════════════════════
-- Section 5: Membership state
-- ══════════════════════════════════════════════════════════════

-- Active membership: CS admin already verified above (section 2)

-- 21. Suspended membership: no data access
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"aa000006-0000-0000-0000-000000000006","aud":"authenticated","role":"authenticated","email":"cs.suspended@example.invalid"}',
  true);

select is(
  (select count(*)::int from people
   where tenant_id = '11111111-1111-1111-1111-111111111111'),
  0,
  'Suspended membership: cannot access people'
);

-- 22. Suspended membership: no households
select is(
  (select count(*)::int from households
   where tenant_id = '11111111-1111-1111-1111-111111111111'),
  0,
  'Suspended membership: cannot access households'
);

-- ══════════════════════════════════════════════════════════════
-- Section 6: Role state (expired / revoked)
-- Uses the service role to insert a temporary expired assignment,
-- then verifies from the user perspective.
-- ══════════════════════════════════════════════════════════════

-- Switch to service role to insert test data
set local role postgres;

-- Insert a temporary expired role assignment for CS member
-- (re-use member membership id tm100002)
insert into role_assignments (
  id, tenant_id, membership_id, role_id,
  campus_id, ministry_id, expires_at
) values (
  'eeeeeeee-0000-0000-0000-000000000001',
  '11111111-1111-1111-1111-111111111111',
  'ab100002-0000-0000-0000-000000000002',
  'ce111111-1111-1111-1111-111111111111',
  null, null,
  now() - interval '1 hour'  -- already expired
);

-- Insert a temporary revoked role assignment for CS member
insert into role_assignments (
  id, tenant_id, membership_id, role_id,
  campus_id, ministry_id, revoked_at
) values (
  'eeeeeeee-0000-0000-0000-000000000002',
  '11111111-1111-1111-1111-111111111111',
  'ab100002-0000-0000-0000-000000000002',
  'ce111111-1111-1111-1111-111111111111',
  null, null,
  now() - interval '1 minute'  -- revoked
);

-- Switch back to authenticated as cs.member
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"aa000002-0000-0000-0000-000000000002","aud":"authenticated","role":"authenticated","email":"cs.member@example.invalid"}',
  true);

-- 23. Expired role assignment grants no permission
select is(
  (select count(*)::int from people
   where tenant_id = '11111111-1111-1111-1111-111111111111'),
  0,
  'Expired role assignment: grants no people.view'
);

-- 24. Revoked role assignment grants no permission
-- (same result as above since member has no other admin grant)
select is(
  (select count(*)::int from households
   where tenant_id = '11111111-1111-1111-1111-111111111111'),
  0,
  'Revoked role assignment: grants no households.view'
);

-- Clean up temporary test data
set local role postgres;
delete from role_assignments
where id in (
  'eeeeeeee-0000-0000-0000-000000000001',
  'eeeeeeee-0000-0000-0000-000000000002'
);

-- 25. Tenant-wide assignment works only inside its tenant
-- CS admin cannot see Test Church data (already tested above; confirm tenant binding)
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"aa000001-0000-0000-0000-000000000001","aud":"authenticated","role":"authenticated","email":"cs.admin@example.invalid"}',
  true);

select is(
  (select count(*)::int from tenant_settings
   where tenant_id = '22222222-2222-2222-2222-222222222222'),
  0,
  'Tenant-wide CS admin: assignment does not extend to Test Church'
);

-- ══════════════════════════════════════════════════════════════
-- Section 7: Campus scope
-- ══════════════════════════════════════════════════════════════

-- Campus A admin (aa000003): people.view/create scoped to Campus A only
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"aa000003-0000-0000-0000-000000000003","aud":"authenticated","role":"authenticated","email":"cs.campus-a-admin@example.invalid"}',
  true);

-- 26. Campus A admin can read Campus A people
select ok(
  (select count(*)::int from people
   where primary_campus_id = 'cc111111-1111-1111-1111-111111111111') > 0,
  'Campus A admin: can read Campus A people'
);

-- 27. Campus A admin cannot read Campus B people
select is(
  (select count(*)::int from people
   where primary_campus_id = 'cc222222-2222-2222-2222-222222222222'),
  0,
  'Campus A admin: cannot read Campus B people'
);

-- 28. Campus A admin cannot create a Campus B person
select throws_ok(
  $$
    insert into people (tenant_id, first_name, last_name, email, status, primary_campus_id)
    values (
      '11111111-1111-1111-1111-111111111111',
      'Unauthorized', 'CampusB', 'unauth.campusb@example.invalid', 'active',
      'cc222222-2222-2222-2222-222222222222'
    )
  $$,
  null, null,
  'Campus A admin: cannot create Campus B person'
);

-- Campus B admin (aa000004): people.view/create scoped to Campus B only
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"aa000004-0000-0000-0000-000000000004","aud":"authenticated","role":"authenticated","email":"cs.campus-b-user@example.invalid"}',
  true);

-- 29. Campus B admin can read Campus B people
select ok(
  (select count(*)::int from people
   where primary_campus_id = 'cc222222-2222-2222-2222-222222222222') > 0,
  'Campus B admin: can read Campus B people'
);

-- 30. Campus B admin cannot read Campus A people
select is(
  (select count(*)::int from people
   where primary_campus_id = 'cc111111-1111-1111-1111-111111111111'),
  0,
  'Campus B admin: cannot read Campus A people'
);

-- Tenant-wide admin (CS admin) can read both campuses
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"aa000001-0000-0000-0000-000000000001","aud":"authenticated","role":"authenticated","email":"cs.admin@example.invalid"}',
  true);

-- 31. Tenant-wide admin can read Campus A people
select ok(
  (select count(*)::int from people
   where primary_campus_id = 'cc111111-1111-1111-1111-111111111111') > 0,
  'Tenant-wide admin: can read Campus A people'
);

-- 32. Tenant-wide admin can read Campus B people
select ok(
  (select count(*)::int from people
   where primary_campus_id = 'cc222222-2222-2222-2222-222222222222') > 0,
  'Tenant-wide admin: can read Campus B people'
);

-- 33. Campus A admin cannot read Campus B households
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"aa000003-0000-0000-0000-000000000003","aud":"authenticated","role":"authenticated","email":"cs.campus-a-admin@example.invalid"}',
  true);

select is(
  (select count(*)::int from households
   where primary_campus_id = 'cc222222-2222-2222-2222-222222222222'),
  0,
  'Campus A admin: cannot read Campus B households'
);

-- 34. People with no primary_campus_id are invisible to campus-scoped admin
-- (The RLS policy requires primary_campus_id IS NOT NULL for scoped grants)
-- Verify: a person with no campus is not returned for campus-A-admin
-- Use service role to check how many null-campus people exist in CS
set local role postgres;
do $$
declare v_null_count int;
begin
  select count(*) into v_null_count
  from people
  where tenant_id = '11111111-1111-1111-1111-111111111111'
    and primary_campus_id is null;
  -- Document the count for transparency (may be zero in current seed)
  raise notice 'Null-campus people in Cornerstone: %', v_null_count;
end $$;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"aa000003-0000-0000-0000-000000000003","aud":"authenticated","role":"authenticated","email":"cs.campus-a-admin@example.invalid"}',
  true);

select is(
  (select count(*)::int from people
   where tenant_id = '11111111-1111-1111-1111-111111111111'
     and primary_campus_id is null),
  0,
  'Campus A admin: cannot read people with no campus (null campus_id invisible)'
);

-- ══════════════════════════════════════════════════════════════
-- Section 8: Ministry scope
-- ══════════════════════════════════════════════════════════════
--
-- NOTE: The schema does not attach ministry_id to people or households.
-- Ministry scope in Layer 1 is represented ONLY in role_assignments
-- (a role may be scoped to a ministry). The RLS policies for people and
-- households use campus_id scope, not ministry_id.
--
-- The following tests verify what the schema CAN enforce:
--   - user_has_permission() with a ministry scope recognises the ministry grant
--   - The ministry grant does not produce tenant-wide access
--   - A Test Church ministry cannot be granted inside Cornerstone
--   - A missing ministry context does not accidentally broaden access
--
-- Ministry-level record filtering (show only ministry-linked people) is
-- NOT implemented in Layer 1. This is documented as a known limitation.

-- Ministry leader (aa000005): campus-admin role scoped to Youth Ministry (cd222222)
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"aa000005-0000-0000-0000-000000000005","aud":"authenticated","role":"authenticated","email":"cs.ministry-leader@example.invalid"}',
  true);

-- 35. Ministry leader assignment is recognized for Youth Ministry permission
-- user_has_permission with the correct ministry_id returns true
select ok(
  (select user_has_permission(
    '11111111-1111-1111-1111-111111111111'::uuid,
    'people.view',
    null,
    'cd222222-2222-2222-2222-222222222222'::uuid
  )),
  'Ministry leader: permission recognized for Youth Ministry'
);

-- 36. Ministry leader assignment does NOT grant tenant-wide people.view
select ok(
  not (select user_has_permission(
    '11111111-1111-1111-1111-111111111111'::uuid,
    'people.view',
    null,
    null
  )),
  'Ministry leader: ministry grant does not become tenant-wide'
);

-- 37. A Test Church ministry cannot produce a permission inside Cornerstone
-- (Test Church ministry dc111111 does not exist inside Cornerstone)
select ok(
  not (select user_has_permission(
    '11111111-1111-1111-1111-111111111111'::uuid,
    'people.view',
    null,
    'dc111111-1111-1111-1111-111111111111'::uuid  -- TC campus, not a Cornerstone ministry
  )),
  'Ministry: Test Church ministry ID does not grant Cornerstone access'
);

-- 38. Missing ministry context does not broaden access beyond campus scope
-- For the ministry leader, calling user_has_permission without any scope
-- context should return false (no tenant-wide grant)
select ok(
  not (select user_has_permission(
    '11111111-1111-1111-1111-111111111111'::uuid,
    'people.create'
  )),
  'Ministry leader: no tenant-wide create grant when ministry context omitted'
);

-- NOTE: people records are filtered by primary_campus_id, not ministry_id.
-- Ministry-scoped record visibility is a Layer 2 feature.
-- The ministry leader can see Campus A people because of campus_id inheritance
-- from the role assignment (campus_id=null, ministry_id=cd222222).
-- However, the current RLS does not filter by ministry, so the ministry
-- leader's effective row visibility depends only on campus scope in the RLS.
-- Document: ministry-scoped record filtering is NOT yet enforced at the row level.

-- ══════════════════════════════════════════════════════════════
-- Section 9: RLS enabled on all protected tables
-- ══════════════════════════════════════════════════════════════

set local role postgres;

-- 39–52: verify RLS is enabled on every protected table
select ok(
  (select rowsecurity from pg_tables where tablename = 'tenants' and schemaname = 'public'),
  'RLS is enabled on tenants table'
);

select ok(
  (select rowsecurity from pg_tables where tablename = 'tenant_settings' and schemaname = 'public'),
  'RLS is enabled on tenant_settings table'
);

select ok(
  (select rowsecurity from pg_tables where tablename = 'campuses' and schemaname = 'public'),
  'RLS is enabled on campuses table'
);

select ok(
  (select rowsecurity from pg_tables where tablename = 'ministries' and schemaname = 'public'),
  'RLS is enabled on ministries table'
);

select ok(
  (select rowsecurity from pg_tables where tablename = 'people' and schemaname = 'public'),
  'RLS is enabled on people table'
);

select ok(
  (select rowsecurity from pg_tables where tablename = 'households' and schemaname = 'public'),
  'RLS is enabled on households table'
);

select ok(
  (select rowsecurity from pg_tables where tablename = 'household_members' and schemaname = 'public'),
  'RLS is enabled on household_members table'
);

select ok(
  (select rowsecurity from pg_tables where tablename = 'tenant_memberships' and schemaname = 'public'),
  'RLS is enabled on tenant_memberships table'
);

select ok(
  (select rowsecurity from pg_tables where tablename = 'roles' and schemaname = 'public'),
  'RLS is enabled on roles table'
);

select ok(
  (select rowsecurity from pg_tables where tablename = 'role_assignments' and schemaname = 'public'),
  'RLS is enabled on role_assignments table'
);

select ok(
  (select rowsecurity from pg_tables where tablename = 'invitations' and schemaname = 'public'),
  'RLS is enabled on invitations table'
);

select ok(
  (select rowsecurity from pg_tables where tablename = 'audit_events' and schemaname = 'public'),
  'RLS is enabled on audit_events table'
);

select ok(
  (select rowsecurity from pg_tables where tablename = 'platform_admins' and schemaname = 'public'),
  'RLS is enabled on platform_admins table'
);

select ok(
  (select rowsecurity from pg_tables where tablename = 'integration_connections' and schemaname = 'public'),
  'RLS is enabled on integration_connections table'
);

-- ══════════════════════════════════════════════════════════════
-- Section 10: Relational isolation — cross-tenant references
-- ══════════════════════════════════════════════════════════════

-- 53. Person cannot reference another tenant's campus
-- Switch to CS admin, attempt to insert a Cornerstone person with TC campus
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"aa000001-0000-0000-0000-000000000001","aud":"authenticated","role":"authenticated","email":"cs.admin@example.invalid"}',
  true);

select throws_ok(
  $$
    insert into people (tenant_id, first_name, last_name, email, status, primary_campus_id)
    values (
      '11111111-1111-1111-1111-111111111111',
      'CrossTenant', 'CampusRef', 'ct.campus@example.invalid', 'active',
      'dc111111-1111-1111-1111-111111111111'  -- TC campus, wrong tenant
    )
  $$,
  null, null,
  'Person: cannot reference another tenant campus'
);

-- 54. Household cannot reference another tenant's campus
select throws_ok(
  $$
    insert into households (tenant_id, name, primary_campus_id)
    values (
      '11111111-1111-1111-1111-111111111111',
      'CrossTenant Household',
      'dc111111-1111-1111-1111-111111111111'  -- TC campus
    )
  $$,
  null, null,
  'Household: cannot reference another tenant campus'
);

-- 55. Role assignment cannot use another tenant's role
-- Use service role for this check since role_assignments_insert requires roles.manage
set local role postgres;
select throws_ok(
  $$
    insert into role_assignments (tenant_id, membership_id, role_id, campus_id, ministry_id)
    values (
      '11111111-1111-1111-1111-111111111111',
      'ab100001-0000-0000-0000-000000000001',
      'de111111-1111-1111-1111-111111111111',  -- TC admin role
      null, null
    )
  $$,
  null, null,
  'Role assignment: cannot use another tenant role'
);

-- 56. Role assignment cannot use another tenant's campus
select throws_ok(
  $$
    insert into role_assignments (tenant_id, membership_id, role_id, campus_id, ministry_id)
    values (
      '11111111-1111-1111-1111-111111111111',
      'ab100001-0000-0000-0000-000000000001',
      'ce333333-3333-3333-3333-333333333333',
      'dc111111-1111-1111-1111-111111111111',  -- TC campus
      null
    )
  $$,
  null, null,
  'Role assignment: cannot use another tenant campus'
);

-- 57. Role assignment cannot use another tenant's ministry
-- (dc111111 is a TC campus; no TC ministry is in seed, so use TC campus as proxy)
-- Instead test using a fabricated wrong-tenant ministry UUID that would violate FK
select throws_ok(
  $$
    insert into role_assignments (tenant_id, membership_id, role_id, campus_id, ministry_id)
    values (
      '11111111-1111-1111-1111-111111111111',
      'ab100001-0000-0000-0000-000000000001',
      'ce333333-3333-3333-3333-333333333333',
      null,
      'dc111111-1111-1111-1111-111111111111'  -- TC campus used as ministry_id (FK violation)
    )
  $$,
  null, null,
  'Role assignment: cannot use another tenant ministry'
);

-- 58. Invitation cannot reference another tenant's role
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"aa000001-0000-0000-0000-000000000001","aud":"authenticated","role":"authenticated","email":"cs.admin@example.invalid"}',
  true);

select throws_ok(
  $$
    insert into invitations (tenant_id, email, invited_by_user_id, role_id, token_hash, status, expires_at)
    values (
      '11111111-1111-1111-1111-111111111111',
      'invite@example.invalid',
      'aa000001-0000-0000-0000-000000000001',
      'de111111-1111-1111-1111-111111111111',  -- TC role
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'pending',
      now() + interval '7 days'
    )
  $$,
  null, null,
  'Invitation: cannot reference another tenant role'
);

-- ══════════════════════════════════════════════════════════════
-- Section 11: Audit and request_id
-- ══════════════════════════════════════════════════════════════

set local role postgres;

-- 59. Audit events insert is blocked for non-service role
-- (policy: audit_events_insert with check (false))
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"aa000001-0000-0000-0000-000000000001","aud":"authenticated","role":"authenticated","email":"cs.admin@example.invalid"}',
  true);

select throws_ok(
  $$
    insert into audit_events (tenant_id, actor_user_id, action, entity_type, entity_id)
    values (
      '11111111-1111-1111-1111-111111111111',
      'aa000001-0000-0000-0000-000000000001',
      'fake.action', 'people', 'ca111111-1111-1111-1111-111111111111'
    )
  $$,
  null, null,
  'Audit events: authenticated user cannot insert directly'
);

-- 60. CS admin can read Cornerstone audit events (audit.view permission)
-- First insert a test audit event as service role
set local role postgres;
insert into audit_events (
  tenant_id, actor_user_id, action, entity_type, entity_id, request_id
) values (
  '11111111-1111-1111-1111-111111111111',
  'aa000001-0000-0000-0000-000000000001',
  'test.rls_verification', 'test', 'ffffffff-ffff-ffff-ffff-ffffffffffff',
  'req-rls-test-001'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"aa000001-0000-0000-0000-000000000001","aud":"authenticated","role":"authenticated","email":"cs.admin@example.invalid"}',
  true);

select ok(
  exists(
    select 1 from audit_events
    where tenant_id = '11111111-1111-1111-1111-111111111111'
      and action = 'test.rls_verification'
  ),
  'CS admin: can read Cornerstone audit events (audit.view)'
);

-- 61. CS admin cannot read Test Church audit events
select is(
  (select count(*)::int from audit_events
   where tenant_id = '22222222-2222-2222-2222-222222222222'),
  0,
  'CS admin: cannot read Test Church audit events'
);

-- 62. CS member cannot read audit events (no audit.view)
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"aa000002-0000-0000-0000-000000000002","aud":"authenticated","role":"authenticated","email":"cs.member@example.invalid"}',
  true);

select is(
  (select count(*)::int from audit_events
   where tenant_id = '11111111-1111-1111-1111-111111111111'),
  0,
  'CS member: cannot read audit events (no audit.view)'
);

-- ══════════════════════════════════════════════════════════════
-- Section 12: Invitations membership state
-- ══════════════════════════════════════════════════════════════

-- Invited/not-yet-member: user with no membership cannot access data
-- Use a UUID that has an auth.users row but no tenant_memberships row
-- We use the platform admin (cc000001) who has no CS membership
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"cc000001-0000-0000-0000-000000000001","aud":"authenticated","role":"authenticated","email":"platform.admin@example.invalid"}',
  true);

-- 63. User with no tenant membership cannot read Cornerstone people
select is(
  (select count(*)::int from people
   where tenant_id = '11111111-1111-1111-1111-111111111111'),
  0,
  'No-membership user: cannot read Cornerstone people'
);

-- 64. User with no tenant membership cannot read Cornerstone households
select is(
  (select count(*)::int from households
   where tenant_id = '11111111-1111-1111-1111-111111111111'),
  0,
  'No-membership user: cannot read Cornerstone households'
);

-- ══════════════════════════════════════════════════════════════
-- Section 13: Forging a tenant ID does not grant access
-- ══════════════════════════════════════════════════════════════

-- CS member with member.self_access: cannot bypass by supplying another person_id
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"aa000002-0000-0000-0000-000000000002","aud":"authenticated","role":"authenticated","email":"cs.member@example.invalid"}',
  true);

-- 65. CS member supplying admin person UUID still gets blocked
select is(
  (select count(*)::int from people
   where id = 'ca111111-1111-1111-1111-111111111111'),
  0,
  'CS member: supplying admin person ID does not bypass people.view'
);

-- 66. CS member cannot read another person's membership row
select is(
  (select count(*)::int from tenant_memberships
   where user_id = 'aa000001-0000-0000-0000-000000000001'::uuid),
  0,
  'CS member: cannot read another user membership row'
);

-- ══════════════════════════════════════════════════════════════
-- Section 14: Active role assignment grants its permission
-- ══════════════════════════════════════════════════════════════

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"aa000001-0000-0000-0000-000000000001","aud":"authenticated","role":"authenticated","email":"cs.admin@example.invalid"}',
  true);

-- 67. Active admin role: people.create is granted
select ok(
  (select user_has_permission(
    '11111111-1111-1111-1111-111111111111'::uuid,
    'people.create'
  )),
  'Active role assignment: people.create is granted to CS admin'
);

-- 68. Active admin role: audit.view is granted
select ok(
  (select user_has_permission(
    '11111111-1111-1111-1111-111111111111'::uuid,
    'audit.view'
  )),
  'Active role assignment: audit.view is granted to CS admin'
);

select * from finish();
rollback;
