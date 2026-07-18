-- ============================================================
-- Production bootstrap seed
-- Safe to run in production — no tenant data, no test records.
-- ============================================================

-- Platform permissions
insert into permissions (key, description, sensitivity_level) values
  ('tenant.view',           'View tenant information',              'internal'),
  ('tenant.manage',         'Manage tenant settings and structure', 'restricted'),
  ('people.view',           'View people records',                  'internal'),
  ('people.create',         'Create people records',                'internal'),
  ('people.update',         'Update people records',                'internal'),
  ('people.archive',        'Archive people records',               'restricted'),
  ('households.view',       'View households',                      'internal'),
  ('households.create',     'Create households',                    'internal'),
  ('households.update',     'Update households',                    'internal'),
  ('memberships.view',      'View memberships',                     'internal'),
  ('memberships.manage',    'Manage memberships',                   'restricted'),
  ('roles.view',            'View roles and assignments',           'internal'),
  ('roles.manage',          'Manage roles and assignments',         'restricted'),
  ('permissions.view',      'View permission catalog',              'internal'),
  ('invitations.create',    'Create invitations',                   'restricted'),
  ('audit.view',            'View audit events',                    'sensitive'),
  ('integrations.view',     'View integration connections',         'restricted'),
  ('integrations.manage',   'Manage integration connections',       'sensitive'),
  ('settings.view',         'View tenant settings',                 'internal'),
  ('settings.manage',       'Manage tenant settings',               'restricted')
on conflict (key) do nothing;
