-- ════════════════════════════════════════════════════════════════════════
-- Church Intelligence Platform — initial schema
-- Run with: supabase db push   (or paste into the Supabase SQL editor)
-- ════════════════════════════════════════════════════════════════════════

create extension if not exists "pgcrypto";

-- ── Enums ────────────────────────────────────────────────────────────────
do $$ begin
  create type active_status as enum
    ('Verified Active', 'Likely Active', 'Uncertain', 'Closed', 'Merged');
exception when duplicate_object then null; end $$;

do $$ begin
  create type confidence_tier as enum ('High', 'Medium', 'Low', 'Very Low');
exception when duplicate_object then null; end $$;

do $$ begin
  create type review_status as enum
    ('pending', 'approved', 'rejected', 'needs_more_research');
exception when duplicate_object then null; end $$;

do $$ begin
  create type run_status as enum
    ('pending', 'running', 'completed', 'failed', 'partial');
exception when duplicate_object then null; end $$;

-- ── churches ─────────────────────────────────────────────────────────────
create table if not exists churches (
  id                          uuid primary key default gen_random_uuid(),
  original_row_id             text unique not null,

  -- Original (preserved) values from the seed spreadsheet
  name                        text,
  address                     text,
  city                        text,
  state                       text,
  zip                         text,
  country                     text,
  phone_original              text,
  email_original              text,
  website_original            text,

  -- Verified / discovered values
  phone_verified              text,
  email_verified              text,
  website_verified            text,
  active_status               active_status,
  lead_pastor                 text,
  denomination                text,
  network_affiliation         text,
  language                    text,

  -- Size & structure
  staff_count                 integer,
  campus_count                integer,
  weekend_services_count      integer,
  attendance_estimate         integer,
  attendance_min              integer,
  attendance_max              integer,
  attendance_confidence       numeric(5,2),         -- 0..100
  attendance_confidence_tier  confidence_tier,

  -- Scores (0..100)
  influence_score             numeric(5,2),
  mmc_fit_score               numeric(5,2),
  multiplication_score        numeric(5,2),
  church_planting_activity    numeric(5,2),
  leadership_development_score numeric(5,2),
  digital_reach_score         numeric(5,2),
  verification_score          numeric(5,2),

  review_status               text default 'unreviewed',
  notes                       text,
  last_checked_at             timestamptz,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

create index if not exists idx_churches_state on churches (state);
create index if not exists idx_churches_active_status on churches (active_status);
create index if not exists idx_churches_mmc on churches (mmc_fit_score desc);
create index if not exists idx_churches_website_verified on churches (website_verified);

-- ── church_evidence ──────────────────────────────────────────────────────
-- Append-only audit trail. Every proposed value keeps its evidence + source.
create table if not exists church_evidence (
  id               uuid primary key default gen_random_uuid(),
  church_id        uuid not null references churches(id) on delete cascade,
  field_name       text not null,
  proposed_value   text,
  evidence_text    text,
  source_url       text,
  source_type      text,                 -- official_site | directory | social | search | report ...
  confidence_score numeric(5,2),         -- 0..100
  checked_at       timestamptz not null default now()
);

create index if not exists idx_evidence_church on church_evidence (church_id);
create index if not exists idx_evidence_field on church_evidence (church_id, field_name);

-- ── enrichment_runs ──────────────────────────────────────────────────────
create table if not exists enrichment_runs (
  id             uuid primary key default gen_random_uuid(),
  church_id      uuid references churches(id) on delete cascade,
  run_type       text not null,          -- verify | enrich | score | contact ...
  status         run_status not null default 'pending',
  started_at     timestamptz not null default now(),
  completed_at   timestamptz,
  error_message  text,
  model_used     text,
  tokens_used    integer default 0,
  cost_estimate  numeric(10,4) default 0
);

create index if not exists idx_runs_church on enrichment_runs (church_id);
create index if not exists idx_runs_type on enrichment_runs (run_type, status);

-- ── review_queue ─────────────────────────────────────────────────────────
create table if not exists review_queue (
  id               uuid primary key default gen_random_uuid(),
  church_id        uuid not null references churches(id) on delete cascade,
  field_name       text not null,
  current_value    text,
  proposed_value   text,
  confidence_score numeric(5,2),
  evidence_summary text,
  source_urls      text[],
  review_status    review_status not null default 'pending',
  created_at       timestamptz not null default now(),
  reviewed_at      timestamptz,
  reviewer_notes   text
);

create index if not exists idx_review_status on review_queue (review_status);
create index if not exists idx_review_church on review_queue (church_id);
-- Avoid piling up duplicate pending items for the same field.
create unique index if not exists uniq_pending_review
  on review_queue (church_id, field_name)
  where review_status = 'pending';

-- ── updated_at trigger ───────────────────────────────────────────────────
create or replace function set_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

drop trigger if exists trg_churches_updated_at on churches;
create trigger trg_churches_updated_at
  before update on churches
  for each row execute function set_updated_at();

-- ── Convenience views for the dashboard ──────────────────────────────────
create or replace view churches_missing_contact as
  select * from churches
  where website_verified is null or email_verified is null or lead_pastor is null;

create or replace view churches_high_mmc as
  select * from churches
  where mmc_fit_score is not null
  order by mmc_fit_score desc;
