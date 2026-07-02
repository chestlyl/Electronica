-- ════════════════════════════════════════════════════════════════════════
-- Existing church relationships — the "already connected" set used by the
-- prospect-gap guard to EXCLUDE churches from discovery/research.
--
-- Populated by `npm run cli -- import-existing --file <xlsx|json|csv> --source
-- <label>` — a pure import (no research, no dossiers, no Claude tokens). Each
-- row is a church/network/organization we already have a relationship with.
--
-- Run after 0004_reference_data.sql.
-- ════════════════════════════════════════════════════════════════════════

create table if not exists existing_church_relationships (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null,
  normalized_name      text,                         -- stop-word-stripped name key (dedup / matching)
  website              text,
  domain               text,                         -- registrable host (www-stripped, lowercased)
  city                 text,
  state                text,                         -- 2-letter code where known
  phone                text,                         -- last-10-digits key where known
  source               text,                         -- import label, e.g. "connected_churches"
  relationship_status  text not null default 'connected',
  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- Matching indexes (prospect-gap looks up by domain, normalized name, phone).
create index if not exists idx_existing_rel_domain on existing_church_relationships(lower(domain));
create index if not exists idx_existing_rel_normname on existing_church_relationships(lower(normalized_name));
create index if not exists idx_existing_rel_phone on existing_church_relationships(phone);
create index if not exists idx_existing_rel_state on existing_church_relationships(state);
create index if not exists idx_existing_rel_source on existing_church_relationships(source);

-- Idempotent re-imports: a church is uniquely identified by (source, normalized
-- name, state, domain). Re-importing the same file updates instead of duplicating.
create unique index if not exists uq_existing_rel_identity
  on existing_church_relationships(source, lower(coalesce(normalized_name, '')), coalesce(state, ''), lower(coalesce(domain, '')));

comment on table existing_church_relationships is
  'Already-connected churches/networks used as prospect-gap exclusions. Import-only; never researched or dossiered.';
