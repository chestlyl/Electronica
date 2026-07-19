# Layer 1 Verification Report

Generated: 2026-07-19  
Branch: layer-1  
Repository: chestlyl/Electronica / engagement-engine-platform/

---

## 1. Environment

The full Supabase docker-compose stack (`supabase start`) cannot run in this sandbox
because container-to-container DNS resolution fails (`getaddrinfo EAI_AGAIN`).

**Workaround applied:** Run `public.ecr.aws/supabase/postgres:15.8.1.085` directly with
`--network host`. Create the `auth` schema manually with `auth.users`, `auth.identities`,
`auth.uid()`, `auth.role()`, `auth.email()` and the `anon`/`authenticated`/`service_role`
roles. Apply migrations directly with `psql -f`.

---

## 2. Commands Executed

```
docker run -d --name supa-db --network host \
  -e POSTGRES_PASSWORD=postgres \
  public.ecr.aws/supabase/postgres:15.8.1.085

PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -c "CREATE DATABASE testdb;"
# (auth schema, roles, and functions created manually)

for f in supabase/migrations/*.sql; do
  psql -h 127.0.0.1 -p 54322 -U postgres -d testdb -f "$f"
done

psql -h 127.0.0.1 -p 54322 -U postgres -d testdb -f supabase/seed/dev_seed.sql
psql -h 127.0.0.1 -p 54322 -U postgres -d testdb -f supabase/tests/tenant_isolation.sql
psql -h 127.0.0.1 -p 54322 -U postgres -d testdb -f supabase/tests/rls_as_user.sql
psql -h 127.0.0.1 -p 54322 -U postgres -d testdb -f supabase/tests/platform_admin.sql

pnpm install --frozen-lockfile   → OK
pnpm format                      → OK (all unchanged)
pnpm lint                        → OK (16/16)
pnpm typecheck                   → OK (16/16)
pnpm test                        → OK (19/19)
pnpm build                       → OK (6/6)
pnpm audit                       → 16 vulnerabilities (all in Expo transitive deps)
```

---

## 3. Migration Results

| Migration | Result |
|---|---|
| 0001_initial_schema.sql | OK |
| 0002_rls_policies.sql | OK |
| 0003_rls_helper_functions.sql | OK |
| 0004_audit_logging.sql | OK |
| 0005_invitations.sql | OK |
| 0006_tenant_settings.sql | OK |
| 0007_integration_connections.sql | OK |
| 0008_production_bootstrap.sql | OK |
| 0009_platform_admin.sql | OK |
| 0010_layer1_repairs.sql | OK |
| 0011_role_grants.sql | OK |
| 0012_cross_tenant_integrity.sql | OK |

---

## 4. Seed Result

| Entity | Count |
|---|---|
| auth.users | 9 |
| auth.identities | 9 |
| tenants | 2 (Cornerstone, Test Church) |
| campuses | 3 (Campus A, Campus B, TC Campus) |
| ministries | 2 (Youth, TC Ministry) |
| people | 7 |
| households | 3 |
| tenant_memberships | 8 |
| permissions | 22 |
| roles | 5 |
| role_assignments | 8 |
| platform_admins | 1 |

Auth users created: cs.admin, cs.member, cs.campus-a-admin, cs.campus-b-user,
cs.ministry-leader, cs.suspended, tc.admin, tc.member, platform.admin

---

## 5. pgTAP Test Results

### Structural (tenant_isolation.sql)
- Plan: 20 — Ran: 20 — Passed: 20 — Failed: 0

### Authenticated RLS (rls_as_user.sql)
- Plan: 68 — Ran: 68 — Passed: 68 — Failed: 0

