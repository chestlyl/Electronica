# The Engagement Engine

A multi-tenant church platform — website, mobile, community, ChMS, media, LMS, giving, and AI administration.

---

## Architecture summary

The platform is built as a pnpm monorepo with Turborepo. Every church runs as an independent **tenant** with strict data isolation. Cornerstone Church (Akron, Ohio) is the first pilot tenant.

```
engagement-engine-platform/
├── apps/                  Seven application entry points
│   ├── platform-admin/    SaaS owner interface (Next.js)
│   ├── church-admin/      Church staff back office (Next.js)
│   ├── public-web/        Multi-tenant public website (Next.js)
│   ├── member-web/        Logged-in member portal (Next.js)
│   ├── mobile/            iOS + Android app (Expo)
│   ├── api/               Central privileged API (Hono/Node)
│   └── worker/            Background jobs (Node)
│
├── packages/              Shared code
│   ├── database/          Supabase client factory
│   ├── domain/            TypeScript types + error classes
│   ├── authentication/    Auth resolution helpers
│   ├── permissions/       Permission service (hasPermission, getEffectivePermissions)
│   ├── integrations/      Secret provider abstraction
│   ├── validation/        Zod schemas
│   ├── configuration/     Env variable validation
│   ├── ui-web/            Shared web components (Layer 2+)
│   └── ui-native/         Shared native components (Layer 2+)
│
├── supabase/              PostgreSQL via Supabase
│   ├── migrations/        Sequential migration files
│   ├── seed/              dev_seed.sql + production_bootstrap.sql
│   ├── tests/             pgTAP tenant isolation tests
│   └── functions/         Edge function scaffolding
│
├── tenants/               Per-tenant configuration
│   ├── cornerstone/       Pilot tenant (Cornerstone Church, Akron OH)
│   └── test-church/       Isolation test tenant (dev/test only)
│
└── docs/                  Architecture, security, and setup docs
```

---

## Requirements

- **Node.js** >= 20
- **pnpm** >= 9 (`npm install -g pnpm`)
- **Supabase CLI** ([docs](https://supabase.com/docs/guides/cli))
- **Docker** (for local Supabase)

---

## Local setup

```bash
# 1. Enter the monorepo
cd engagement-engine-platform

# 2. Install dependencies
pnpm install

# 3. Copy environment variables
cp .env.example .env
# Edit .env and fill in Supabase values after starting local Supabase

# 4. Start local Supabase
supabase start

# 5. Apply migrations
supabase db reset

# 6. Seed development data
supabase db reset  # reset includes seed via seed.sql if configured, or:
psql "$DATABASE_URL" -f supabase/seed/dev_seed.sql

# 7. Run all apps (dev mode)
pnpm dev
```

See [`docs/setup/local-development.md`](docs/setup/local-development.md) for complete instructions.

---

## Development commands

| Command          | Description                 |
| ---------------- | --------------------------- |
| `pnpm dev`       | Start all apps in parallel  |
| `pnpm build`     | Build all apps and packages |
| `pnpm typecheck` | TypeScript type-check all   |
| `pnpm lint`      | Lint all                    |
| `pnpm format`    | Format all with Prettier    |
| `pnpm test`      | Run all unit tests          |

---

## Supabase commands

| Command             | Description                             |
| ------------------- | --------------------------------------- |
| `supabase start`    | Start local Supabase stack              |
| `supabase db reset` | Reset database and apply all migrations |
| `supabase test db`  | Run pgTAP database tests                |
| `supabase stop`     | Stop local Supabase stack               |

---

## Current implementation status

See [`docs/product/implementation-status.md`](docs/product/implementation-status.md).

---

## Layer 1 coverage

Layer 1 implements the permanent shared platform foundation:

- Monorepo structure ✅
- PostgreSQL data foundation ✅
- Multi-tenant architecture ✅
- Authentication foundation ✅
- Tenant memberships ✅
- Role-based permissions ✅
- Campus and ministry access scopes ✅
- Audit logging ✅
- Tenant settings ✅
- Integration connection scaffolding ✅
- Automated tenant-isolation tests ✅
- Architecture and setup documentation ✅
