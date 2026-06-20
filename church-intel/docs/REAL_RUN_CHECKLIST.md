# Real Run Checklist — one real end-to-end enrichment

Goal: enrich **one** spreadsheet row for real — real website discovery → real
crawl → real Claude extraction → real Supabase write, with evidence stored,
confidence scored, and a review-queue item created if needed.

Do every **Setup** step, confirm `doctor` says **READY**, then run the test.

---

## 1. Local tooling

- [ ] **Node 20+** and npm (`node -v`)
- [ ] Install deps:
  ```bash
  cd church-intel
  npm install
  ```
- [ ] **Chromium for Playwright** (optional but recommended — without it the
      fetch fallback is used automatically):
  ```bash
  npx playwright install chromium
  ```

## 2. Supabase (database = source of truth)

- [ ] Create a project at <https://supabase.com> (free tier is fine)
- [ ] Apply the schema **once** — either:
  - Supabase CLI: `supabase db push`, **or**
  - Studio → SQL Editor → paste `supabase/migrations/0001_initial_schema.sql` → Run
- [ ] From **Project Settings → API**, copy:
  - `Project URL` → `SUPABASE_URL`
  - `service_role` secret key → `SUPABASE_SERVICE_ROLE_KEY` (server-side only; keep secret)

## 3. Claude (Anthropic)

- [ ] Create an API key at <https://console.anthropic.com> → `ANTHROPIC_API_KEY`
- [ ] Pick a model → `CLAUDE_MODEL` (default `claude-sonnet-4-6`; use an Opus
      model for the hardest reasoning). Add a little credit — one church costs
      roughly a few cents.

## 4. `.env`

```bash
cp .env.example .env
```
Fill in at minimum:
```ini
ANTHROPIC_API_KEY=sk-ant-...
CLAUDE_MODEL=claude-sonnet-4-6
SUPABASE_URL=https://<your-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service_role key>
```
Leave the crawl/threshold defaults as-is for the first run.

## 5. Network / egress

Running on your own machine, this is usually already fine. If you are behind a
corporate proxy or in a locked-down/serverless environment, ensure **outbound
HTTPS** is allowed to:

- [ ] `api.anthropic.com` (Claude)
- [ ] `*.supabase.co` (database)
- [ ] `html.duckduckgo.com` (website discovery / search)
- [ ] **arbitrary church domains** (the crawl target — this is the one most
      often blocked by allowlists)

> If you can't open arbitrary outbound hosts, search-based discovery and crawling
> won't work and the run will produce a `research_status` review item instead of
> real data.

## 6. Confirm readiness

```bash
npm run cli -- doctor
```
- [ ] **Every check is PASS** (a WARN on "Playwright Chromium" is OK — it just
      means the fetch fallback will be used). Result must read **READY**.
- Do not proceed while any check is **FAIL**; each FAIL prints its fix.

---

## 7. Run the test

```bash
# Import a few rows (creates row-2 = "14Six", which has a seed website)
npm run cli -- import-spreadsheet --file data/Church_Data_v1.xlsx --limit 5

# Enrich ONE church end-to-end (add --fetch-fallback to force no-browser mode)
npm run cli -- enrich-church --id row-2
```

Watch the logs for: `research: "<query>"`, `crawlMethod=playwright|fetch_fallback`,
per-field lines (`✓ auto-updated`, `? queued for review`, `· evidence only`).

---

## 8. Verify the outcome

Open the dashboard (`npm run dashboard` → <http://localhost:4000>, badge should
read **`supabase`**) **or** run these in the Supabase SQL editor:

| What to confirm | Where / query |
|---|---|
| **Real (not mock) run** | `select run_type, status, model_used, tokens_used, cost_estimate from enrichment_runs order by started_at desc limit 5;` → `model_used` is your real model (not `mock-claude`) and `tokens_used > 0` |
| **Website discovery** | `select website_original, website_verified from churches where original_row_id='row-2';` |
| **Real crawl happened** | `select distinct source_url, source_type from church_evidence where church_id=(select id from churches where original_row_id='row-2');` → real fetched URLs |
| **Supabase write** | `select active_status, lead_pastor, denomination, attendance_estimate from churches where original_row_id='row-2';` |
| **Evidence stored** | `select field_name, proposed_value, confidence_score, source_url from church_evidence where church_id=(select id from churches where original_row_id='row-2') order by checked_at;` |
| **Confidence scored** | non-null `confidence_score` on the evidence rows above; `verification_score` on the church row |
| **Review queue created (if needed)** | `select field_name, current_value, proposed_value, confidence_score, evidence_summary from review_queue where review_status='pending';` → fields scored 60–84 (or a `research_status` item if research failed) |

A clean success looks like: one `enrichment_runs` row (`status=completed`,
real `model_used`, non-zero tokens), several `church_evidence` rows with real
`source_url`s and confidences, some `churches` fields updated, and zero-or-more
`review_queue` items for mid-confidence fields.

---

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `doctor`: Outbound HTTP **FAIL** | Proxy/egress blocks `api.anthropic.com` — allowlist it |
| `doctor`: Search endpoint **WARN** | `html.duckduckgo.com` blocked — discovery limited to seed websites |
| `doctor`: Church website fetch **FAIL** | Arbitrary outbound hosts blocked — open egress / allowlist church domains |
| Run produces only a `research_status` review item | No official site found or no readable pages — check egress and the row's seed website |
| `model_used = mock-claude` | You ran `npm run demo` (offline). Use `npm run cli -- enrich-church` for real |
| Migration error in `doctor` | Run `supabase/migrations/0001_initial_schema.sql` |
| Want to test without a browser | Add `--fetch-fallback` or set `FORCE_FETCH_FALLBACK=true` |
