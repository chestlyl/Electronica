-- ============================================================
-- Production bootstrap seed
-- Safe to run in production — no tenant data, no test records.
-- ============================================================

-- Platform permissions
insert into permissions (key, description, sensitivity_level) values
  ('tenant.view',           'View tenant information',              'internal'),
  ('tenant.manage',         'Manage tenant settings and structure', 'restricted'),
  ('people.view',           'View people records (administrative)', 'internal'),
  ('people.create',         'Create people records',                'internal'),
  ('people.update',         'Update people records',                'internal'),
  ('people.archive',        'Archive people records',               'restricted'),
  ('households.view',       'View households (administrative)',      'internal'),
  ('households.create',     'Create households',                    'internal'),
  ('households.update',     'Update households',                    'internal'),
  ('memberships.view',      'View memberships (administrative)',     'internal'),
  ('memberships.manage',    'Manage memberships',                   'restricted'),
  ('roles.view',            'View roles and assignments',           'internal'),
  ('roles.manage',          'Manage roles and assignments',         'restricted'),
  ('permissions.view',      'View permission catalog',              'internal'),
  ('invitations.create',    'Create invitations',                   'restricted'),
  ('audit.view',            'View audit events',                    'sensitive'),
  ('integrations.view',     'View integration connections',         'restricted'),
  ('integrations.manage',   'Manage integration connections',       'sensitive'),
  ('settings.view',         'View tenant settings (administrative)','internal'),
  ('settings.manage',       'Manage tenant settings',               'restricted'),
  -- Fine-grained member permissions
  ('member.self_access',
   'Access own tenant membership and future member shell',          'internal'),
  ('member.directory',
   'Future: access privacy-gated member directory',                 'internal')
on conflict (key) do nothing;

-- ── Platform administrator provisioning ──────────────────────────────────
-- To provision the first platform administrator in production, run this
-- block once using a trusted service-role connection after the auth user
-- has been created manually in the Supabase dashboard:
--
--   insert into platform_admins (user_id, notes)
--   values ('<auth-user-uuid>', 'Initial platform owner')
--   on conflict (user_id) do nothing;
--
-- Do not commit real UUIDs, real email addresses, or credentials to this
-- file. Provision the first platform owner out-of-band.
