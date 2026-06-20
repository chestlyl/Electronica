# Research Agent Design

> ⚠️ **PROVENANCE NOTE.** Any Cornerstone Church values appearing in this design doc are illustrative examples (mock/synthetic), **not discovered or verified facts**. Only user-provided values are real.

> Status: **proposed** (design only — no implementation yet)
> Supersedes the single-site crawl-then-extract flow for enrichment.

## 1. Motivation — the Cornerstone lesson

When a human (Claude) profiled **Cornerstone Church, Akron** it outperformed the
platform because it did not depend on one website. It:

- established **identity first** (the `.info` TLD ruled out the famous megachurch
  Cornerstones; `site:` search pinned it to Akron);
- triangulated across **search snippets, social channels, staff pages, job
  postings, directories, and conflicting third-party records**;
- **preserved a conflict** (church site "Lead Pastor" vs LinkedIn/ZoomInfo
  "Associate Pastor") instead of silently picking one;
- rejected **same-name contamination** (Salt Network / Replant Network belonged
  to *other* Cornerstones);
- and, crucially, **capped its own confidence** because it never fetched the live
  site (HTTP 403): *"I could not fetch the official website, but I found indexed
  evidence from search snippets and third-party sources. Confidence is capped."*

The Research Agent makes that behavior a first-class, repeatable workflow that
produces a **research dossier**, not just extracted fields, and **scores only
after the dossier is built**.

## 2. Goals / non-goals

**Goals**
- Gather evidence from **15 public source types** before scoring.
- Produce a persisted **dossier** + **conflict records** + **contamination flags**.
- Track **evidence access level** per field and **cap confidence** when the
  official site could not be crawled.
- Reproduce the Cornerstone-level research and expose a **3-way calibration**
  (tool vs Claude-manual vs user ground truth).

**Non-goals (unchanged constraints)**
- Public sources only; honor robots.txt + rate limits; no paywalls/CAPTCHAs/logins.
- No scraping of private/personal data; **no invented emails**.
- Vendor/media pages are **supporting evidence only — never official identity**.
- We do not change the existing scoring *formulas* in this change (we feed them
  better inputs); strategic scores are new and additive.

## 3. Core concepts

### 3.1 Source types
`official_site, staff_page, contact_page, about_history, sermon_livestream,
youtube, facebook, instagram, linkedin, job_posting, denom_directory, maps,
church_directory, news_media, vendor_reference`.

### 3.2 Evidence access levels
How the evidence was actually obtained (drives the confidence cap):

| level | meaning | example |
|---|---|---|
| `user_provided_ground_truth` | human-verified | calibration file |
| `live_official_site` | the church's own DOM was fetched | Playwright/fetch 200 |
| `staff_profile` | official staff/contact page content | /staff page |
| `social_profile` | church-owned social page | FB/IG/YouTube |
| `job_posting` | a hiring post by the church | ministryjobs |
| `third_party_directory` | directory/maps listing | denom directory, Apple Maps |
| `search_snippets` | indexed snippet, page NOT fetched | DuckDuckGo result text |
| `vendor_reference` | vendor/media page about the church | contractor portfolio |

### 3.3 Source reliability weights (0–1)
Used to rank evidence and recommend conflict winners.

```
user_provided_ground_truth 1.00
live_official_site         0.95
staff_page (official)      0.90
denom_directory            0.80
maps                       0.75
job_posting (church)       0.75
social_profile (owned)     0.70
news_media                 0.55
linkedin                   0.55
search_snippets            0.50
general church_directory   0.50
zoominfo / data-broker     0.35   (weak, supporting only)
vendor_reference           0.20   (never identity)
```

### 3.4 The dossier
A structured, persisted object: per-source findings, per-field estimates (value +
confidence + evidence + access level + provenance), narrative summaries,
conflicts, contamination flags, and source counts. Scoring reads the dossier.

## 4. Architecture

