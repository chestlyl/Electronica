# Source of Truth

The research pipeline has **exactly one producer for every conclusion**: the
**interpretation layer** (`src/research/interpret.ts`). Everything upstream is
*evidence* or *input*; everything downstream (report, enrich, calibration field
map, dossier markdown) is a *consumer* that must echo interpretation verbatim.

```
Layer 2  COLLECTION       SourceFinding[]            collectors gather, no meaning
   │                      (website.ts, snippets.ts)
   ▼
Layer 3  NORMALIZATION    NormalizedEvidence         structured tables, no conclusions
   │                      (normalize.ts)             leaders[], contacts[], locations[],
   │                                                 technology_stack[], external_signals[],
   │                                                 staff_roster[], conflicts[], …
   │   inputs also: extractFacts (facts), aggregateLeadership (leaders),
   │                detectTechStack, detectStrategicSignals, detectDigitalSignals
   ▼
Layer 4  INTERPRETATION   Interpretation             THE ONLY conclusions; each
   │                      (interpret.ts)             references normalized evidence ids
   ▼
Layer 5  REPORT / ENRICH  consume Interpretation     report, dossierApply (enrich),
                          (never re-derive)          calibration field map, dossier markdown
```

The synthesis (Claude) is an **input to interpretation only** — it is never read
directly as a conclusion by any consumer.

## Source-of-truth audit

| Field | Producer(s) (evidence / normalization input) | Consumer(s) | **Source of truth** |
|---|---|---|---|
| **lead_pastors** | `aggregateLeadership` → `normalized.leaders`; `extractFacts` role facts merged into `normalized.leaders`; `synthesis.lead_pastor` (fallback input) | report Contacts, enrich `lead_pastor`, calibration `lead_pastor`, dossier markdown | `interpretation.lead_pastors` |
| **office_email** | `extractFacts.office_email` → `normalized.contacts` | report, enrich `email_verified`, calibration | `interpretation.office_email` |
| **office_phone** | `extractFacts.office_phone` → `normalized.contacts` | report, enrich `phone_verified`, calibration | `interpretation.office_phone` |
| **staff_count** | `extractFacts.staff_count` (extractor); `synthesis.staff_count` (fallback input) | report Size, enrich, calibration | `interpretation.staff_count` |
| **address** | `normalize` address regex → `normalized.locations` | report Identity, dossier markdown | `interpretation.address` |
| **denomination** | `synthesis.denomination` (input) | report, enrich, calibration, markdown | `interpretation.denomination` |
| **attendance_estimate** | `synthesis.attendance_estimate` (input); min/max are sub-components | report, enrich, calibration, markdown | `interpretation.attendance_estimate` (+ synthesis min/max) |
| **lifecycle** | `synthesis.lifecycle_stage` (input) | report, calibration, markdown | `interpretation.lifecycle_stage` |
| **archetype** | `deriveArchetype` (computed in interpret from interpreted size/lifecycle) | report, calibration | `interpretation.archetype` |
| **digital_maturity_score** | `synthesis` value (input); `scoreConfidence` (+ strategic signals) for confidence | report, calibration, markdown | `interpretation.digital_maturity_score` |
| **growth_orientation_score** | `synthesis` value (input); `scoreConfidence` | report, calibration, markdown | `interpretation.growth_orientation_score` |
| **change_readiness_score** | `synthesis` value (input); `scoreConfidence` | report, calibration, markdown | `interpretation.change_readiness_score` |
| **staff_depth_score** | `synthesis` value (input); `scoreConfidence` | report, calibration, markdown | `interpretation.staff_depth_score` |
| **contactability** (5th score) | `deriveContactability` (computed in interpret from interpreted contacts) | report, calibration | `interpretation.contactability_score` |
| **technology_stack** | `detectTechStack` (hostname mapping, incl. outbound links) | report Technology stack, normalized | `normalized.technology_stack` |
| **strategic_signals** | `detectStrategicSignals` | report Strategic Signals, normalized | `normalized.external_signals` |
| **known_church_verified** | `discoverWebsite` identity (input) | report, (enrich website_verified) | `interpretation.known_church_verified` |

### Fields still owned by their single deterministic extractor (not interpreted)
These have exactly one producer and are consumed only via the calibration field
map / facts table; they are *not* contested, so they were left as-is:
`founded_year`, `years_active`, `campus_count`, `multi_site`, `online_giving_present`,
`church_app_status`, `app_provider`, `online_attendance_estimate`, social-presence
booleans. (Promoting these into `Interpretation` is a future option but out of
scope for this cleanup.)

## Duplicate producers found and resolved

The OFH run showed leadership being resolved in four places. Resolution:

| Old producer | Disposition |
|---|---|
| regex-over-text (`findRole` / `debugExtractionTrace`) | **instrumentation only** (DOSSIER_DEBUG) — produces no consumed value |
| `extractFacts.lead_pastor` (and exec/ops/comms) | **normalization input** — merged into `normalized.leaders`; no longer consumed as a conclusion |
| `aggregateLeadership` → `leadership[]` | **normalization input** — the `normalized.leaders` table |
| `synthesis.lead_pastor` | **interpretation input** — used only as a labelled fallback when no normalized leader exists |
| **`interpretation.lead_pastors`** | **source of truth** — the only value report + enrich read |

Other duplicates removed:
- `synthesis.denomination / lifecycle_stage / attendance_estimate` and
  `strategic.*_score` were read directly by the calibration field map, enrich, and
  dossier markdown → all now read `interpretation.*`.
- `synthesis.staff_count` was folded into `facts` inside `researchAgent`
  (interpreter writing into the normalizer) → removed; the fallback now lives in
  `interpretation.staff_count`.
- `digitalSignals.platforms` vs `detectTechStack`: `technology_stack` SoT is
  `detectTechStack`/`normalized.technology_stack`; `digital.platforms` remains
  **evidence only** (feeds digital-maturity confidence), never published as the stack.
- `scoreConfidence` reasons that ignored strategic signals were quarantined — the
  digital/growth/change/staff reasons now count strategic signals too (no stale
  "0 digital signals" when strategic signals exist).

## Guarantee (regression-tested)

`src/tests/sourceOfTruth.test.ts` fails if **any** report value or enrich value
differs from the interpretation conclusion for lead pastors, office email/phone,
staff count, denomination, attendance, lifecycle, archetype, and all four
synthesized scores. `src/tests/stabilization.test.ts` additionally proves a stale
single fact (e.g. "Jennifer" only) can never override
`interpretation.lead_pastors = [Dan, Jennifer]` in either the report or enrich.
