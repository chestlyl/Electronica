# CIP API — Base44 ↔ Church Intelligence Agent

The backend seam that lets the Base44 Church Intelligence Platform drive the
research agent without ever touching Claude, Supabase, or the crawler directly.

```
Base44 UI → lib/cipApi.js → CIP API → Church Intelligence Agent → Supabase → dossier repository
```

The backend owns every secret (Anthropic key, Supabase service-role key, Google
Places key, crawler runtime, orchestration). Base44 holds exactly one token.

## Run it

```bash
npm run api        # production (tsx src/api/index.ts)
npm run api:dev    # watch mode
```

Requires `.env`: `CIP_API_KEY` (the shared bearer token), plus `SUPABASE_*`,
`ANTHROPIC_API_KEY`, and (for discovery) `GOOGLE_PLACES_API_KEY`. Listens on
`CIP_API_PORT` (default 4100). Apply `supabase/migrations/0003_cip_api.sql` once.

## Auth

Every endpoint except `GET /health` requires:

```
Authorization: Bearer <CIP_API_KEY>
```

Missing/invalid → `401 {"error":"unauthorized"}`.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/research/known-church` | Start known-church research → `{job_id, church_id, status, message}` |
| POST | `/research/discovery-query` | Start area/metro discovery → `{job_id, status, message}` |
| GET | `/research/jobs/:id` | Poll status → `{status, stage, progress, …, result}` |
| GET | `/churches` | List the researched repository (filters: `q, state, priority, archetype, min_coverage, min_confidence, limit, offset`) |
| GET | `/churches/:id/dossier` | Open a completed dossier (structured sections + `markdown`) |

`status`: `queued | running | complete | failed`.
`stage`: `queued | discovery | extraction | coverage_validation | scoring | dossier_generation | complete | failed`.

Jobs run **in-process and asynchronously**: the POST returns immediately; the
pipeline advances `stage`/`progress` as it runs; failures are caught and stored
in the job's `error` (the server never crashes on a failed research run).

## Architecture (the seam)

- `src/api/contract.ts` — contract types (mirror Base44's `cipApiContract.js`).
- `src/api/store.ts` — `CipStore` interface + `InMemoryCipStore` (tests/offline).
- `src/api/supabaseStore.ts` — `SupabaseCipStore` (production, `cip_*` tables).
- `src/api/pipeline.ts` — `PipelineRunner` interface + `RealPipelineRunner`
  (reuses `buildDossier` / `prospectArea` **unchanged**). Tests inject a mock.
- `src/api/mapper.ts` — pure projection: `DossierBuild` → contract sections +
  church row. Recomputes nothing; invents nothing.
- `src/api/jobs.ts` — in-process async `JobManager` (fail-closed).
- `src/api/app.ts` — `createApp({store, pipeline, apiKey})` (auth + routes).
- `src/api/index.ts` — production entrypoint (wires Supabase + real pipeline).

The `cip_*` tables are intentionally separate from the legacy enrichment tables
(`churches`, `church_research_dossiers`) so this seam never clobbers the imported
spreadsheet repository. IDs are opaque prefixed strings (`job_…`, `church_…`,
`dossier_…`), never raw DB UUIDs.