```
research-church / research-dossier
            │
            ▼
   ┌──────────────────────────────────────────────┐
   │            ResearchAgent.orchestrate          │
   │                                               │
   │  1. establishIdentity()  ← discovery.ts       │
   │       (identity-first, contamination-aware)   │
   │  2..7 collectors (parallel, polite):          │
   │     WebsiteCollector   SearchSnippetCollector │
   │     SocialCollector    StaffCollector         │
   │     JobPostingCollector DirectoryCollector    │
   │     NewsMediaCollector  VendorCollector        │
   │            │  emit SourceFinding[]            │
   │            ▼                                   │
   │  8. detectConflicts()  → research_conflicts   │
   │  9. detectContamination()                     │
   │  10/11. synthesizeDossier()  ← Claude         │
   │       (known / uncertain / per-field)         │
   │  capConfidence(by evidence_access_level)      │
   │            ▼                                   │
   │   persist church_research_dossiers + conflicts│
   │   + write strategic fields to churches        │
   └──────────────────────────────────────────────┘
            │
            ▼  (12) score only after dossier exists
   verification / contact / denom / size / multiplication / strategic scores
```

Collectors implement a common interface:

```ts
interface SourceFinding {
  sourceType: SourceType;
  accessLevel: EvidenceAccessLevel;
  url: string;
  title?: string;
  fetched: boolean;          // did we retrieve actual page content?
  status: number;
  text?: string;             // extracted page text (if fetched)
  snippet?: string;          // search snippet (if not fetched)
  reliability: number;       // 0..1
  fields: ExtractedField[];  // structured candidate values w/ provenance
  fetchedAt: string;
}
interface ExtractedField {
  field_name: string;        // e.g. "lead_pastor", "instagram_followers"
  value: string | number | null;
  confidence: number;        // 0..100 pre-cap
  evidence_text: string;
  source_url: string;
  source_type: SourceType;
  access_level: EvidenceAccessLevel;
}
interface Collector {
  name: string;
  collect(ctx: ResearchContext): Promise<SourceFinding[]>;
}
```

## 5. Collectors

All collectors are **polite** (shared rate limiter, robots, timeouts) and
**degrade gracefully** — a 403/blocked source yields a `fetched:false` finding
with whatever search snippet we have, not a hard failure.

1. **WebsiteCollector** — runs the existing `ResilientResearch` (Playwright →
   fetch fallback) over the identity-confirmed official site, crawling
   About/Staff/Contact/Beliefs/Locations/Sermons/etc. `accessLevel =
   live_official_site` when pages return 200; otherwise it records the attempt
   and the official URL with `fetched:false` so the cap logic knows the DOM was
   never seen. Extracts: name, address, pastor, service times, campuses, giving
   links, app links, livestream links, social links (for other collectors).

2. **SearchSnippetCollector** — the "Claude-like" core. Runs `multiSearch`
   (existing multi-provider) for targeted queries and **keeps the snippets as
   evidence even when the page is not fetched**:
   - `"{name}" {city} {state}` · `site:{domain}`
   - `{name} {city} pastor` · `{name} {city} staff`
   - `{name} {city} attendance|members|size`
   - `{name} {city} app|giving|livestream`
   `accessLevel = search_snippets`, reliability 0.5.

3. **SocialCollector** — resolves FB/IG/YouTube handles from website links +
   search; captures **follower/subscriber counts** when present in snippets
   (e.g. "1,098 followers"). `accessLevel = social_profile`. (Direct social DOM
   is usually login-gated → snippet evidence is expected and acceptable.)

4. **StaffCollector** — official staff page (highest) + LinkedIn/ZoomInfo
   **snippets only** (weak). Extracts pastor/exec-pastor/staff names + titles
   with provenance. **Email policy:** only record an email if it literally
   appears in public text; never synthesize from a pattern.

5. **JobPostingCollector** — searches ministryjobs / churchstaffing / indeed for
   the church; postings are strong signals of **staff depth + growth intent**.
   `accessLevel = job_posting`.

6. **DirectoryCollector** — denominational directories (identity-confirming),
   Google/Apple Maps (address/phone/review count → size proxy), general church
   directories. `accessLevel = third_party_directory`.

