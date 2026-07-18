# Tenant Isolation — Security Architecture

## Protection layers

Tenant isolation is enforced at multiple independent layers. A failure in one layer does not compromise the others.

| Layer | Mechanism | Where enforced |
|-------|-----------|----------------|
| 1 | Row-Level Security policies | PostgreSQL |
| 2 | `tenant_id` foreign keys on every table | PostgreSQL |
| 3 | Same-tenant constraint checks (households, campus assignments) | PostgreSQL |
| 4 | Server-side membership verification | `apps/api` middleware |
| 5 | Permission resolution before data access | `@ee/permissions` |
| 6 | Service-role key only in trusted server environments | Never in client bundles |
| 7 | Automated cross-tenant read/write tests | `supabase/tests/` |

---

## RLS strategy

Every tenant-owned table has Row-Level Security enabled:

```sql
alter table people enable row level security;
```

Policies use security-definer helper functions with fixed `search_path`:

- `user_belongs_to_tenant(p_tenant_id)` — active membership check
- `user_has_permission(p_tenant_id, p_permission)` — role + permission check
- `user_has_campus_access(p_campus_id)` — campus scope check
- `user_has_ministry_access(p_ministry_id)` — ministry scope check
- `user_is_platform_admin()` — platform-level access check

Policies are **restrictive by default**. A table with no matching policy denies all access to JWT-authenticated users. The service role bypasses RLS and is only used in trusted server code.

### Example: people table

```sql
-- Read: must have people.view permission in tenant
create policy "people_select"
  on people for select
  using (user_has_permission(tenant_id, 'people.view'));

-- Insert: must have people.create permission
create policy "people_insert"
  on people for insert
  with check (user_has_permission(tenant_id, 'people.create'));
```

No policy uses `using (true)`.

---

## Server authorization

The API enforces authorization before any Supabase query:

1. `requireAuth` middleware validates the JWT and sets `c.get('user')`.
2. `requireTenantMembership` middleware verifies the user has an active membership in the path's `:tenantId`.
3. Each route handler calls `hasPermission()` for the specific operation.
4. The query is executed only if all three checks pass.

A forged `tenantId` in the URL path is rejected at step 2 because the membership check will fail.

---

## Service-role restrictions

The Supabase service-role key:
- Is only held by `apps/api` and `apps/worker`.
- Is read from `process.env.SUPABASE_SERVICE_ROLE_KEY` — a server-only variable.
- Is never prefixed `NEXT_PUBLIC_` or `EXPO_PUBLIC_`.
- Is never returned in API responses.
- Is used only for operations that require bypassing RLS: audit event inserts, invitation token hashing.

Next.js client bundles (`NEXT_PUBLIC_*` variables) only receive the Supabase anonymous key.

---

## Cross-tenant test strategy

The `supabase/tests/tenant_isolation.sql` pgTAP test file verifies:

- Cornerstone people do not appear in Test Church's people.
- Household members cannot cross tenant boundaries.
- Duplicate tenant slugs are rejected.
- Both tenants have independent role and permission sets.
- All seed emails use `.invalid` TLDs (no real data).

Unit tests in `apps/api/src/tests/` verify:

- A user without membership in a tenant receives a 403 on all tenant-scoped routes.
- A user with `member` role cannot create a person (missing `people.create`).
- A user with `admin` role can create a person.
- A suspended membership is rejected.
- An expired role assignment no longer grants access.

---

## Known limitations (Layer 1)

| Limitation | Mitigation plan |
|------------|----------------|
| pgTAP tests require a running Supabase instance | Documented in setup guide; CI will run against local Supabase |
| Invitation token delivery not implemented | Token hash stored; delivery via email provider in Layer 2 |
| MFA not enforced | Architecture supports it; enforcement added in Layer 2 |
| Audit metadata is not schema-validated | Zod schema for metadata planned in Layer 2 |
| No rate limiting on API routes | Will be added with Layer 2 hardening |
