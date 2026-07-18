# Local Development Setup

## Prerequisites

### Node.js (>= 20)

```bash
node --version   # should be 20+
```

Use [nvm](https://github.com/nvm-sh/nvm) or [fnm](https://github.com/Schniz/fnm) to manage versions.

### pnpm (>= 9)

```bash
npm install -g pnpm
pnpm --version
```

### Supabase CLI

```bash
# macOS
brew install supabase/tap/supabase

# npm (all platforms)
npm install -g supabase

supabase --version   # should be >= 1.200
```

### Docker

Supabase local development requires Docker. Install [Docker Desktop](https://www.docker.com/products/docker-desktop/) and ensure it is running before proceeding.

---

## 1. Clone and enter the monorepo

```bash
cd engagement-engine-platform
```

---

## 2. Install dependencies

```bash
pnpm install
```

This installs all workspace dependencies across apps and packages.

---

## 3. Configure environment variables

```bash
cp .env.example .env
```

Start Supabase (step 4) and then fill in the values it prints.

---

## 4. Start local Supabase

```bash
supabase start
```

This starts PostgreSQL, Auth, Storage, Studio, and Inbucket locally via Docker. When it finishes, it prints credentials including:
- **API URL** → `NEXT_PUBLIC_SUPABASE_URL`
- **anon key** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- **service_role key** → `SUPABASE_SERVICE_ROLE_KEY`
- **DB URL** → `DATABASE_URL`
- **JWT secret** → `SUPABASE_JWT_SECRET`

Copy these values into your `.env` file.

---

## 5. Apply migrations and seed data

```bash
# Apply all migrations from scratch and load development seed
supabase db reset
```

`db reset` applies every file in `supabase/migrations/` in order, then runs `supabase/seed/dev_seed.sql` if configured in `supabase/config.toml`.

To seed manually:

```bash
psql "$DATABASE_URL" -f supabase/seed/dev_seed.sql
```

---

## 6. Run the applications

Start all applications in development mode:

```bash
pnpm dev
```

Or run a specific application:

```bash
pnpm --filter @ee/api dev
pnpm --filter @ee/church-admin dev
pnpm --filter @ee/platform-admin dev
```

Default ports:

| App | Port |
|-----|------|
| platform-admin | 3000 |
| church-admin | 3001 |
| public-web | 3002 |
| member-web | 3003 |
| api | 4000 |
| Supabase Studio | 54323 |

---

## 7. Run unit tests

```bash
pnpm test
```

Or for a specific package:

```bash
pnpm --filter @ee/api test
pnpm --filter @ee/worker test
```

---

## 8. Run database tests

pgTAP must be installed in your Supabase instance. The local Supabase stack includes it.

```bash
supabase test db
```

This runs all `.sql` files in `supabase/tests/`.

---

## 9. Run type checking

```bash
pnpm typecheck
```

---

## 10. Run linting and formatting

```bash
pnpm lint
pnpm format
```

---

## 11. Reset the database

To wipe the database and start fresh:

```bash
supabase db reset
```

This drops and recreates the database, applies all migrations, and runs the seed.

---

## 12. Stop Supabase

```bash
supabase stop
```

---

## Troubleshooting

### Docker not running
Supabase requires Docker. Ensure Docker Desktop is running before `supabase start`.

### Port conflicts
If ports 54321–54324 are in use, stop the conflicting services or edit `supabase/config.toml`.

### Missing environment variables
The API and worker will throw on startup if required variables are missing. Check `.env` against `.env.example`.
