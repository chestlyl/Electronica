-- ════════════════════════════════════════════════════════════════════════
-- Reference data extracted from the "Connected Churches" intelligence workbooks
-- (denomination master, state-level density, attendance benchmarks, and named
-- denominational/network leadership contacts).
--
-- This is AGGREGATE + NETWORK data, NOT individual churches — it sits ALONGSIDE
-- the church repository to power prospecting prioritization, denomination/network
-- affiliation tagging, and warm network entry points. Loaded by
-- `npm run load:reference` (full replace from data/reference/*.json).
--
-- Run after 0003_cip_api.sql.
-- ════════════════════════════════════════════════════════════════════════

-- ── denomination / movement master ───────────────────────────────────────
create table if not exists denominations (
  id                      uuid primary key default gen_random_uuid(),
  denomination            text not null,
  movement_family         text,
  affiliation_bio         text,
  size_note               text,          -- adherents note split from the name ("13.7 million")
  website                 text,
  hq_location             text,
  regional_offices        integer,
  regional_offices_label  text,          -- "Dioceses" | "Districts" | …
  churches                integer,
  pastors                 integer,
  membership              integer,
  universities            integer,
  source                  text,
  notes                   text,
  created_at              timestamptz not null default now()
);
create index if not exists idx_denominations_name on denominations(lower(denomination));
create index if not exists idx_denominations_churches on denominations(churches desc);

-- ── per (denomination × state) headline density ──────────────────────────
create table if not exists denomination_state_stats (
  id                  uuid primary key default gen_random_uuid(),
  scope               text not null,      -- denomination | mega
  denomination        text,               -- null for mega (cross-denomination)
  state               text not null,
  young_lead_pastors  integer,
  young_staff         integer,
  total_staff         integer,
  total_churches      integer,
  mega_churches       integer,
  source_sheet        text,
  created_at          timestamptz not null default now()
);
create index if not exists idx_denstats_state on denomination_state_stats(state);
create index if not exists idx_denstats_denom on denomination_state_stats(denomination);

-- ── attendance-band distributions (calibration benchmark) ────────────────
create table if not exists attendance_bands (
  id              uuid primary key default gen_random_uuid(),
  denomination    text not null,
  band            text not null,
  churches        integer,
  church_pct      numeric(6,2),
  attendance      integer,
  attendance_pct  numeric(6,2),
  source_sheet    text,
  created_at      timestamptz not null default now()
);

-- ── named denominational / network leadership contacts ───────────────────
create table if not exists network_contacts (
  id            uuid primary key default gen_random_uuid(),
  denomination  text not null,
  level         text,                     -- hq_leadership | regional_governance | contact
  name          text not null,
  title         text,
  org           text,                     -- office / district / field
  address       text,
  city          text,
  state         text,
  zip           text,
  phone         text,
  email         text,
  website       text,
  source_sheet  text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_netcontacts_denom on network_contacts(denomination);
create index if not exists idx_netcontacts_email on network_contacts(lower(email));
create index if not exists idx_netcontacts_state on network_contacts(state);
