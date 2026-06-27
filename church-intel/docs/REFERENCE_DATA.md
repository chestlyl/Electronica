# Reference data — Connected Churches workbooks

Two intelligence workbooks (`data/sources/connected_churches.xlsx`,
`data/sources/mega_church_dashboard.xlsx`) are **aggregate** intelligence —
denomination- and state-level rollups. They contain **no individual-church
rows**, so nothing here imports into the church repository. What they *do*
provide is a denomination/network + prospecting layer.

## Pipeline

```bash
npm run ingest:reference   # parse the workbooks → data/reference/*.json
# apply supabase/migrations/0004_reference_data.sql
npm run load:reference     # full-replace load of the JSON into Supabase
```

## Artifacts (`data/reference/`)

| file | what it is | rows |
|---|---|---|
| `denominations.json` | denomination/movement master: affiliation, website, HQ, # churches/pastors/members/universities | 233 |
| `denomination_state_stats.json` | per (denomination × state) density: lead pastors, staff, churches; mega counts | 231 |
| `attendance_bands.json` | attendance-band distributions per denomination (calibration benchmark) | 146 |
| `network_contacts.json` | **named** denominational/network leaders + regional governance: title, org, address, phone, email, website | 384 (277 w/ email) |
| `prospect_priority.json` | denominations by TAM, deep denominations by field density, states by mega density | — |

## How this powers prospecting + strategy

- **Network affiliation** — `denominations` tags any church with its movement
  family, size, and HQ; `network_contacts` gives a warm entry point into a whole
  denomination (e.g. AG General Superintendent + every district superintendent
  with direct email/phone).
- **Where to prospect** — `prospect_priority.by_state_mega` ranks states by
  mega/multisite density (TX 319, CA 283, FL 189…); drives which metros to run
  `prospect-area` against first.
- **Calibration** — `attendance_bands` are real-world distributions to
  sanity-check the size model against (no scoring changes — validation only).

Everything is pure extraction: each record carries its source workbook + sheet,
and nothing is invented.