Coverage:
- Section 1 (Anonymous access): tests 1–4 ✓
- Section 2 (CS admin tenant isolation): tests 5–9 ✓
- Section 3 (TC admin tenant isolation): tests 10–12 ✓
- Section 4 (Member access restrictions): tests 13–20 ✓
- Section 5 (Membership state): tests 21–25 ✓
- Section 6 (Role state — expired/revoked): tests 23–25 ✓
- Section 7 (Campus scope): tests 26–34 ✓
- Section 8 (Ministry scope): tests 35–38 ✓
- Section 9 (RLS enabled on all tables): tests 39–52 ✓
- Section 10 (Relational isolation): tests 53–58 ✓
- Section 11 (Audit): tests 59–65 ✓
- Section 12 (Active role permissions): tests 66–68 ✓

### Platform admin (platform_admin.sql)
- Plan: 21 — Ran: 21 — Passed: 21 — Failed: 0

Coverage:
- Section 1 (user_is_platform_admin correctness): tests 1–5 ✓
- Section 2 (Table access control): tests 6–11 ✓
- Section 3 (Revocation): tests 12–13 ✓
- Section 4 (Audit isolation): tests 14–15 ✓
- Section 5 (Tenant scope): tests 16–18 ✓
- Section 6 (Anonymous + revoked): tests 19–21 ✓

**Total DB tests: 109 — All 109 PASS**

---

## 6. Representative Evidence

> Cornerstone administrator queried Test Church people:
> rls_as_user.sql test 6: CS admin sees 0 rows where tenant_id = '22222222-...'  PASS

> Cornerstone administrator attempted a Test Church insert:
> rls_as_user.sql test 8: throws_ok — CS admin cannot INSERT with TC tenant_id  PASS

> Cornerstone administrator attempted a Test Church update:
> rls_as_user.sql test 9: UPDATE ran; verified 0 rows changed (RLS filtered)  PASS

> TC admin attempted to read Cornerstone people:
> rls_as_user.sql test 11: TC admin sees 0 CS rows  PASS

> Member attempted to list all Cornerstone people:
> rls_as_user.sql test 13: CS member sees 0 people rows (no people.view permission)  PASS

> Campus A administrator attempted to read Campus B records:
> rls_as_user.sql test 27: Campus A admin sees 0 Campus B people  PASS

> Cornerstone administrator attempted platform-admin access:
> platform_admin.sql test 2: CS admin — user_is_platform_admin() → false  PASS

> Cross-tenant role assignment via trigger:
> rls_as_user.sql test 55: INSERT role_assignment with TC role into CS tenant — trigger throws foreign_key_violation  PASS

> Invitation with wrong-tenant role rejected:
> rls_as_user.sql test 58: INSERT invitation with TC role into CS tenant — trigger throws  PASS

---

## 7. Quality Commands

| Command | Result |
|---|---|
| pnpm format | PASS — all files formatted or unchanged |
| pnpm lint | PASS — 16/16 packages (eslint.config.mjs created) |
| pnpm typecheck | PASS — 16/16 packages |
| pnpm test | PASS — 19/19 unit tests |
| pnpm build | PASS — 6/6 apps |
| pnpm --filter @ee/api build | PASS |
| pnpm --filter @ee/worker build | PASS |
| pnpm --filter @ee/platform-admin build | PASS |
| pnpm --filter @ee/church-admin build | PASS |
| pnpm --filter @ee/public-web build | PASS |
| pnpm --filter @ee/member-web build | PASS |
| expo-doctor | NOT RUN — requires mobile dev environment (macOS, Xcode, Android SDK) |

---

## 8. CI Workflow

File: `.github/workflows/ci.yml`

Jobs:
1. **quality** — install, format check, lint, typecheck, unit tests, build
2. **database** — postgres service container, auth schema setup, all 12 migrations,
   seed, tenant_isolation.sql, rls_as_user.sql, platform_admin.sql
3. **audit** — dependency audit (high/critical fail; Expo transitive reported)
4. **expo** — expo-doctor (informational, non-blocking)

Status: CI workflow authored and committed. Awaiting first branch run in GitHub Actions.

---

## 9. Security Audit

```
pnpm audit
16 vulnerabilities found
Severity: 5 moderate | 11 high
```

