-- ============================================================
-- Identity and people tables
-- ============================================================

-- user_profiles: extends Supabase auth.users
create table if not exists user_profiles (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  display_name   text,
  preferred_name text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- people
create table if not exists people (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id) on delete cascade,
  user_id           uuid references auth.users(id) on delete set null,
  first_name        text not null,
  last_name         text not null,
  preferred_name    text,
  email             text,
  phone             text,
  status            text not null default 'active'
                      check (status in ('active','inactive','archived')),
  primary_campus_id uuid references campuses(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  archived_at       timestamptz
);
create index on people (tenant_id);
create index on people (user_id);
create index on people (tenant_id, email) where email is not null;

-- households
create table if not exists households (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id) on delete cascade,
  name              text not null,
  primary_campus_id uuid references campuses(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  archived_at       timestamptz
);
create index on households (tenant_id);

-- household_members
create table if not exists household_members (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants(id) on delete cascade,
  household_id        uuid not null references households(id) on delete cascade,
  person_id           uuid not null references people(id) on delete cascade,
  relationship_type   text not null,
  is_primary_contact  boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint hm_unique_person_household unique (household_id, person_id)
);
create index on household_members (tenant_id);
create index on household_members (household_id);
create index on household_members (person_id);

create or replace function validate_primary_campus_tenant()
returns trigger
language plpgsql
as $$
declare
  campus_tenant_id uuid;
begin
  if new.primary_campus_id is null then
    return new;
  end if;

  select tenant_id
    into campus_tenant_id
  from campuses
  where id = new.primary_campus_id;

  if campus_tenant_id is null or campus_tenant_id != new.tenant_id then
    raise exception 'primary_campus_id must belong to the same tenant';
  end if;

  return new;
end;
$$;

create or replace function validate_household_member_tenant()
returns trigger
language plpgsql
as $$
declare
  household_tenant_id uuid;
  person_tenant_id uuid;
begin
  select tenant_id
    into household_tenant_id
  from households
  where id = new.household_id;

  select tenant_id
    into person_tenant_id
  from people
  where id = new.person_id;

  if household_tenant_id is null or household_tenant_id != new.tenant_id then
    raise exception 'household_id must belong to the same tenant';
  end if;

  if person_tenant_id is null or person_tenant_id != new.tenant_id then
    raise exception 'person_id must belong to the same tenant';
  end if;

  return new;
end;
$$;

create trigger validate_people_primary_campus_tenant
before insert or update on people
for each row execute function validate_primary_campus_tenant();

create trigger validate_households_primary_campus_tenant
before insert or update on households
for each row execute function validate_primary_campus_tenant();

create trigger validate_household_members_tenant
before insert or update on household_members
for each row execute function validate_household_member_tenant();
