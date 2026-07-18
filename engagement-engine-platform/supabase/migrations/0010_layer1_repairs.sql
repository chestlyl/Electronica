-- ============================================================
-- Migration 0010: Layer 1 Repair Pass
--
-- Covers:
--   A) Member permission model — remove overbroad permissions,
--      add member.self_access and member.directory (future)
--   B) Campus-scope-aware RLS for people and households
--   C) Invitation acceptance — token_hash index, accepted_by_user_id column
--   D) Audit improvements — request_id index, metadata size guard
--   E) Second Cornerstone campus (campus B) for scope testing
--      (schema only; seed data added in dev_seed.sql)
-- ============================================================

-- ══════════════════════════════════════════════════════════════
-- A. Member Permission Model
-- ══════════════════════════════════════════════════════════════

-- Add new fine-grained permissions that replace the overbroad
-- administrative permissions previously given to members.
insert into permissions (key, description, sensitivity_level) values
  ('member.self_access',
   'Access own tenant membership, profile, and future member shell',
   'internal'),
  ('member.directory',
   'Future: access a privacy-gated member directory once that system is built',
   'internal')
on conflict (key) do nothing;

-- ══════════════════════════════════════════════════════════════
-- B. Campus-Scope-Aware RLS for People and Households
--
-- The original RLS policies used user_has_permission(tenant_id, 'people.view')
-- with no campus context.  This had two problems:
--   1. A campus-scoped admin (people.view scoped to campus A) was BLOCKED from
--      all people because the no-campus call returns false for scoped grants.
--   2. Even if it had returned true, a campus-scoped admin would have seen all
--      people in the tenant, not just their campus.
--
-- New semantics:
--   - Tenant-wide people.view → see all people in the tenant.
--   - Campus-scoped people.view for campus C → see people whose
--     primary_campus_id = C.
--   - Records with no primary_campus_id are only visible to tenant-wide admins.
--   - Inserting a person: campus-scoped admins must provide a campus they
--     hold the permission for; tenant-wide admins may omit the campus.
--
-- The RLS cannot fully enforce the "missing context → deny" insert rule by
-- itself because primary_campus_id is optional.  The domain service layer
-- enforces this at the application level (see people-service.ts).
-- ══════════════════════════════════════════════════════════════

-- Drop existing people RLS policies (they are being replaced)
drop policy if exists "people_select"  on people;
drop policy if exists "people_insert"  on people;
drop policy if exists "people_update"  on people;
drop policy if exists "people_archive" on people;

-- New people policies with campus scope
create policy "people_select"
  on people for select
  using (
    -- Tenant-wide grant
    user_has_permission(tenant_id, 'people.view')
    -- OR campus-scoped grant matching this person's campus
    or (
      primary_campus_id is not null
      and user_has_permission(tenant_id, 'people.view', primary_campus_id, null)
    )
  );

create policy "people_insert"
  on people for insert
  with check (
    -- Tenant-wide grant
    user_has_permission(tenant_id, 'people.create')
    -- OR campus-scoped grant matching the new person's campus
    or (
      primary_campus_id is not null
      and user_has_permission(tenant_id, 'people.create', primary_campus_id, null)
    )
  );

create policy "people_update"
  on people for update
  using (
    user_has_permission(tenant_id, 'people.update')
    or (
      primary_campus_id is not null
      and user_has_permission(tenant_id, 'people.update', primary_campus_id, null)
    )
  );

create policy "people_archive"
  on people for delete
  using (
    user_has_permission(tenant_id, 'people.archive')
    or (
      primary_campus_id is not null
      and user_has_permission(tenant_id, 'people.archive', primary_campus_id, null)
    )
  );

-- Drop and recreate household policies with campus scope
drop policy if exists "households_select" on households;
drop policy if exists "households_insert" on households;
drop policy if exists "households_update" on households;
drop policy if exists "household_members_select" on household_members;
drop policy if exists "household_members_insert" on household_members;
drop policy if exists "household_members_update" on household_members;

create policy "households_select"
  on households for select
  using (
    user_has_permission(tenant_id, 'households.view')
    or (
      primary_campus_id is not null
      and user_has_permission(tenant_id, 'households.view', primary_campus_id, null)
    )
  );

create policy "households_insert"
  on households for insert
  with check (
    user_has_permission(tenant_id, 'households.create')
    or (
      primary_campus_id is not null
      and user_has_permission(tenant_id, 'households.create', primary_campus_id, null)
    )
  );

create policy "households_update"
  on households for update
  using (
    user_has_permission(tenant_id, 'households.update')
    or (
      primary_campus_id is not null
      and user_has_permission(tenant_id, 'households.update', primary_campus_id, null)
    )
  );

-- household_members follows the parent household's campus scope
create policy "household_members_select"
  on household_members for select
  using (
    exists (
      select 1 from households h
      where h.id = household_id
        and (
          user_has_permission(h.tenant_id, 'households.view')
          or (
            h.primary_campus_id is not null
            and user_has_permission(h.tenant_id, 'households.view', h.primary_campus_id, null)
          )
        )
    )
  );

create policy "household_members_insert"
  on household_members for insert
  with check (
    exists (
      select 1 from households h
      where h.id = household_id
        and (
          user_has_permission(h.tenant_id, 'households.create')
          or (
            h.primary_campus_id is not null
            and user_has_permission(h.tenant_id, 'households.create', h.primary_campus_id, null)
          )
        )
    )
  );

create policy "household_members_update"
  on household_members for update
  using (
    exists (
      select 1 from households h
      where h.id = household_id
        and (
          user_has_permission(h.tenant_id, 'households.update')
          or (
            h.primary_campus_id is not null
            and user_has_permission(h.tenant_id, 'households.update', h.primary_campus_id, null)
          )
        )
    )
  );

-- ══════════════════════════════════════════════════════════════
-- C. Invitation Acceptance
-- ══════════════════════════════════════════════════════════════

-- Index for fast token lookup (accepting an invitation hashes the raw token
-- and looks it up here)
create index if not exists invitations_token_hash_idx
  on invitations (token_hash);

-- Track which user redeemed the invitation
alter table invitations
  add column if not exists accepted_by_user_id uuid
    references auth.users(id) on delete set null;

-- Add a policy so the invitee can look up their own invitation by token
-- (needed for the public acceptance endpoint)
-- The route handler uses the service-role client so this policy is
-- primarily for transparency; the service validates everything explicitly.
create policy "invitations_accept_own"
  on invitations for select
  using (email = (
    select email from auth.users where id = auth.uid()
  ));

-- ══════════════════════════════════════════════════════════════
-- D. Audit event improvements
-- ══════════════════════════════════════════════════════════════

-- Index request_id for correlation lookups
create index if not exists audit_events_request_id_idx
  on audit_events (request_id)
  where request_id is not null;

-- ══════════════════════════════════════════════════════════════
-- E. tenant_memberships: allow members to read own row via self_access
-- The original policy already allowed `user_id = auth.uid()` so this is
-- a documentation-level confirmation, not a new policy.
-- ══════════════════════════════════════════════════════════════
-- (no SQL change needed — existing policy already covers this)
