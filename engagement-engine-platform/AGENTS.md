# Agent Instructions — The Engagement Engine

## Product Root

`engagement-engine-platform/` is the product root for **The Engagement Engine**.

**First pilot tenant:** Cornerstone Church, Akron, Ohio.

## Scope Boundary

This is an absolute, non-negotiable boundary:

> **All agent work is confined to `engagement-engine-platform/`.**

The Git repository root is `Electronica/`, which also contains sibling projects
(e.g. `church-intel/`). Those sibling projects are **completely unrelated** to
The Engagement Engine and must not be touched.

## Prohibited Actions

Agents working on The Engagement Engine must **never**:

1. Read, open, or reference any file under `church-intel/`
2. Modify, create, or delete any file under `church-intel/`
3. Import, summarize, or generate content derived from `church-intel/` data
4. Generate denomination, attendance, conference, church-research, or
   church-intelligence data as part of Engagement Engine work
5. Change any file outside `engagement-engine-platform/`
6. Run commands from the repository root (`Electronica/`) — always `cd`
   into `engagement-engine-platform/` first

## Out-of-Scope Escalation

If a task would require touching anything outside `engagement-engine-platform/`,
the agent **must stop and report** before making any change. Do not proceed.
Do not make the change as a convenience. Escalate to the user.

## Validation Commands (run from `engagement-engine-platform/`)

```bash
pnpm install
pnpm typecheck
pnpm test
```

pgTAP database tests require a local Supabase instance:

```bash
supabase start
supabase test db
```
