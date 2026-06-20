-- ════════════════════════════════════════════════════════════════════════
-- Research Agent — multi-source dossiers, conflicts, and strategic fields
-- Run after 0001_initial_schema.sql
-- ════════════════════════════════════════════════════════════════════════

do $$ begin
  create type lifecycle_stage as enum
    ('plant','growing','established','relaunch_revitalization','plateaued',
     'declining','merged','closed','unknown');
exception when duplicate_object then null; end $$;

do $$ begin
  create type app_status as enum ('active','planned','none_found','unknown');
exception when duplicate_object then null; end $$;

do $$ begin
  create type evidence_access_level as enum
    ('user_provided_ground_truth','live_official_site','staff_profile',
     'social_profile','job_posting','third_party_directory','search_snippets',
     'vendor_reference');
exception when duplicate_object then null; end $$;

-- ── strategic fields on churches ─────────────────────────────────────────
alter table churches
  add column if not exists lifecycle_stage            lifecycle_stage,
  add column if not exists growth_orientation_score   numeric(5,2),
  add column if not exists digital_maturity_score     numeric(5,2),
  add column if not exists change_readiness_score     numeric(5,2),
  add column if not exists staff_depth_score          numeric(5,2),
  add column if not exists evidence_access_level      evidence_access_level,
  add column if not exists identity_contamination_flag boolean default false,
  add column if not exists research_confidence        numeric(5,2),
  add column if not exists church_app_status          app_status,
  add column if not exists app_provider               text,
  add column if not exists online_attendance_estimate integer,
  add column if not exists online_attendance_confidence numeric(5,2);

-- ── one current dossier per church ───────────────────────────────────────
create table if not exists church_research_dossiers (
  id                       uuid primary key default gen_random_uuid(),
  church_id                uuid unique references churches(id) on delete cascade,
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
create index if not exists idx_dossier_church on church_research_dossiers(church_id);

drop trigger if exists trg_dossier_updated_at on church_research_dossiers;
create trigger trg_dossier_updated_at
  before update on church_research_dossiers
  for each row execute function set_updated_at();

-- ── preserved conflicts (never resolved silently) ────────────────────────
create table if not exists research_conflicts (
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
create index if not exists idx_conflicts_church on research_conflicts(church_id);
