# Test Church — Seed Data

Development and test seed data for the Test Church tenant.

Test Church exists solely to verify tenant isolation. It must never appear in production seed routines.

## Rules

- Status: active (proves isolation against a non-pilot tenant)
- Never exposed to end users
- Never seeded in production
- Used in pgTAP tests and local development only