7. **NewsMediaCollector** — news references for community footprint / founding /
   relaunch stories. Supporting only.

8. **VendorCollector** — vendor/contractor/architect references (reuses the
   discovery `vendor_reference` classifier). **Supporting evidence only; can
   contribute facility/size hints but NEVER identity or official site.**

## 6. Identity & contamination

- **Identity** is established up front by `discovery.discoverWebsite` (already
  identity-first: name + city + denom-directory confirmation, vendor/media
  disqualification, NO-MATCH preferred). The dossier records `identity_confidence`
  and the official URL (or `null`).
- **Same-name contamination** is detected when search surfaces candidates that
  are `official_church` **with a city/state conflict** (a different church of the
  same name), or known third-party pages attributing facts from a different
  Cornerstone. Each becomes a `contamination_flags` entry, e.g.
  `"Salt Network attribution comes from cornerstonelife.com (Ames, IA), not this church"`.
  `identity_contamination_flag = true` when any are present.

## 7. Conflict handling

Findings are grouped by `field_name`. Two findings **conflict** when their
normalized values differ materially (string-normalized for names/titles; ±band
for numbers). We **never resolve silently**:

```
research_conflicts:
  field_name      = "lead_pastor_title"
  value_a="Lead Pastor"      source_a="cornerstonechurch.info (live_official_site/staff_page)"
  value_b="Associate Pastor" source_b="linkedin.com/zoominfo (search_snippets)"
  conflict_summary= "Church site lists Lead Pastor since the 2020 relaunch; broker
                     data lists Associate Pastor (likely stale)."
  recommended_value = "Lead Pastor"     # higher reliability source wins
  confidence = 60                        # lowered because a conflict exists
```

`recommended_value` = the value from the higher **reliability × access-level**
source; `confidence` is **reduced** whenever an unresolved conflict exists. The
conflict is preserved for human review regardless.

## 8. Dossier synthesis (Claude) + confidence capping

After collection, a compact **evidence bundle** (top findings per source, with
access levels) is sent to Claude with a synthesis prompt that returns:

- narrative summaries: `research_summary, identity_summary, digital_summary,
  staff_summary, growth_summary, lifecycle_summary`
- per-field estimates (existing + new strategic fields) with confidence + the
  evidence/source behind each
- explicit **"what is known"** and **"what is uncertain"** lists
- conflicts + contamination it observed

The model is instructed to reason like the Cornerstone case and **not optimize
for confidence**. After synthesis we apply a deterministic **cap**:

| best evidence access achieved | confidence cap |
|---|---|
| `user_provided_ground_truth` (per field) | 100 |
| `live_official_site` crawled | 95 (no extra cap) |
| official site NOT crawled, but staff/directory/social present | **75** |
| only `search_snippets` | **65** |
| only `vendor_reference` / `news_media` | **40** |

The cap is applied per field by its own best access level, and the dossier-level
`evidence_access_level` records the best level achieved overall. This is the
mechanism that lets the tool say, verbatim, *"I could not fetch the official
website … confidence is capped."*

`research_confidence` = weighted blend of source coverage (how many of the 15
source types produced evidence), official-source presence, and conflict count.

## 9. New strategic fields (on `churches`)