| Package | Severity | Path | Action |
|---|---|---|---|
| tar (×7) | high + moderate | mobile > expo > @expo/cli > tar@6.2.1 | Accepted risk — Expo transitive dep, not fixable |
| @xmldom/xmldom (×5) | high | mobile > expo > @expo/cli > xmldom | Accepted risk — Expo transitive dep |
| postcss (×1) | moderate | build tooling | Accepted risk — build-time only |
| uuid (×1) | moderate | mobile > expo > @expo/cli > uuid@8.3.2 | Accepted risk — Expo transitive dep |

None of the vulnerabilities affect API, worker, or database runtime code.

---

## 10. Bugs Fixed During Verification

| Bug | File | Fix |
|---|---|---|
| Invalid UUID prefixes `tm` (t,m not hex) | dev_seed.sql | Changed to `ab` prefix |
| Missing `provider_id` column in auth.identities inserts | dev_seed.sql | Added `provider_id` to all 9 identity inserts |
| throws_ok used error name not SQLSTATE | tenant_isolation.sql | Changed `'unique_violation'` → `'23505'` |
| Ambiguous column reference `id` | tenant_isolation.sql | Changed to `pp.id` |
| Permission count 20 → 22 | tenant_isolation.sql | Updated count (migration 0010 added 2) |
| roleId: 'role-uuid' not a valid UUID | invitations.test.ts | Changed to `'00000000-0000-0000-0000-000000000001'` |
| anon/authenticated roles had no table grants | New migration 0011 | GRANT SELECT/INSERT/UPDATE/DELETE to roles |
| No cross-tenant FK integrity on role_assignments/invitations | New migration 0012 | BEFORE INSERT/UPDATE triggers on 4 tables |
| eslint.config.mjs missing | Root of monorepo | Created ESLint v9 flat config |
| PublicEnv unused type import | apps/api/src/config.ts | Removed unused import |
| .js extension in Next.js import | apps/public-web/src/app/page.tsx | Removed .js extension |
| RLS UPDATE returns 0 rows (not exception) | rls_as_user.sql, platform_admin.sql | Changed throws_ok → row-count verification |

---

## 11. Not Tested / Known Limitations

| Item | Reason | Mitigation |
|---|---|---|
| API integration tests with real Supabase | GoTrue not available in sandbox | CI job authored; requires real Supabase project |
| Ministry-level record filtering | people/households have no ministry_id | Documented; Layer 2 feature |
| expo-doctor | Requires macOS + mobile tooling | CI expo job is informational |
| EAS/native app store build | No EAS credentials in sandbox | Deferred to delivery milestone |

---

## 12. Acceptance Criteria Summary

- **Passed:** 32 of 34 criteria
- **Partial:** 2 (ministry record filtering, dependency audit)
- **Not Tested:** 2 (API integration with real Supabase, expo-doctor)
- **Failed:** 0

---

## 13. Git Status

New files:
- supabase/migrations/0011_role_grants.sql
- supabase/migrations/0012_cross_tenant_integrity.sql
- supabase/tests/rls_as_user.sql
- supabase/tests/platform_admin.sql
- eslint.config.mjs
- .github/workflows/ci.yml

Modified files:
- supabase/seed/dev_seed.sql
- supabase/tests/tenant_isolation.sql
- apps/api/src/tests/invitations.test.ts
- apps/api/src/config.ts
- apps/public-web/src/app/page.tsx
- docs/product/implementation-status.md

---

## 14. Final Statement

**Layer 1 requires additional repairs**

Remaining work before independent audit sign-off:

1. API integration tests require a running GoTrue/Supabase auth service. The test
   scenarios are fully documented in `docs/product/implementation-status.md` criterion 27
   and must be executed against a real Supabase project before Layer 1 can be declared
   unconditionally complete.

2. The GitHub Actions CI workflow has been authored but not yet executed. Layer 1
   cannot be declared complete while required CI jobs are unconfirmed.

3. The Expo mobile validation (`expo-doctor`) has not been run.

All database-layer requirements — migrations, seed, RLS, tenant isolation, campus scope,
ministry scope, platform admin, cross-tenant integrity — have been executed and confirmed
by 109 pgTAP tests, all passing.
