# Permissions — Security Model

## Permission catalog

| Key | Description | Sensitivity |
|-----|-------------|-------------|
| `tenant.view` | View tenant information | internal |
| `tenant.manage` | Manage tenant settings and structure | restricted |
| `people.view` | View people records | internal |
| `people.create` | Create people records | internal |
| `people.update` | Update people records | internal |
| `people.archive` | Archive people records | restricted |
| `households.view` | View households | internal |
| `households.create` | Create households | internal |
| `households.update` | Update households | internal |
| `memberships.view` | View memberships | internal |
| `memberships.manage` | Manage memberships | restricted |
| `roles.view` | View roles and assignments | internal |
| `roles.manage` | Manage roles and assignments | restricted |
| `permissions.view` | View permission catalog | internal |
| `invitations.create` | Create invitations | restricted |
| `audit.view` | View audit events | sensitive |
| `integrations.view` | View integration connections | restricted |
| `integrations.manage` | Manage integration connections | sensitive |
| `settings.view` | View tenant settings | internal |
| `settings.manage` | Manage tenant settings | restricted |

---

## Initial roles

### Administrator (per-tenant)

Holds all permissions. Can manage people, households, roles, invitations, settings, and integrations.

### Member (per-tenant)

Read-only permissions: `tenant.view`, `people.view`, `households.view`, `memberships.view`, `roles.view`, `settings.view`.

Cannot create, update, or archive any records.

---

## Scope model

A role assignment has three scope variants:

### Tenant-wide (no scope)
```
campus_id IS NULL AND ministry_id IS NULL
```
The user holds the role's permissions across the entire tenant.

### Campus-scoped
```
campus_id IS NOT NULL AND ministry_id IS NULL
```
The user holds the role's permissions only when operating within that campus.

### Ministry-scoped
```
ministry_id IS NOT NULL
```
The user holds the role's permissions only within that specific ministry.

---

## Effective permission resolution

`getEffectivePermissions(db, userId, tenantId)` returns:

```typescript
{
  userId: string;
  tenantId: string;
  permissions: ScopedPermission[];
}
```

Where each `ScopedPermission` is:

```typescript
{
  key: PermissionKey;
  campusId: string | null;
  ministryId: string | null;
}
```

The array is NOT deduplicated across scopes. A user may hold `people.view` with `campusId = null` (tenant-wide) and also `people.view` with `campusId = "campus-A"` (campus-scoped). Both entries appear.

`hasPermission()` checks whether any entry in the set satisfies the requested permission and scope:
- If a tenant-wide grant exists, it satisfies any campus or ministry scope check.
- If only a campus-scoped grant exists, it satisfies only checks for that campus.
- If only a ministry-scoped grant exists, it satisfies only checks for that ministry.

---

## Denial by default

If a user has:
- No active membership → `[]` (empty permissions)
- Active membership but no role assignments → `[]`
- Role assignments that are all expired or revoked → `[]`
- Role assignments with no matching permission → `[]`

No permission is ever assumed. All access requires an explicit grant.
