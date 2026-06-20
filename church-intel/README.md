# Church Intelligence Platform

Turn a stale spreadsheet of churches into a **current, verified, enriched, and
scored** database for [Million Member Church](https://millionmemberchurch.org).

The platform validates whether each church still exists, finds/updates its
website and contact info, classifies denomination & network, estimates
attendance **with a confidence range**, and scores each church for **influence**
and **Million Member Church (MMC) fit** — always keeping the **evidence and
source URLs** behind every value.

- **Supabase** — database, auth, storage, source of truth
- **Playwright** — polite browser automation & web research
- **Claude** — extraction, classification, confidence scoring, summaries
- **TypeScript / Node 20+**

> **Seed file:** `Church_Data_v1.xlsx` — a ~4,900-row Church of the Nazarene
> district roster. Columns: `S.No, Organization Name, Parent Organization Name,
> Address 1/2, City, State, Postal Code, Country, Mailing…, Phone Number, Email,
> Url Name, Website, Language`. The importer auto-detects these (and other common
> layouts) and preserves all original values.

---

## How it works

```
spreadsheet ─▶ import ─▶ churches table (originals preserved)
                              │
                 ┌────────────▼─────────────────────────────────┐
                 │  per church: ONE Playwright research pass     │
                 │  search → official site → polite crawl of     │
                 │  About/Staff/Beliefs/Contact/Missions/…       │
                 └────────────┬─────────────────────────────────┘
                              │ shared page text + sources
   ┌──────────┬──────────┬───┴──────┬───────────┬───────────────┐
   ▼          ▼          ▼          ▼           ▼
 Verify   Contact   Denomination   Size      Multiplication
 agent    agent       agent       agent       + scoring
   │          │          │          │           │
   └──────────┴────┬─────┴──────────┴───────────┘
                   ▼
        each proposed value + confidence + evidence
                   ▼
   confidence ≥ 85 → update church directly
   confidence 60–84 → review_queue (human approves in dashboard)
   confidence < 60  → evidence saved only, field untouched
```

Every agent writes rows to **`church_evidence`** (proposed value, quoted
evidence, source URL, source type, confidence) and logs an **`enrichment_runs`**
record (status, model, tokens, cost).

---

## Setup

### 1. Install

```bash
cd church-intel
npm install            # also installs the Playwright Chromium browser
cp .env.example .env   # then fill in the values
```

### 2. Create the Supabase schema

Run the migration in `supabase/migrations/0001_initial_schema.sql`:

```bash
# Option A — Supabase CLI
supabase db push

# Option B — paste the file into the Supabase Studio SQL editor and run it
```

This creates `churches`, `church_evidence`, `enrichment_runs`, `review_queue`,
the enums, indexes, an `updated_at` trigger, and two helper views.

### 3. Configure `.env`

| Variable | Purpose |
|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Database access (server-side). |
| `ANTHROPIC_API_KEY`, `CLAUDE_MODEL` | Claude for extraction/scoring. Default `claude-sonnet-4-6`; use an Opus model for hardest reasoning. |
| `CLAUDE_INPUT_COST_PER_MTOK`, `CLAUDE_OUTPUT_COST_PER_MTOK` | USD/1M tokens, used for `cost_estimate`. |
| `CRAWLER_USER_AGENT`, `CRAWL_DELAY_MS`, `MAX_PAGES_PER_SITE`, `PAGE_TIMEOUT_MS`, `HEADLESS`, `RESPECT_ROBOTS` | Polite crawling controls. |
| `AUTO_UPDATE_THRESHOLD` (85), `REVIEW_THRESHOLD` (60) | Auto-update vs. review-queue gates. |
| `DASHBOARD_PORT` (4000) | Admin dashboard port. |

See [`.env.example`](.env.example) for the full annotated list.

---

## Try it offline first (no credentials needed)

A reproducible **sample run against 5 churches from the real spreadsheet** using
a file-backed store and **mock** Claude/Playwright providers — same agents, same
scoring, same review-queue gating, no external services:

```bash
npm run demo
```

It imports 5 rows, runs all five agents, prints results + the review queue, and
writes `data/output/sample_output.{json,csv}` and `data/output/demo_db.json`.
You can then open the dashboard against that demo data:

```bash
npm run dashboard      # http://localhost:4000  (mode: demo-json)
```

---

## CLI

Run with `npm run cli -- <command>` (dev) or `church-intel <command>` after
`npm run build && npm link`.

```bash
# Import the seed spreadsheet (auto-detects columns, de-dupes, preserves originals)
npm run cli -- import-spreadsheet --file data/Church_Data_v1.xlsx
npm run cli -- import-spreadsheet --file data/Church_Data_v1.xlsx --limit 100

# Verify a single church (active status + official website)
npm run cli -- verify-church --id row-12          # by original_row_id
npm run cli -- verify-church --id <uuid>          # or by id

# Full enrichment (verify + contact + denomination + size + scoring)
npm run cli -- enrich-church --id row-12

# Batch
npm run cli -- verify-batch --limit 10
npm run cli -- enrich-batch --limit 10 --missing-website

# Scoring only (influence / MMC fit / multiplication)
npm run cli -- score-church --id row-12

# Review queue — approve/reject items, commit approvals to the church record
npm run cli -- process-review-queue
npm run cli -- process-review-queue --approve <review_id> --notes "looks right"
npm run cli -- process-review-queue --reject <review_id>

# Export the enriched table
npm run cli -- export-results --out data/output/churches.xlsx
npm run cli -- export-results --out data/output/high_fit.csv --format csv --min-mmc 70
```

**Recommended first run:**
```bash
npm run cli -- import-spreadsheet --file data/Church_Data_v1.xlsx --limit 5
npm run cli -- enrich-church --id row-2     # single-church workflow end-to-end
# inspect results & review queue, then scale up with enrich-batch
```

---

## Agents

| Agent | Writes | Notes |
|---|---|---|
| **Verification** | `active_status`, `website_verified`, `verification_score` | Detects closure / merger / rename / relocation signals. |
| **Contact** | `email_verified`, `phone_verified`, `lead_pastor` | **Public-facing data only** — no private/gated info, no guessed email patterns. |
| **Denomination & Network** | `denomination`, `network_affiliation` | Classifies into SBC, Assemblies of God, Nazarene, Methodist, Acts 29, ARC, Send Network, NewThing, Converge, EFCA, Vineyard, Foursquare, Exponential, CMN, Independent/Non-Denominational… Returns **"Unknown"** rather than guessing. |
| **Size Estimation** | `attendance_estimate/min/max`, `*_confidence(_tier)`, `staff_count`, `campus_count`, `weekend_services_count` | Evidence hierarchy: published numbers > services/campuses/staff > reviews/followers > photos. **Always** a range + confidence; prefers Unknown over false precision. |
| **Multiplication & MMC Fit** | `multiplication_score`, `influence_score`, `mmc_fit_score`, `church_planting_activity`, `leadership_development_score`, `digital_reach_score` | Scores planting, disciple-making, leadership pipeline, residencies, mission sending, Kingdom collaboration, innovation. |

All Claude prompts (with the shared confidence + ethics rubric) live in
[`src/claude/prompts.ts`](src/claude/prompts.ts).

### Scoring formulas (`src/lib/scoring.ts`)

**Influence Score** = 30% attendance + 20% staff/campus/service complexity +
20% digital reach + 15% network/denominational influence + 15% leadership
development/multiplication.

**MMC Fit Score** = 30% multiplication language + 25% church planting activity +
20% leadership development + 15% Kingdom collaboration + 10% openness/innovation.

### Confidence & auto-update rules (`src/lib/confidence.ts`)

| Confidence | Evidence quality | Action |
|---|---|---|
| 90–100 | direct from official site / report | auto-update (≥85) |
| 75–89 | strong, multi-source | auto-update (≥85) / review |
| 60–74 | plausible but incomplete | → `review_queue` |
| 40–59 | weak / indirect | evidence saved only |
| < 40 | insufficient | evidence saved only |

Thresholds are configurable via `AUTO_UPDATE_THRESHOLD` / `REVIEW_THRESHOLD`.

---

## Admin dashboard

```bash
npm run dashboard      # http://localhost:4000
```

- List & search churches; filter by active status, **missing website/email/pastor**, and **min MMC fit**
- Per-church detail: every field, its **evidence**, **confidence**, and **source URLs**
- Review-queue tab: **approve / reject / needs-more-research** (approving applies the change to the church record)

Uses Supabase when configured; otherwise serves the offline demo store so you can
explore `npm run demo` output without any credentials.

---

## Safety & ethics (enforced in code + prompts)

- Public web sources only; the crawler honors **robots.txt** (`RESPECT_ROBOTS=true`) and uses polite **rate limits** (`CRAWL_DELAY_MS`).
- **No** bypassing paywalls, CAPTCHAs, logins, or anti-bot protections.
- **No** scraping of personal/private information — public org contact + staff pages only.
- **No** outreach emails are ever sent.
- Confidence is never overstated; every value retains its evidence and source URL.

---

## Project structure

```
church-intel/
├─ supabase/migrations/0001_initial_schema.sql   # tables, enums, indexes, views
├─ src/
│  ├─ config.ts            # env config + thresholds
│  ├─ types.ts             # table types
│  ├─ db/                  # Store interface + Supabase & JSON implementations
│  ├─ lib/                 # logger, confidence rules, scoring formulas
│  ├─ claude/              # LLM provider (Anthropic + mock) + all prompts
│  ├─ research/            # Playwright crawler, web search, robots.txt
│  ├─ agents/              # 5 agents + orchestrator (verify/enrich/score)
│  ├─ importer/            # spreadsheet column-map + import script
│  ├─ review.ts            # review-queue workflow
│  ├─ export.ts            # export-results
│  ├─ cli.ts               # all CLI commands
│  └─ demo.ts              # offline 5-church sample run
├─ web/                    # Express API + static admin dashboard
└─ data/                   # seed spreadsheet + outputs
```

## Notes on the seed data

- `Parent Organization Name` (e.g. "South Central Ohio") is a Nazarene **district**;
  it's preserved as a seed hint in `notes`/`network_affiliation` but is **re-verified**
  by the Denomination agent rather than trusted blindly.
- Some rows have data-quality issues (e.g. a name parsed by Excel as a time like
  `26:16:00`). The importer detects these, still imports the row, and records an
  **import warning** in `notes` for manual review.
- The community build of `xlsx` (SheetJS) is used for import/export; for
  externally-sourced files you may prefer the official SheetJS CDN package.
```
