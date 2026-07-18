-- ============================================================
-- Operational foundation tables
-- ============================================================

-- audit_events
create table if not exists audit_events (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid references tenants(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_type    text not null default 'user'
                  check (actor_type in ('user','system','service')),
  action        text not null,
  entity_type   text not null,
  entity_id     text,
  metadata      jsonb not null default '{}',
  request_id    text,
  created_at    timestamptz not null default now()
);
create index on audit_events (tenant_id, created_at desc);
create index on audit_events (actor_user_id);
create index on audit_events (entity_type, entity_id);
create index on audit_events (action);

-- feature_flags
create table if not exists feature_flags (
  id              uuid primary key default gen_random_uuid(),
  key             text not null unique,
  description     text,
  default_enabled boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- tenant_feature_flags
create table if not exists tenant_feature_flags (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  feature_flag_id uuid not null references feature_flags(id) on delete cascade,
  enabled         boolean not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint tff_unique unique (tenant_id, feature_flag_id)
);
create index on tenant_feature_flags (tenant_id);

-- integration_connections
create table if not exists integration_connections (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id) on delete cascade,
  provider_type    text not null,
  provider_name    text not null,
  status           text not null default 'pending'
                     check (status in ('active','inactive','error','pending')),
  configuration    jsonb not null default '{}',
  secret_reference text,
  last_sync_at     timestamptz,
  last_error_at    timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index on integration_connections (tenant_id);
create index on integration_connections (tenant_id, provider_type);
