-- ============================================================
-- Membership and authorization tables
-- ============================================================

-- tenant_memberships
create table if not exists tenant_memberships (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  status     text not null default 'invited'
               check (status in ('invited','active','suspended','removed')),
  joined_at  timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tm_unique_active_membership unique (tenant_id, user_id)
);
create index on tenant_memberships (tenant_id);
create index on tenant_memberships (user_id);

-- roles
create table if not exists roles (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid references tenants(id) on delete cascade,
  name           text not null,
  slug           text not null,
  description    text,
  is_system_role boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint roles_tenant_slug_unique unique (tenant_id, slug)
);
create index on roles (tenant_id);

-- permissions
create table if not exists permissions (
  id                uuid primary key default gen_random_uuid(),
  key               text not null unique,
  description       text,
  sensitivity_level text not null default 'internal'
                      check (sensitivity_level in ('public','internal','restricted','sensitive')),
  created_at        timestamptz not null default now()
);

-- role_permissions
create table if not exists role_permissions (
  role_id       uuid not null references roles(id) on delete cascade,
  permission_id uuid not null references permissions(id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (role_id, permission_id)
);

-- role_assignments
create table if not exists role_assignments (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  membership_id uuid not null references tenant_memberships(id) on delete cascade,
  role_id       uuid not null references roles(id) on delete cascade,
  campus_id     uuid references campuses(id) on delete cascade,
  ministry_id   uuid references ministries(id) on delete cascade,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz,
  revoked_at    timestamptz
);
create index on role_assignments (tenant_id);
create index on role_assignments (membership_id);
create index on role_assignments (role_id);

-- invitations
create table if not exists invitations (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants(id) on delete cascade,
  email               text not null,
  invited_by_user_id  uuid not null references auth.users(id),
  role_id             uuid not null references roles(id),
  campus_id           uuid references campuses(id),
  ministry_id         uuid references ministries(id),
  token_hash          text not null,
  status              text not null default 'pending'
                        check (status in ('pending','accepted','expired','revoked')),
  expires_at          timestamptz not null,
  accepted_at         timestamptz,
  created_at          timestamptz not null default now()
);
create index on invitations (tenant_id);
create index on invitations (email);
