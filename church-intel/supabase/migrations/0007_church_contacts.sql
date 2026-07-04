-- ════════════════════════════════════════════════════════════════════════
-- church_contacts — EVERY staff/church email the pipeline finds, bucketed by
-- category (church / role / person / unassigned) with source + confidence. The
-- UI shows them all and lets a human SELECT which one to use for outreach.
--
-- Populated from the Contact Intelligence layer whenever a dossier is persisted.
-- Run after 0006_outreach.sql.
-- ════════════════════════════════════════════════════════════════════════

create table if not exists church_contacts (
  id                    uuid primary key default gen_random_uuid(),
  church_id             uuid not null references churches(id) on delete cascade,
  email                 text not null,
  name                  text,               -- associated person / department label
  role                  text,               -- role hint (for role-based inboxes)
  category              text not null,      -- church | role | person | unassigned
  source_url            text,
  confidence            numeric(5,2),       -- 0..100
  selected_for_outreach boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists idx_church_contacts_church on church_contacts(church_id);
create index if not exists idx_church_contacts_selected on church_contacts(church_id) where selected_for_outreach;
-- One row per (church, email).
create unique index if not exists uq_church_contacts_email on church_contacts(church_id, lower(email));

comment on table church_contacts is
  'All discovered church/staff emails per church (church/role/person/unassigned) with source + confidence; one may be selected_for_outreach.';
