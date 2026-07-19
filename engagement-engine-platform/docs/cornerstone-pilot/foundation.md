# Cornerstone Church — Pilot Tenant Foundation

## Role as first pilot tenant

Cornerstone Church (Akron, Ohio) is the first production tenant of the Engagement Engine. It is referred to internally as Tenant 1 and carries the status `pilot`.

Cornerstone's role is to validate the platform in a real church environment before the product is offered to additional tenants.

---

## Initial tenant configuration

| Field                | Value                                  |
| -------------------- | -------------------------------------- |
| Name                 | Cornerstone Church                     |
| Slug                 | `cornerstone-akron`                    |
| Tenant ID (dev seed) | `11111111-1111-1111-1111-111111111111` |
| Status               | pilot                                  |
| Timezone             | America/New_York                       |
| Currency             | USD                                    |
| Location             | Akron, Ohio                            |

> **Note**: The fixed UUID above is for local development seed data only. Production Cornerstone will receive a randomly generated UUID on first creation.

---

## Initial campus placeholder

| Field                | Value                                  |
| -------------------- | -------------------------------------- |
| Name                 | Cornerstone Main Campus                |
| Slug                 | `main`                                 |
| Campus ID (dev seed) | `cc111111-1111-1111-1111-111111111111` |
| Status               | active                                 |
| Timezone             | America/New_York                       |
| City                 | Akron, OH                              |

This is a placeholder campus for seed data. Real address and service schedule data will be imported during the onboarding process.

---

## What is fictional seed data

The following seed data in `supabase/seed/dev_seed.sql` is entirely fictional and does not represent any real Cornerstone staff or members:

- James Whitfield
- Sarah Moreau
- David Okafor
- Rachel Kim
- Whitfield Household
- Okafor Household

All seed email addresses use `.invalid` top-level domains (e.g., `james.whitfield@example.invalid`) and will never deliver to real inboxes.

---

## What must NOT be committed

The following types of real Cornerstone data must never be committed to the repository:

- Real staff names or contact information
- Real member names or contact information
- Real giving records
- Real attendance data
- Financial information
- Internal documents
- Credentials of any kind

---

## Future import process

When Layer 2 onboarding begins, Cornerstone's real data will be imported through the platform's import pipeline:

1. Staff prepares a CSV export from existing ChMS (if any).
2. Import mappings are defined in `tenants/cornerstone/import-mappings/`.
3. Import runs against the staging environment first.
4. Data is reviewed before promotion to production.
5. No real data is ever committed to the repository.
