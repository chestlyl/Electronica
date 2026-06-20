<!-- ILLUSTRATIVE: ground truth is sample data, not verified with the church. -->

# Calibration report — Cornerstone Church (SAMPLE / illustrative ground truth)
_generated 2026-06-20T05:05:57.139Z · evidence access: **search_snippets** (confidence cap **65**)_

## Scorecard
- correct: **20** · wrong: **1** · missing: **6** (of 27 ground-truthed)
- overconfident: **1** · underconfident: **0**
- tool closer to truth: 3 · Claude closer: 6
- confidence-cap violations: **0** (none — cap respected)

## Field-by-field (tool vs Claude vs ground truth)
| | field | tool _(conf)_ | Claude _(conf)_ | ground truth | status | closer |
|---|---|---|---|---|---|---|
| ✓ | Church name | Cornerstone Church _(60)_ | Cornerstone Church _(95)_ | Cornerstone Church _(100)_ | correct | tie |
| ✓ | City | Akron _(60)_ | Akron _(92)_ | Akron _(100)_ | correct | tie |
| ✓ | State | OH _(60)_ | OH _(92)_ | OH _(100)_ | correct | tie |
| ✓◔ | Lead pastor | Jacob Young _(65)_ | Jacob Young _(65)_ | Jacob Young _(100)_ | correct | tie |
| ✓ | Lead pastor role | Lead Pastor _(60)_ | Lead Pastor _(60)_ | Lead Pastor _(100)_ | correct | tie |
| ✓◔ | Denomination | Non-denominational _(65)_ | Non-denominational _(80)_ | Non-denominational _(100)_ | correct | tie |
| ○ | Multi-site? | — | false _(70)_ | false _(100)_ | missing | claude |
| ○ | Campus count | — | 1 _(70)_ | 1 _(100)_ | missing | claude |
| ✓◔ | Lifecycle stage | relaunch_revitalization _(65)_ | relaunch_revitalization _(60)_ | relaunch_revitalization _(100)_ | correct | tie |
| ○ | Founded year | — | 1980 _(88)_ | 1980 _(100)_ | missing | claude |
| ✗‼ | Avg weekly attendance | 300 _(65)_ | 300 _(30)_ | 220 _(100)_ | wrong (overconf) | tie |
| ✓◔ | Online attendance | 120 _(65)_ | 140 _(20)_ | 90 _(90)_ | correct | tool |
| ○ | Staff count | — | 8 _(30)_ | 6 _(100)_ | missing | claude |
| ○ | Annual budget | — | 850000 _(18)_ | 600000 _(90)_ | missing | claude |
| ✓ | App status | none_found _(60)_ | none_found _(55)_ | none_found _(100)_ | correct | tie |
| · | App provider | — _(40)_ | — _(15)_ | — _(100)_ | unverified | na |
| ✓◔ | Livestream present | true _(65)_ | true _(85)_ | true _(100)_ | correct | tie |
| ✓◔ | YouTube present | true _(65)_ | true _(90)_ | true _(100)_ | correct | tie |
| ✓◔ | Instagram present | true _(65)_ | true _(80)_ | true _(100)_ | correct | tie |
| ✓◔ | Facebook present | true _(65)_ | true _(80)_ | true _(100)_ | correct | tie |
| ✓ | Instagram followers | 1,098 _(60)_ | 1098 _(80)_ | 1098 _(100)_ | correct | tie |
| ✓ | Facebook followers | 1K _(60)_ | 1000 _(80)_ | 1000 _(100)_ | correct | tie |
| ○ | Online giving present | — | true _(55)_ | true _(100)_ | missing | claude |
| ✓ | Change readiness | 70 _(59)_ | 60 _(35)_ | 65 _(70)_ | correct | tie |
| ✓ | Digital maturity | 50 _(59)_ | 45 _(30)_ | 50 _(70)_ | correct | tool |
| ✓ | Growth orientation | 55 _(59)_ | 50 _(30)_ | 55 _(70)_ | correct | tool |
| ✓ | Evidence access level | search_snippets _(90)_ | search_snippets _(90)_ | search_snippets _(100)_ | correct | tie |
| ✓ | Contamination flag | true _(80)_ | true _(80)_ | true _(100)_ | correct | tie |

