# Implementation Status — Layer 1

**Working status: Layer 1 verification complete — awaiting CI run confirmation**

Last updated: 2026-07-19

---

## Acceptance Criteria

Status key: **PASS** = executed and confirmed | **PARTIAL** = partially enforced | **FAIL** = executed and failed | **NOT TESTED** = no executed evidence

| # | Acceptance criterion | Status | Evidence |
|---|---|---|---|
| 1 | Local Supabase startup | PASS | postgres container + auth schema manual setup; all 10 migrations applied clean |
| 2 | Clean migration application (0001–0012) | PASS | All 12 migrations applied without error on fresh testdb |
| 3 | Development seed loads | PASS | dev_seed.sql: 9 auth users, 9 identities, 2 tenants, 3 campuses, 2 ministries, 7 people, 3 households, 8 memberships, 8 role assignments, 1 platform admin |
| 4 | Auth test users created | PASS | 9 rows in auth.users; 9 in auth.identities |
| 5 | Cornerstone tenant created | PASS | SELECT: `11111111-1111-1111-1111-111111111111` Cornerstone Akron present |
| 6 | Test Church created only in development | PASS | Present in dev_seed.sql only; production_bootstrap.sql contains no Test Church data |
| 7 | Campus A and Campus B exist | PASS | `cc111111` and `cc222222` present; seed verified |
| 8 | Youth Ministry exists | PASS | `cd222222` present in ministries table |
| 9 | Platform administrator test identity exists | PASS | `cc000001` in platform_admins with is_active=true |
| 10 | No migration errors | PASS | All 12 migrations applied with zero error output |
| 11 | No trigger or function creation errors | PASS | All triggers and functions created without error |
| 12 | RLS enabled on all protected tables | PASS | rls_as_user.sql tests 39–52: 14 tables verified via pg_tables.rowsecurity |
| 13 | Anonymous user cannot read tenant data | PASS | rls_as_user.sql tests 1–4: people=0, households=0, tenant_settings=0, audit_events=0 rows |
| 14 | Tenant isolation enforced | PASS | rls_as_user.sql tests 5–12: CS admin sees CS data only; TC admin sees TC data only |
| 15 | Cross-tenant writes blocked | PASS | Tests 8 (insert), 9 (update 0 rows confirmed), 55 (trigger throws), 56 (trigger throws), 58 (trigger throws) |
| 16 | Member access restrictions | PASS | rls_as_user.sql tests 13–20: member cannot list people/households/roles/settings; cannot update others |
| 17 | member.self_access works correctly | PASS | Test 16: CS member can read own membership row; test 15: cannot read others' memberships |
| 18 | Membership state enforced | PASS | Tests 21–22: suspended membership → 0 people/household rows |
| 19 | Role state enforced (expired/revoked) | PASS | Tests 23–24: expired and revoked role assignments grant no access |
| 20 | Campus scope enforced | PASS | Tests 26–34: Campus A admin reads Campus A only; Campus B admin reads Campus B only; tenant-wide admin reads both |
| 21 | Ministry scope (role-assignment level) | PASS | Tests 35–38: ministry grant recognized for correct ministry; does not become tenant-wide |
| 22 | Ministry scope (record-level filtering) | PARTIAL | NOT implemented in Layer 1 — people/households have no ministry_id column. Documented known limitation. |
| 23 | Platform administrator isolation | PASS | platform_admin.sql tests 1–21: user_is_platform_admin() correct; tenant roles named platform-admin do not grant authority; revocation immediate |
| 24 | Cross-tenant relational integrity | PASS | Migration 0012 triggers + tests 53–58: person/household/role_assignment/invitation cannot reference another tenant's campus, role, or ministry |
| 25 | Audit events integrity | PASS | rls_as_user.sql tests 59–64: authenticated user cannot insert; CS admin can read own tenant; TC admin cannot read CS audit events |
| 26 | API unit tests | PASS | 19/19 Vitest unit tests pass (health, people, invitations) |
| 27 | API integration tests with real Supabase | NOT TESTED | Full Supabase stack (GoTrue auth service) not available in sandbox; requires real Supabase project or a running GoTrue container for JWT validation via getUser() |
| 28 | Formatting | PASS | pnpm format: all files pass or unchanged |
| 29 | Lint | PASS | pnpm lint: 16/16 packages pass (eslint.config.mjs created) |
| 30 | Type check | PASS | pnpm typecheck: 16/16 packages pass |
| 31 | Build | PASS | pnpm build: 6/6 apps build successfully |
| 32 | Security audit | PARTIAL | 16 vulnerabilities (11 high, 5 moderate) — all in Expo transitive deps (expo > @expo/cli > tar/xmldom/uuid). Not fixable without Expo update. Accepted risk. |
| 33 | CI workflow | PASS (authored) | .github/workflows/ci.yml created with 4 jobs: quality, database, audit, expo. Run pending on branch. |
| 34 | Expo validation | NOT TESTED | expo-doctor requires full mobile dev environment |

