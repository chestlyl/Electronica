-- pgTAP tenant isolation tests
-- Run with: supabase test db

begin;

select plan(20);

-- Test 1: Duplicate tenant slug is rejected
select throws_ok(
  $$ insert into tenants (name, slug) values ('Dup Church', 'cornerstone-akron') $$,
  'unique_violation',
  null,
  'Duplicate tenant slug must be rejected'
);

-- Test 2: Cornerstone exists
select ok(
  exists(select 1 from tenants where slug = 'cornerstone-akron'),
  'Cornerstone tenant exists'
);

-- Test 3: Test Church exists
select ok(
  exists(select 1 from tenants where slug = 'test-church'),
  'Test Church exists'
);

-- Test 4: Cornerstone campus exists
select ok(
  exists(
    select 1 from campuses c
    join tenants t on t.id = c.tenant_id
    where t.slug = 'cornerstone-akron' and c.slug = 'main'
  ),
  'Cornerstone main campus exists'
);

-- Test 5: Cornerstone has 4 people
select is(
  (select count(*)::int from people p
   join tenants t on t.id = p.tenant_id
   where t.slug = 'cornerstone-akron'),
  4,
  'Cornerstone has exactly 4 seed people'
);

-- Test 6: Test Church has 3 people
select is(
  (select count(*)::int from people p
   join tenants t on t.id = p.tenant_id
   where t.slug = 'test-church'),
  3,
  'Test Church has exactly 3 seed people'
);

-- Test 7: Cornerstone people are not in Test Church
select is(
  (select count(*)::int
   from people p
   join tenants t on t.id = p.tenant_id
   where t.slug = 'test-church'
     and p.id in (
       select id from people pp
       join tenants tt on tt.id = pp.tenant_id
       where tt.slug = 'cornerstone-akron'
     )),
  0,
  'Cornerstone people do not appear in Test Church'
);

-- Test 8: household_members reference same-tenant people
select is(
  (select count(*)::int
   from household_members hm
   join households h on h.id = hm.household_id
   join people p on p.id = hm.person_id
   where h.tenant_id != p.tenant_id),
  0,
  'No household member crosses tenant boundary'
);

-- Test 9: Cornerstone admin role exists
select ok(
  exists(
    select 1 from roles r
    join tenants t on t.id = r.tenant_id
    where t.slug = 'cornerstone-akron' and r.slug = 'admin'
  ),
  'Cornerstone admin role exists'
);

-- Test 10: Test Church admin role exists
select ok(
  exists(
    select 1 from roles r
    join tenants t on t.id = r.tenant_id
    where t.slug = 'test-church' and r.slug = 'admin'
  ),
  'Test Church admin role exists'
);

-- Test 11: Cornerstone admin role has people.create permission
select ok(
  exists(
    select 1
    from role_permissions rp
    join roles r on r.id = rp.role_id
    join permissions p on p.id = rp.permission_id
    join tenants t on t.id = r.tenant_id
    where t.slug = 'cornerstone-akron'
      and r.slug = 'admin'
      and p.key  = 'people.create'
  ),
  'Cornerstone admin has people.create permission'
);

-- Test 12: Cornerstone member role does NOT have people.create
select ok(
  not exists(
    select 1
    from role_permissions rp
    join roles r on r.id = rp.role_id
    join permissions p on p.id = rp.permission_id
    join tenants t on t.id = r.tenant_id
    where t.slug = 'cornerstone-akron'
      and r.slug = 'member'
      and p.key  = 'people.create'
  ),
  'Cornerstone member does NOT have people.create permission'
);

-- Test 13: Cornerstone households have members
select ok(
  exists(
    select 1 from household_members hm
    join households h on h.id = hm.household_id
    join tenants t on t.id = h.tenant_id
    where t.slug = 'cornerstone-akron'
  ),
  'Cornerstone households have members'
);

-- Test 14: Tenant settings exist for both tenants
select is(
  (select count(*)::int from tenant_settings ts
   join tenants t on t.id = ts.tenant_id
   where t.slug in ('cornerstone-akron', 'test-church')),
  2,
  'Both tenants have settings records'
);

-- Test 15: No real email addresses in seed (all end with .invalid)
select is(
  (select count(*)::int from people where email not like '%.invalid'),
  0,
  'All seed people use .invalid email addresses'
);

-- Test 16: Cornerstone tenant status is pilot
select is(
  (select status from tenants where slug = 'cornerstone-akron'),
  'pilot',
  'Cornerstone tenant status is pilot'
);

-- Test 17: Test Church tenant status is active
select is(
  (select status from tenants where slug = 'test-church'),
  'active',
  'Test Church tenant status is active'
);

-- Test 18: All permissions are seeded
select is(
  (select count(*)::int from permissions),
  20,
  '20 permissions are seeded'
);

-- Test 19: Campus slugs are unique within a tenant
select is(
  (select count(*)::int from (
    select tenant_id, slug, count(*) cnt
    from campuses
    group by tenant_id, slug
    having count(*) > 1
  ) dup),
  0,
  'Campus slugs are unique within each tenant'
);

-- Test 20: RLS is enabled on people table
select ok(
  (select rowsecurity from pg_tables where tablename = 'people' and schemaname = 'public'),
  'RLS is enabled on people table'
);

select * from finish();
rollback;