| field | type | how derived |
|---|---|---|
| `lifecycle_stage` | enum: `plant, growing, established, relaunch_revitalization, plateaued, declining, merged, closed, unknown` | history/relaunch language, founding year, trend signals |
| `growth_orientation_score` | 0–100 | hiring, new ministries, modern rebrand, outreach mission |
| `digital_maturity_score` | 0–100 | web + livestream + app + social + giving + email/text stack |
| `change_readiness_score` | 0–100 | relaunch/rebrand, young leadership, new tooling (Cornerstone's top signal) |
| `staff_depth_score` | 0–100 | staff-page headcount + job postings + role breadth |
| `evidence_access_level` | text | best access level achieved |
| `identity_contamination_flag` | bool | any same-name contamination detected |
| `research_confidence` | 0–100 | dossier coverage/quality |
| `church_app_status` | enum: `active, planned, none_found, unknown` | app-store + site link detection |
| `app_provider` | text | Subsplash/Church Center/Pushpay/etc. when detectable |
| `online_attendance_estimate` | int | livestream viewers / on-demand signals |
| `online_attendance_confidence` | 0–100 | capped by access level |

## 10. Schema proposal (migration `0002_research_agent.sql`)

```sql
-- new enums
create type lifecycle_stage as enum
  ('plant','growing','established','relaunch_revitalization','plateaued',
   'declining','merged','closed','unknown');
create type app_status as enum ('active','planned','none_found','unknown');
create type evidence_access_level as enum
  ('user_provided_ground_truth','live_official_site','staff_profile',
   'social_profile','job_posting','third_party_directory','search_snippets',
   'vendor_reference');

-- strategic fields on churches
alter table churches
  add column lifecycle_stage            lifecycle_stage,
  add column growth_orientation_score   numeric(5,2),
  add column digital_maturity_score     numeric(5,2),
  add column change_readiness_score     numeric(5,2),
  add column staff_depth_score          numeric(5,2),
  add column evidence_access_level      evidence_access_level,
  add column identity_contamination_flag boolean default false,
  add column research_confidence        numeric(5,2),
  add column church_app_status          app_status,
  add column app_provider               text,
  add column online_attendance_estimate integer,
  add column online_attendance_confidence numeric(5,2);

-- dossier (one current dossier per church; history kept in church_evidence/runs)
create table church_research_dossiers (
  id                       uuid primary key default gen_random_uuid(),
  church_id                uuid references churches(id) on delete cascade,
  research_summary         text,
  identity_summary         text,
  digital_summary          text,
  staff_summary            text,
  growth_summary           text,
  lifecycle_summary        text,
  evidence_access_level    evidence_access_level,
  identity_confidence      numeric(5,2),
  research_confidence      numeric(5,2),
  source_count             integer default 0,
  official_source_count    integer default 0,
  secondary_source_count   integer default 0,
  conflict_count           integer default 0,
  contamination_flags      text[],
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create index idx_dossier_church on church_research_dossiers(church_id);

create table research_conflicts (
  id                uuid primary key default gen_random_uuid(),
  church_id         uuid references churches(id) on delete cascade,
  field_name        text not null,
  value_a           text,
  source_a          text,
  value_b           text,
  source_b          text,
  conflict_summary  text,
  recommended_value text,
  confidence        numeric(5,2),
  status            text default 'open',   -- open | resolved
  created_at        timestamptz not null default now()
);
create index idx_conflicts_church on research_conflicts(church_id);
```

> Per-source raw findings continue to be written to the existing
> `church_evidence` table (with `source_type` + new access-level note), so the
> dossier stays a summary layer over the existing append-only evidence log.

## 11. Workflow → code mapping

| step | code |
|---|---|
| 1 establish identity | `discovery.discoverWebsite()` |
| 2 official website | `WebsiteCollector` (ResilientResearch) |
| 3 search snippets | `SearchSnippetCollector` (multiSearch) |
| 4 social | `SocialCollector` |
| 5 staff | `StaffCollector` |
| 6 job postings | `JobPostingCollector` |
| 7 directories | `DirectoryCollector` (+ News/Vendor) |
| 8 conflicts | `detectConflicts()` → `research_conflicts` |
| 9 contamination | `detectContamination()` (discovery rejects + cross-domain attribution) |
| 10 known / 11 uncertain | `synthesizeDossier()` (Claude) |
| 12 score after dossier | existing agents + new strategic scorers read the dossier |

## 12. CLI + output

```
# ad-hoc research, prints a markdown dossier (optionally --save)
npm run cli -- research-church --url https://www.cornerstonechurch.info \
  --name "Cornerstone Church" --city Akron --state OH

# research a stored church; persists dossier + conflicts + strategic fields
npm run cli -- research-dossier --id row-2

# ad-hoc but full dossier build (persists if a matching church exists / --save)
npm run cli -- research-dossier --url https://www.cornerstonechurch.info \
  --name "Cornerstone Church" --city Akron --state OH

# 3-way calibration vs Claude baseline + user ground truth
npm run cli -- research-calibrate --url https://www.cornerstonechurch.info \
  --name "Cornerstone Church" --city Akron --state OH \
  --ground-truth docs/calibration/cornerstone_ground_truth.json
```

**Markdown dossier sections:** Identity · Sources used (with reliability +
access level) · Field estimates (value · confidence · evidence · access level) ·
Conflicts · Contamination flags · What is unknown · Recommended next
verification step.

## 13. Calibration framework

- **Claude baseline:** the manual Cornerstone profile is captured as
  `docs/calibration/cornerstone_claude_baseline.json` (per-field value +
  confidence).
- **Ground truth:** user-filled `..._ground_truth.json` (verified by calling the
  church).
- `research-calibrate` builds the automated dossier and emits a **3-column diff**
  (tool / Claude / ground-truth) per field with an error flag and a per-field
  "who was closest", plus a summary of where the **tool under-performs Claude**
  (the signals to improve). Output: `data/output/calibration_<slug>.md`.

## 14. Ethics (unchanged, reinforced)

Public sources only; robots + rate limits; no logins/paywalls/CAPTCHAs; no
private/personal data; **no invented emails**; vendor/media never used as
identity; conflicts preserved, confidence never overstated, every value retains
evidence + source + access level.

## 15. Implementation plan (phases)

- **P0 — schema:** `supabase/migrations/0002_research_agent.sql`; extend
  `types.ts`, `Store` interface + Supabase/JSON impls (`saveDossier`,
  `getDossier`, `addConflict`, `listConflicts`).
- **P1 — collectors:** `src/research/sources/{website,searchSnippet,social,staff,
  jobPosting,directory,newsMedia,vendor}.ts` + shared `SourceFinding` types and a
  polite shared fetcher.
- **P2 — orchestrator:** `src/research/researchAgent.ts` (identity → collect →
  conflicts → contamination → cap) + `src/research/dossier.ts` (types, capping,
  aggregation).
- **P3 — synthesis:** `src/claude/dossierPrompt.ts` + parsing/validation (zod).
- **P4 — strategic scorers:** `src/agents/strategic.ts` (lifecycle, growth,
  digital maturity, change readiness, staff depth) reading the dossier.
- **P5 — CLI + renderer:** `research-church`, `research-dossier`,
  `research-calibrate` + `src/research/dossierMarkdown.ts`.
- **P6 — calibration:** Cornerstone baseline fixture + diff report.
- **P7 — wire enrich/score:** `enrich-church` builds/loads a dossier first, then
  scores from it; backward compatible.
- **P8 — offline tests:** mocked-`fetch` fixtures (as used for discovery) proving
  the Cornerstone flow (capped confidence, preserved Lead/Associate conflict,
  Salt-Network contamination flag) without live network; README/docs updates.

### New files
```
src/research/dossier.ts                 # types, access-level capping, aggregation
src/research/researchAgent.ts           # orchestrator (12-step workflow)
src/research/sources/*.ts               # 8 collectors + shared finding helpers
src/claude/dossierPrompt.ts             # synthesis prompt + schema
src/agents/strategic.ts                 # new strategic scorers
src/research/dossierMarkdown.ts         # markdown renderer
docs/calibration/cornerstone_claude_baseline.json
docs/calibration/cornerstone_ground_truth.template.json
```

## 16. Decisions (locked)
1. **Dossier cardinality** — **one current dossier per church** (update in place);
   change history lives in `enrichment_runs` + `church_evidence`.
2. **Claude budget** — **always synthesize** (one synthesis call per church on
   every research run); acceptable for the cost target.
3. **Social / job / LinkedIn sourcing** — **search snippets only** (no
   login-gated scraping); honest, lower confidence, matches the ethics constraints
   and the Cornerstone method.
4. **`research-dossier --url` with no matching church** — **print only**; persist
   only when `--save` is passed (which then creates/links a `churches` row).
