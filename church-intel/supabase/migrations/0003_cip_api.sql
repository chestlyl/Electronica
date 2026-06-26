-- ════════════════════════════════════════════════════════════════════════
-- CIP API seam — research jobs, the researched-church repository, and dossiers
-- consumed by the Base44 Church Intelligence Platform.
--
-- These tables are INTENTIONALLY separate from the legacy enrichment tables
-- (churches / church_research_dossiers). The legacy `churches` table is the
-- imported spreadsheet repository (uuid PKs, different columns); clobbering it
-- would be destructive. The CIP API owns its own contract-shaped projection with
-- opaque text ids (job_…, church_…, dossier_…).
--
-- Run after 0002_research_agent.sql. Reuses set_updated_at() from 0001.
-- ════════════════════════════════════════════════════════════════════════

-- ── research jobs ────────────────────────────────────────────────────────
create table if not exists cip_research_jobs (
  id              text primary key,             -- job_…
  status          text not null default 'queued', -- queued | running | complete | failed
  stage           text not null default 'queued', -- queued|discovery|extraction|coverage_validation|scoring|dossier_generation|complete|failed
  progress        integer not null default 0,
  input_type      text not null,                -- known_church | discovery
  input_payload   jsonb,
  church_id       text,                         -- set for known-church jobs
  result_payload  jsonb,
  error           text,
  started_at      timestamptz,
  completed_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_cip_jobs_status on cip_research_jobs(status);
create index if not exists idx_cip_jobs_church on cip_research_jobs(church_id);

-- ── researched church repository (contract projection) ───────────────────
create table if not exists cip_churches (
  id                   text primary key,        -- church_…
  name                 text,
  city                 text,
  state                text,
  website              text,
  verified             boolean default false,
  denomination         text,
  archetype            text,
  lifecycle            text,
  awa                  integer,
  attendance_source    text,                    -- reported | inferred | unknown
  coverage_percent     numeric(5,2),
  research_confidence  numeric(5,2),
  engagement_fit       numeric(5,2),
  priority             text,                    -- high | medium | low
  last_researched_at   timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists idx_cip_churches_state     on cip_churches(state);
create index if not exists idx_cip_churches_priority  on cip_churches(priority);
create index if not exists idx_cip_churches_archetype on cip_churches(archetype);
create index if not exists idx_cip_churches_fit       on cip_churches(engagement_fit desc);

-- ── dossiers (JSON sections + markdown; one current per church) ───────────
create table if not exists cip_dossiers (
  id                     text primary key,      -- dossier_…
  church_id              text unique references cip_churches(id) on delete cascade,
  job_id                 text,
  identity_json          jsonb,
  coverage_json          jsonb,
  size_json              jsonb,
  leadership_json        jsonb,
  staff_emails_json      jsonb,
  technology_stack_json  jsonb,
  strategic_signals_json jsonb,
  strategic_scores_json  jsonb,
  recommendations_json   jsonb,
  outreach_json          jsonb,
  raw_evidence_json      jsonb,
  markdown               text,
  created_at             timestamptz not null default now()
);
create index if not exists idx_cip_dossiers_church on cip_dossiers(church_id);

-- ── updated_at triggers (reuse set_updated_at() defined in 0001) ──────────
drop trigger if exists trg_cip_jobs_updated_at on cip_research_jobs;
create trigger trg_cip_jobs_updated_at
  before update on cip_research_jobs
  for each row execute function set_updated_at();

drop trigger if exists trg_cip_churches_updated_at on cip_churches;
create trigger trg_cip_churches_updated_at
  before update on cip_churches
  for each row execute function set_updated_at();
