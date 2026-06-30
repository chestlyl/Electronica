# Church Intelligence Platform — Frontend

Next.js 15 + TypeScript + Tailwind + React Query. An executive-grade intelligence
workspace over the **CIP API** (the `church-intel` Express backend). Dark by
default, data-dense, Palantir/Linear direction.

## Architecture

```
Browser ──► Next.js (this app) ──► /api/cip/* proxy ──► CIP API (church-intel) ──► Supabase ──► agent pipeline
```

The browser never sees the CIP key — every request goes through the Next.js
server proxy (`app/api/cip/[...path]/route.ts`), which injects
`Authorization: Bearer ${CIP_API_KEY}` server-side.

## Run it

1. Start the CIP API (in `../church-intel`):
   ```bash
   cd ../church-intel && npm run api      # listens on :4100
   ```
2. Configure + run the frontend:
   ```bash
   cp .env.example .env.local             # set CIP_API_KEY (= the API's CIP_API_KEY)
   npm install
   npm run dev                            # http://localhost:3000
   ```

## Pages

| Route | Page |
|---|---|
| `/` | Dashboard — totals, top opportunities, recent dossiers, archetype/state breakdowns, activity |
| `/research` | Known-church + market-research forms |
| `/queue` | Research Queue — jobs by status with live progress + retry |
| `/repository` | Church Repository — filterable table |
| `/churches/[id]` | Church Detail — identity, coverage, size, leadership, contact intelligence, tech stack, signals, scores, recommendations, evidence |
| `/dossiers` | Dossier list + Markdown download |
| `/settings` | API status + preferences |

## Status / next

Built this pass: full app shell, design system, server proxy, typed client, and
all core pages wired to live endpoints. Follow-ups: Supabase Auth, saved
views/bulk actions in the repository, market-results table, PDF/DOCX export,
richer dashboard charts, and team/billing.
