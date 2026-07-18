-- ============================================================
-- Platform and tenant tables
-- ============================================================

-- tenants
create table if not exists tenants (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  slug             text not null unique,
  status           text not null default 'pilot'
                     check (status in ('pilot','trial','active','suspended','archived')),
  timezone         text not null default 'America/New_York',
  default_currency char(3) not null default 'USD',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  archived_at      timestamptz
);
create index on tenants (slug);
create index on tenants (status);

-- tenant_domains
create table if not exists tenant_domains (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants(id) on delete cascade,
  hostname            text not null,
  domain_type         text not null default 'primary'
                        check (domain_type in ('primary','alias','redirect')),
  is_primary          boolean not null default false,
  verification_status text not null default 'pending'
                        check (verification_status in ('pending','verified','failed')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint tenant_domains_tenant_hostname_unique unique (tenant_id, hostname)
);
create index on tenant_domains (tenant_id);
create index on tenant_domains (hostname);

-- tenant_settings
create table if not exists tenant_settings (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null unique references tenants(id) on delete cascade,
  settings   jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- campuses
create table if not exists campuses (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  name           text not null,
  slug           text not null,
  timezone       text,
  status         text not null default 'active'
                   check (status in ('active','inactive','archived')),
  address_line1  text,
  address_line2  text,
  city           text,
  state          text,
  postal_code    text,
  country        text default 'US',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  archived_at    timestamptz,
  constraint campuses_tenant_slug_unique unique (tenant_id, slug)
);
create index on campuses (tenant_id);

-- ministries
create table if not exists ministries (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  campus_id   uuid references campuses(id) on delete set null,
  name        text not null,
  slug        text not null,
  status      text not null default 'active'
                check (status in ('active','inactive','archived')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  archived_at timestamptz,
  constraint ministries_tenant_slug_unique unique (tenant_id, slug)
);
create index on ministries (tenant_id);
create index on ministries (campus_id);