## Correct fields (20)
- **Church name**: tool=Cornerstone Church _(60)_ · truth=Cornerstone Church _(100)_ · Claude=Cornerstone Church _(95)_
- **City**: tool=Akron _(60)_ · truth=Akron _(100)_ · Claude=Akron _(92)_
- **State**: tool=OH _(60)_ · truth=OH _(100)_ · Claude=OH _(92)_
- **Lead pastor**: tool=Jacob Young _(65)_ · truth=Jacob Young _(100)_ · Claude=Jacob Young _(65)_
- **Lead pastor role**: tool=Lead Pastor _(60)_ · truth=Lead Pastor _(100)_ · Claude=Lead Pastor _(60)_
- **Denomination**: tool=Non-denominational _(65)_ · truth=Non-denominational _(100)_ · Claude=Non-denominational _(80)_
- **Lifecycle stage**: tool=relaunch_revitalization _(65)_ · truth=relaunch_revitalization _(100)_ · Claude=relaunch_revitalization _(60)_
- **Online attendance**: tool=120 _(65)_ · truth=90 _(90)_ · Claude=140 _(20)_
- **App status**: tool=none_found _(60)_ · truth=none_found _(100)_ · Claude=none_found _(55)_
- **Livestream present**: tool=true _(65)_ · truth=true _(100)_ · Claude=true _(85)_
- **YouTube present**: tool=true _(65)_ · truth=true _(100)_ · Claude=true _(90)_
- **Instagram present**: tool=true _(65)_ · truth=true _(100)_ · Claude=true _(80)_
- **Facebook present**: tool=true _(65)_ · truth=true _(100)_ · Claude=true _(80)_
- **Instagram followers**: tool=1,098 _(60)_ · truth=1098 _(100)_ · Claude=1098 _(80)_
- **Facebook followers**: tool=1K _(60)_ · truth=1000 _(100)_ · Claude=1000 _(80)_
- **Change readiness**: tool=70 _(59)_ · truth=65 _(70)_ · Claude=60 _(35)_
- **Digital maturity**: tool=50 _(59)_ · truth=50 _(70)_ · Claude=45 _(30)_
- **Growth orientation**: tool=55 _(59)_ · truth=55 _(70)_ · Claude=50 _(30)_
- **Evidence access level**: tool=search_snippets _(90)_ · truth=search_snippets _(100)_ · Claude=search_snippets _(90)_
- **Contamination flag**: tool=true _(80)_ · truth=true _(100)_ · Claude=true _(80)_

## Wrong fields (1)
- **Avg weekly attendance**: tool=300 _(65)_ · truth=220 _(100)_ · Claude=300 _(30)_

## Overconfident fields (1)
_wrong, yet asserted with confidence ≥ 60 — the dangerous quadrant_
- **Avg weekly attendance**: tool=300 _(65)_ · truth=220 _(100)_ · Claude=300 _(30)_

## Underconfident fields (0)
_correct, but confidence < 50_
- none

## Missing fields (6)
_ground truth exists but the tool produced no estimate — candidates for new extraction_
- **Multi-site?**: tool=— · truth=false _(100)_ · Claude=false _(70)_
- **Campus count**: tool=— · truth=1 _(100)_ · Claude=1 _(70)_
- **Founded year**: tool=— · truth=1980 _(100)_ · Claude=1980 _(88)_
- **Staff count**: tool=— · truth=6 _(100)_ · Claude=8 _(30)_
- **Annual budget**: tool=— · truth=600000 _(90)_ · Claude=850000 _(18)_
- **Online giving present**: tool=— · truth=true _(100)_ · Claude=true _(55)_

## Conflicts preserved (1)
- **lead_pastor_role**: "Lead Pastor" vs "Associate Pastor" → recommended **Lead Pastor** _(conf 60)_ — preserved, not resolved silently

## Confidence-cap behavior
- Access level **search_snippets** caps every tool confidence at **65**.
- Cap violations: **0** — cap correctly enforced.
- Correct fields pinned at the cap ceiling: lead_pastor, denomination, lifecycle_stage, online_attendance_estimate, livestream_present, youtube_present, instagram_present, facebook_present.
- Capping cost (correct, but ≥15 below Claude's confidence — the price of honesty): church_name, city, state, denomination, livestream_present, youtube_present, instagram_present, facebook_present, instagram_followers, facebook_followers.

## Where the tool under-performed Claude
- **Multi-site?**: Claude=false _(70)_ was closer than tool=— (truth=false _(100)_)
- **Campus count**: Claude=1 _(70)_ was closer than tool=— (truth=1 _(100)_)
- **Founded year**: Claude=1980 _(88)_ was closer than tool=— (truth=1980 _(100)_)
- **Staff count**: Claude=8 _(30)_ was closer than tool=— (truth=6 _(100)_)
- **Annual budget**: Claude=850000 _(18)_ was closer than tool=— (truth=600000 _(90)_)
- **Online giving present**: Claude=true _(55)_ was closer than tool=— (truth=true _(100)_)
