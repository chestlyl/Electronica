# Layer 1 — Platform Foundation Architecture

## Why multi-tenant?

The Engagement Engine is a SaaS platform intended to serve many independent churches. Every church is a **tenant**. Their data, users, roles, and settings are entirely separate from every other tenant.

Multi-tenancy is not an afterthought — it is designed in from the first migration. Building it tenant-aware from day one prevents a painful architectural migration later and ensures every feature is built with isolation as a constraint.

---

## Why Cornerstone is Tenant 1, not a hard-coded church

Cornerstone Church (Akron, Ohio, slug: `cornerstone-akron`) is the first pilot tenant — it appears in seed data with a fixed UUID and status `pilot`.

The software treats Cornerstone identically to any other tenant. There is no hard-coded tenant name, no special-case routing for Cornerstone, and no feature specific to Cornerstone. If Cornerstone were replaced with any other church tomorrow, only the seed data would change.

This matters because:
- Developer habits form around the code they write first.
- If the first tenant is hard-coded, the second tenant will expose every assumption.
- Multi-tenancy must be proved by tests with two tenants (Cornerstone + Test Church) from the beginning.

---

## Tenant resolution

A tenant is resolved from one of three sources, in priority order:

1. **Hostname** (`tenant_domains` table): production sites are mapped by verified hostname.
2. **Tenant ID in the API path** (`/api/tenants/:tenantId`): verified against membership before any data access.
3. **Development slug override**: `public-web` falls back to `cornerstone-akron` on localhost when no hostname resolves.

The resolved tenant ID is **always** verified against the authenticated user's `tenant_memberships` on the server. A client-supplied tenant ID is never trusted on its own.

---

## Auth resolution

Authentication uses Supabase Auth. The JWT issued by Supabase contains the authenticated user's UUID (`sub`).

Resolution order in the API:

1. Extract the `Authorization: ****** header from the request.
2. Validate the JWT against Supabase (via `client.auth.getUser()`).
3. Look up the user's `tenant_memberships` for the requested tenant.
4. Reject if no active membership exists.
5. Load the user's `role_assignments` for the tenant.
6. Compute effective permissions via `getEffectivePermissions()`.

---

## Permission resolution

Permissions are resolved in the `@ee/permissions` package.

### Denial by default

A user with no role assignments has no permissions. There is no implicit grant.

### Scope preservation

A role assignment may be:
- **Tenant-wide**: `campus_id IS NULL AND ministry_id IS NULL`
- **Campus-scoped**: `campus_id IS NOT NULL`
- **Ministry-scoped**: `ministry_id IS NOT NULL`

`getEffectivePermissions()` returns a `ScopedPermission[]` array that preserves all scope information. It does NOT flatten to a name-only list, because doing so would lose campus/ministry context.

`hasPermission()` checks whether any scoped grant satisfies the requested permission + optional campus/ministry filter. A tenant-wide grant satisfies any scoped check.

---

## Domain service architecture

Each domain area has a service that follows this contract:

1. Validate input (Zod)
2. Resolve tenant (verify membership)
3. Check permission
4. Enforce scope (campus/ministry if applicable)
5. Execute database transaction
6. Write audit event
7. Return typed output
8. Never expose internal errors or secrets

Services live in the API application (`apps/api/src/routes/`) for Layer 1. They will be extracted to `packages/domain/` services in Layer 2 when the AI assistant requires them.

---

## API boundaries

| Boundary | Rule |
|----------|------|
| Client → API | Execute all business logic in API; never in client bundles |
| API → Supabase (user operations) | User JWT client for RLS-governed reads |
| API → Supabase (privileged writes) | Service-role client for audit inserts, constraint bypasses |
| API → Worker | Internal message queue (future) |
| API → Integrations | Via `@ee/integrations` secret provider |
| Mobile → API | Same JWT authentication pattern as web |
| Supabase service key | Only in `apps/api` and `apps/worker`, never in Next.js client bundles |

---

## Future application architecture

```
Layer 2+:
  public-web     → Page builder, sermon content
  church-admin   → People, groups, events, giving modules
  member-web     → Feed, giving, groups
  mobile         → Full Expo app with deep linking
  api            → AI assistant endpoints, streaming
  worker         → Import/export, email, SMS, webhooks
  platform-admin → Plan management, billing, feature flags
```
