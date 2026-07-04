-- ════════════════════════════════════════════════════════════════════════
-- Outreach — the "Today's 300" daily lead batch: generated email copy, an
-- approval workflow, and HubSpot sync state. Populated by a backend job (rank
-- churches into a daily batch + generate copy); the frontend reads + approves.
--
-- Run after 0005_existing_relationships.sql.
-- ════════════════════════════════════════════════════════════════════════

do $$ begin
  create type outreach_approval as enum ('draft','pending','approved','rejected','sent');
exception when duplicate_object then null; end $$;

do $$ begin
  create type hubspot_sync as enum ('not_synced','queued','synced','failed');
exception when duplicate_object then null; end $$;

create table if not exists outreach_leads (
  id                  uuid primary key default gen_random_uuid(),
  church_id           uuid references churches(id) on delete cascade,
  batch_date          date not null default current_date,   -- powers "Today's 300"
  rank                integer,                                -- position within the day's list
  contact_name        text,
  contact_email       text,
  contact_role        text,
  subject             text,
  body                text,
  approval_status     outreach_approval not null default 'pending',
  hubspot_sync_status hubspot_sync      not null default 'not_synced',
  hubspot_contact_id  text,
  hubspot_synced_at   timestamptz,
  fit_score           numeric(5,2),
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists idx_outreach_batch    on outreach_leads (batch_date, rank);
create index if not exists idx_outreach_approval on outreach_leads (approval_status);
create index if not exists idx_outreach_hubspot  on outreach_leads (hubspot_sync_status);
create index if not exists idx_outreach_church   on outreach_leads (church_id);
create unique index if not exists uniq_outreach_church_batch on outreach_leads (church_id, batch_date);

comment on table outreach_leads is
  'Daily outreach batch ("Today''s 300"): generated email copy, approval workflow, HubSpot sync. Frontend reads + approves; backend jobs populate and sync.';
