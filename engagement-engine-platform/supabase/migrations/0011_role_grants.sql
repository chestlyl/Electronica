-- ============================================================
-- Migration 0011: Role Privilege Grants
--
-- In Supabase Cloud, the anon and authenticated roles receive
-- table-level privileges through Supabase's managed configuration.
-- When running against a bare PostgreSQL container (CI, local
-- testing without the full Supabase stack), these grants must be
-- applied explicitly so that RLS can control row visibility.
--
-- Without these grants, queries from anon/authenticated roles
-- produce "permission denied" before RLS policies even run.
--
-- Privilege model:
--   anon         : SELECT only — RLS then restricts to zero rows
--                  (no anon policies grant reads on tenant data)
--   authenticated: SELECT, INSERT, UPDATE, DELETE — RLS determines
--                  what each user can actually do
--   service_role : BYPASSRLS already set; ALL grants for completeness
-- ============================================================

-- ── Public schema tables ──────────────────────────────────────

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

DO $grants$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format(
      'GRANT SELECT ON public.%I TO anon, authenticated, service_role',
      r.tablename
    );
    EXECUTE format(
      'GRANT INSERT, UPDATE, DELETE ON public.%I TO authenticated, service_role',
      r.tablename
    );
  END LOOP;
END $grants$;

-- ── Future tables ─────────────────────────────────────────────
-- Ensure grants apply to tables created after this migration runs.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT INSERT, UPDATE, DELETE ON TABLES TO authenticated, service_role;
