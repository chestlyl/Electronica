# Copilot Instructions — The Engagement Engine

## Product Scope

`engagement-engine-platform/` is the **product root** for The Engagement Engine.
Cornerstone Church in Akron, Ohio is the **first pilot tenant**.

## Hard Working Boundary

All commands, file reads, and file writes must stay within `engagement-engine-platform/`.

Even though the Git repository root is `Electronica/`, agents must treat
`engagement-engine-platform/` as the hard working boundary.

**No files outside `engagement-engine-platform/` may be read, created, modified, or deleted.**

## Out-of-Scope Directories

`church-intel/` is a **separate and unrelated product**.

Agents must **never**:
- Read, open, or reference any file under `church-intel/`
- Modify or delete any file under `church-intel/`
- Import, summarize, or generate content derived from `church-intel/`
- Generate denomination, church-research, church-intelligence, attendance,
  conference, or network-summary data as part of Engagement Engine work

## Commands

All CLI commands (install, build, typecheck, test, lint) must be run from
`engagement-engine-platform/`, not from the repository root.

## Out-of-Scope Change Protocol

If a requested task would require touching any file outside `engagement-engine-platform/`,
the agent **must stop immediately** and report the conflict to the user before proceeding.

Do not make the out-of-scope change as a convenience or shortcut.