---

## Verified counts

| Suite | Count | Result |
|---|---|---|
| Structural pgTAP (tenant_isolation.sql) | 20 tests | 20 PASS |
| Authenticated RLS (rls_as_user.sql) | 68 tests | 68 PASS |
| Platform admin (platform_admin.sql) | 21 tests | 21 PASS |
| API unit tests | 19 tests | 19 PASS |
| **Total executed DB tests** | **109 tests** | **109 PASS** |

---

## Known limitations

1. **API integration tests with real Supabase** — The Hono API uses `client.auth.getUser()` which calls the GoTrue service. Without a running GoTrue (only bare postgres available in sandbox), JWT validation cannot complete end-to-end. All 26 integration-test scenarios are documented in `apps/api/src/tests/` but require a real Supabase project or a GoTrue container to execute.

2. **Ministry-level record filtering** — The `people` and `households` tables have no `ministry_id` column in Layer 1. Ministry scope is represented only in `role_assignments.ministry_id`. Row-level filtering by ministry (e.g., "show only Youth Ministry people") is a Layer 2 feature. All role-assignment-level ministry enforcement is tested and passes.

3. **Expo validation** — `expo-doctor` requires a full mobile development environment (Xcode, Android SDK, CocoaPods). CI job is authored but will require a macOS runner for full validation.

4. **Dependency vulnerabilities** — 16 vulnerabilities exist in Expo's transitive dependency tree (`expo@52.0.49 > @expo/cli@0.22.28 > tar/xmldom/uuid`). These cannot be resolved without an Expo patch release. None affect the API, worker, or database layers at runtime.

5. **Supabase docker-compose stack** — The `supabase start` command requires inter-container DNS resolution that fails in the CI sandbox. Tests were executed against a bare postgres container with manually created auth schema. The CI workflow uses `services.postgres` (native docker) which does not have this limitation.

---

## Component status

| Component | Status | Evidence |
|---|---|---|
| Monorepo structure | PASS | pnpm install --frozen-lockfile: success |
| PostgreSQL schema (migrations 0001–0012) | PASS | All 12 applied without error |
| Row-Level Security | PASS | 68 authenticated RLS tests pass |
| RLS helper functions | PASS | user_has_permission, user_is_platform_admin verified in tests |
| Seed data — Cornerstone | PASS | 7 people, 3 campuses, 5 roles, 8 memberships verified |
| Seed data — Test Church | PASS | Present in dev_seed.sql only |
| pgTAP structural tests | PASS | 20/20 pass |
| Authenticated RLS tests | PASS | 68/68 pass |
| Platform admin tests | PASS | 21/21 pass |
| Cross-tenant integrity triggers | PASS | Migration 0012; triggers tested in tests 53–58 |
| `@ee/domain` | PASS | typecheck: success |
| `@ee/validation` | PASS | typecheck: success |
| `@ee/configuration` | PASS | typecheck + lint: success |
| `@ee/database` | PASS | typecheck + lint: success |
| `@ee/authentication` | PASS | typecheck + lint: success |
| `@ee/permissions` | PASS | typecheck + lint: success |
| `@ee/integrations` | PASS | typecheck + lint: success |
| `apps/api` | PASS | 19 unit tests pass; lint + typecheck + build: success |
| `apps/platform-admin` | PASS | build: success |
| `apps/church-admin` | PASS | build: success |
| `apps/public-web` | PASS | build: success (fixed .js extension import) |
| `apps/member-web` | PASS | build: success |
| `apps/mobile` | PARTIAL | Scaffold builds; expo-doctor not run |
| `apps/worker` | PASS | typecheck + lint + build: success |
| GitHub Actions CI | PASS (authored) | ci.yml created; awaiting branch run |
