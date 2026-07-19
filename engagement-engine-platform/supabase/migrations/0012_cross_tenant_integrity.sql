-- ============================================================
-- Migration 0012: Cross-Tenant Referential Integrity Guards
--
-- The RLS policies on role_assignments and invitations check
-- that the acting user has the required permission in the
-- target tenant but do NOT verify that the role_id, campus_id,
-- or ministry_id referenced in the row belongs to the same tenant.
--
-- This migration adds BEFORE INSERT/UPDATE triggers that enforce
-- the cross-tenant FK integrity gap at the database level,
-- independent of RLS.
-- ============================================================

-- ── 1. role_assignments: role must belong to same tenant ──────

CREATE OR REPLACE FUNCTION check_role_assignment_tenant()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Verify role belongs to the same tenant as the assignment
  IF NOT EXISTS (
    SELECT 1 FROM roles
    WHERE id = NEW.role_id
      AND tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION
      'cross_tenant_reference: role % does not belong to tenant %',
      NEW.role_id, NEW.tenant_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- Verify campus_id belongs to the same tenant (when supplied)
  IF NEW.campus_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM campuses
    WHERE id = NEW.campus_id
      AND tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION
      'cross_tenant_reference: campus % does not belong to tenant %',
      NEW.campus_id, NEW.tenant_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- Verify ministry_id belongs to the same tenant (when supplied)
  IF NEW.ministry_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM ministries
    WHERE id = NEW.ministry_id
      AND tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION
      'cross_tenant_reference: ministry % does not belong to tenant %',
      NEW.ministry_id, NEW.tenant_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER role_assignment_tenant_check
  BEFORE INSERT OR UPDATE ON role_assignments
  FOR EACH ROW EXECUTE FUNCTION check_role_assignment_tenant();

-- ── 2. invitations: role/campus/ministry must belong to same tenant ─

CREATE OR REPLACE FUNCTION check_invitation_tenant()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Verify role belongs to the same tenant
  IF NEW.role_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM roles
    WHERE id = NEW.role_id
      AND tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION
      'cross_tenant_reference: role % does not belong to tenant %',
      NEW.role_id, NEW.tenant_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- Verify campus_id belongs to the same tenant (when supplied)
  IF NEW.campus_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM campuses
    WHERE id = NEW.campus_id
      AND tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION
      'cross_tenant_reference: campus % does not belong to tenant %',
      NEW.campus_id, NEW.tenant_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- Verify ministry_id belongs to the same tenant (when supplied)
  IF NEW.ministry_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM ministries
    WHERE id = NEW.ministry_id
      AND tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION
      'cross_tenant_reference: ministry % does not belong to tenant %',
      NEW.ministry_id, NEW.tenant_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER invitation_tenant_check
  BEFORE INSERT OR UPDATE ON invitations
  FOR EACH ROW EXECUTE FUNCTION check_invitation_tenant();

-- ── 3. people: primary_campus_id must belong to same tenant ──────────

CREATE OR REPLACE FUNCTION check_person_campus_tenant()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.primary_campus_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM campuses
    WHERE id = NEW.primary_campus_id
      AND tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION
      'cross_tenant_reference: campus % does not belong to tenant %',
      NEW.primary_campus_id, NEW.tenant_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER person_campus_tenant_check
  BEFORE INSERT OR UPDATE ON people
  FOR EACH ROW EXECUTE FUNCTION check_person_campus_tenant();

-- ── 4. households: primary_campus_id must belong to same tenant ─────

CREATE OR REPLACE FUNCTION check_household_campus_tenant()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.primary_campus_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM campuses
    WHERE id = NEW.primary_campus_id
      AND tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION
      'cross_tenant_reference: campus % does not belong to tenant %',
      NEW.primary_campus_id, NEW.tenant_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER household_campus_tenant_check
  BEFORE INSERT OR UPDATE ON households
  FOR EACH ROW EXECUTE FUNCTION check_household_campus_tenant();
