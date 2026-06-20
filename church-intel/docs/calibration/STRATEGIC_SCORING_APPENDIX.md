# Strategic Scoring — Calibration Appendix

> ⚠️ **PROVENANCE WARNING.** Cornerstone figures used as examples in this appendix are illustrative mock/placeholder values, **not discovered or verified facts** about the church. Only user-provided values (name/city/state, lead pastor, office email/phone) are real.

_Subject: Cornerstone Church (Akron, OH). Scores from the live run:
digital_maturity 55 · growth_orientation 68 · change_readiness 72 · staff_depth 40._

> This appendix is analysis only — it does **not** change scoring. Its purpose is
> to make the strategic layer's behavior legible so we can decide whether it
> measures what a church strategist actually cares about.

## How these four scores are produced (mechanism)

1. **They are produced entirely by the Claude dossier-synthesis model.** There is
   **no formula, rubric, or weighting in code.** `researchAgent.ts:215–218` only
   `clamp(0..100)`s whatever the model returned:
   ```ts
   change_readiness_score: synthesis.change_readiness_score == null ? null : clamp(...)
   ```
   (`grep` for these names in `src/lib/scoring.ts` returns **0** — the weighted
   formulas there are for `influence`/`mmc_fit`, not for these.)

2. **The only guidance is one prompt line** (`dossierPrompt.ts:188–189`):
   > "Score the strategic scores from real signals (relaunch/rebrand →
   > change_readiness; hiring/new ministries → growth & staff_depth;
   > app/livestream/giving/social → digital maturity)."
   There are no anchors (what is a 50 vs an 80?), no required evidence, no
   per-signal weights.

3. **Confidence is not per-metric.** All four share the dossier-level
   `research_confidence` (`calibration.ts:239–242`), which is
   `coverage + official-source bonus − conflicts`, capped by evidence access
   level. For Cornerstone (snippet-only, DOM 403) that lands in the low-50s — and
   it is identical for all four scores.

**The two consequences that matter:**
- The scores are a holistic LLM read of the evidence bundle, **gated by what was
  retrievable**. Cornerstone's site 403'd, so every score is inferred from search
  snippets + social + a job posting.
- **Absence of evidence pulls scores toward the middle** instead of being flagged.
  A 55 here can mean "genuinely average" *or* "we couldn't see it." The layer does
  not currently distinguish those — which is the central validity question.

## Per-metric breakdown

### digital_maturity — current **55** · confidence ≈ research_confidence (shared)
- **Positive signals (present):** modern website (Squarespace-style, "The Weekly"
  newsletter, /online-services), livestream (9 & 11 + "Join Us LIVE"), YouTube
  channel, Instagram ~1,098, Facebook ~1K, online giving referenced.
- **Missing signals:** church **app + provider** (none found), **giving/ChMS
  stack** (Subsplash / Planning Center / Pushpay), **podcast**, **online campus**,
  **SMS/text** platform, **website quality** (DOM never fetched), social
  **engagement/reach** metrics, **sermon view counts**, email-list size.
- **→ 75+ requires:** confirmed app + named giving/ChMS stack; OR active podcast +
  online campus; OR 10k+ engaged social / strong sermon views; OR a fetched,
  high-quality site with a text platform. (Most are gated on fetching the live DOM.)

### growth_orientation — current **68**
- **Positive signals:** actively **hiring a Next-Gen Director/Pastor**, the
  2020 **relaunch into a "new season,"** modern outreach posture ("curious about
  Jesus but cautious about church"), young lead pastor investing in next gen.
- **Missing signals:** **attendance trend** over time, **baptisms/decisions/
  new-member** counts, **number of recent hires**, **giving growth**, new
  ministries launched, **expansion/building/multisite** plans, **church-planting**.
- **→ 85+ requires:** measurable growth evidence — attendance up year-over-year,
  multiple recent hires, a new campus/service or building campaign, baptism
  numbers, or explicit multiplication/sending activity.

### change_readiness — current **72**
- **Positive signals (the strongest case):** they **executed a full relaunch /
  rebrand in 2020** — demonstrated, not aspirational, change; new name/voice/site;
  young, seminary-trained lead pastor.
- **Missing signals:** **leadership tenure & governance** model, **history of
  adopting new tools/models**, **network/cohort** participation, **leadership-
  development pipeline / residency**, explicit innovation/openness language, recent
  structural changes.
- **→ 85+ requires:** evidence of *repeated* adaptation — active network/cohort
  membership, a running residency/leadership pipeline, documented model changes
  (service style, multisite, online campus), or stated innovation posture.

### staff_depth — current **40**
- **Positive signals:** lead pastor identified, an open Next-Gen role, ~6 staff
  (estimate).
- **Missing signals:** **full staff roster**, **# full-time vs part-time**, **#
  pastors**, **exec / operations / communications** leaders (none found), **org
  structure**, **staff-to-attendance ratio**.
- **→ 70+ requires:** a full staff page with ~12+ staff including an executive
  pastor and department leaders (ops/comms/worship/kids/students), multiple
  full-time pastors, and a clear org structure.

## Summary table

| metric | current | confidence | strongest positive signal | biggest missing signal | move-up lever |
|---|---|---|---|---|---|
| digital_maturity | 55 | research_conf (shared) | livestream + web + social | app/giving/ChMS stack, site quality | fetch live DOM; confirm stack |
| growth_orientation | 68 | research_conf (shared) | hiring Next-Gen + relaunch | attendance trend, baptisms, hires | measurable growth evidence |
| change_readiness | 72 | research_conf (shared) | executed a 2020 relaunch | network/residency/governance | evidence of *repeated* adaptation |
| staff_depth | 40 | research_conf (shared) | lead pastor + open role | full staff roster, exec/ops/comms | full staff page (12+, exec pastor) |

## Calibration verdict (for discussion — not implemented)

The biggest weaknesses are structural, not numeric:
1. **No anchors / rubric** — the model picks 55 vs 68 with no shared definition of
   what each band means; two churches' scores aren't guaranteed comparable.
2. **Shared, not per-metric, confidence** — staff_depth and digital_maturity carry
   the same confidence even though we had more evidence for one than the other.
3. **Low-evidence → mid-score** — the layer doesn't separate "average" from
   "unseen." Cornerstone's 403'd DOM caps *everything* it could have measured.
4. **Single biggest lever is the live DOM** — app/giving stack, full staff roster,
   ministries, and vision language all live on the site we couldn't fetch. The
   deferred Playwright-inspection upgrade would move digital_maturity and
   staff_depth the most.

Open question for you: do you want these as **rubric-anchored, evidence-required
scores with per-metric confidence** (a scoring change, later), or is the current
LLM-judgment layer "good enough" as a directional signal once the live DOM is
fetched? This appendix is the input to that decision.
