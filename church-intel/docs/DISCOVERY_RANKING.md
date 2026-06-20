# Discovery ranking — identity verification

Discovery now answers **"is this the website for THIS church?"** — not merely
"is this a church website?". The previous ranking rewarded any reachable
church-like site near the city, which produced confident false positives. The
new model is **identity-first** and **prefers NO MATCH over a false positive**.

## Scoring priorities (positive)

| Priority | Signal | Weight |
|---|---|---|
| 1 | **Exact church name match** (all distinctive name/alt-name tokens found in the candidate's title/og/h1/host) | +45 |
| 1b | Partial name match (≥50%) | +22 |
| 2 | **Exact city match** (church city appears on the candidate page) | +25 |
| 3 | **Denominational directory confirmation** (a district/association page listing this church) | +25 |
| 4 | **Official church website** (the site's own first-person church markers) | +15 |
| — | Church-provided URL (the spreadsheet `website_original` / `urlname`) | +40 prior |
| 5 | Reachability (HTTP 2xx) | +5 |
| 6 | Church-like content | +5 |

## Negative scoring

| Condition | Penalty |
|---|---|
| Candidate name **cannot** be matched to the church name | **−40** |
| Candidate places itself in a **different city/state** (city conflict) | **−30** |
| Candidate is a **church resource / parachurch** (CBS, sermon sites, study orgs) not a church | **−30** |
| Candidate is a **generic directory / social** profile | −10 |
| Unclassified site | −5 |

## Candidate kinds

Identity can only be **proven** by `official_church` or `denom_directory`; every
other kind is capped below the acceptance bar (cannot become a `true_match`).

| kind | meaning | can be true_match? |
|---|---|---|
| `official_church` | the church's **own** site (carries church-owned nav: give/sermons/visit/ministries + first-person markers) | ✅ |
| `denom_directory` | a denominational/district directory entry confirming this church | ✅ |
| `general_directory` | yelp/facebook/yellowpages profile | ❌ (capped) |
| `resource` | parachurch / bible-study / sermon resource | ❌ (capped) |
| `vendor_reference` | contractor/architect/builder/vendor page **about** a church project | 🚫 **disqualified** |
| `media_reference` | news/media article **about** a church | 🚫 **disqualified** |
| `unknown` | church-like page with no ownership signals — *mentions* a church but doesn't represent it | ❌ (capped) |

## Hard disqualifiers (never a true_match)

A candidate is rejected outright when:

- the domain belongs to a **contractor, architect, builder, consultant, vendor,
  news site, or media outlet** (`vendor_reference` / `media_reference`);
- the page is **describing** a church rather than **representing** it (third-person);
- the page lacks **church-owned signals** — navigation/links to give, sermons,
  service times, plan-a-visit, ministries, events, staff (ownership signals < 2).

Plus the basic gates → identity 0 / `no_match`: unreachable, parked/placeholder
domain, or a **non-identifying church name** (blank or garbage like `26:16:00`).

> **A page ABOUT a church is not a church.**

## `identity_confidence` and verdict

Each candidate gets `identity_confidence` (0–100). The discovery winner is the
highest-scoring candidate **only if** it clears the acceptance bar:

| identity_confidence | verdict | used as official site? |
|---|---|---|
| **≥ 65** | `true_match` | ✅ yes |
| 45–64 | `uncertain` | ❌ no → NO MATCH (routed to review) |
| < 45 | `no_match` | ❌ no |

"A church website" (church-like content) is necessary but **not sufficient** —
without a name **and** location tie to this specific church, the candidate is
rejected.

## Worked evaluation — row-2, row-3, row-4

> Verdicts below are produced by the new ranking (validated here against
> fixtures reproducing the candidates you reported). Regenerate the live version
> any time with:
> ```
> npm run cli -- discovery-report --ids row-2,row-3,row-4 --out data/output/discovery_report.md
> ```

### row-2 — 14Six (Westminster, CA) — seed `stantonchurch.org`
**✅ TRUE MATCH → https://www.stantonchurch.org (identity 100)**

| candidate | id | verdict | why |
|---|---|---|---|
| `stantonchurch.org` (original) | 100 | true_match | church-provided URL (+40), **full name match** via the alt name "Stanton Lighthouse Community" (+45), **city match** Westminster (+25), official church markers (+15) |

The alt-name (`urlname`) field is what links "14Six" to the "Stanton" domain —
this is why feeding `urlname` into discovery matters.

### row-3 — `26:16:00` (Farmington, NM)
**🚫 NO MATCH (identity 0)**

| candidate | id | verdict | why |
|---|---|---|---|
| `farmington.cbsclass.org` | 0 | no_match | **church resource** (Community Bible Study), name match 0, only the city matched |

The church name is non-identifying (an Excel time artifact with no distinctive
tokens), so **no** site can be tied to this specific church. The earlier pick of
`farmington.cbsclass.org` was exactly the "a church-ish site in Farmington"
failure mode — now rejected on both counts (resource kind **and** name=0). This
row is routed to the review queue for a human to fix the name first.

### row-4 — A Place of Hope (Forney, TX)
**✅ TRUE MATCH → the Nazarene district directory (identity 100)**

| candidate | id | verdict | why |
|---|---|---|---|
| `netxnaz.net/church-directory/a-place-of-hope-church/` | 100 | true_match | **denominational directory confirmation** (+25), **full name match** (+45), **city match** Forney, TX (+25) |
| `placeofhope.org/outreach` | 40 | no_match | full name match, but **city conflict** — the site places itself in Palm Beach Gardens, FL (−30). A *different* "Place of Hope". |

This matches your judgment: the directory that confirms *this* church in *this*
city beats a same-named church's site in a different state. The directory both
confirms identity and (being the North/East Texas Nazarene district) corroborates
the denomination.

### row-4 follow-up — the construction-company false positive

A later run surfaced
`forneyconstruction.com/portfolio/hope-city-church-the-woodlands/` — a **builder's
portfolio page about a church project** — at **identity 72**.

**Why it reached 72 (old logic):**

| component | points |
|---|---|
| partial name match (the church name appears in the portfolio title/URL) | +22 |
| city match (coincidental — "Forney" appears because the *contractor* is **Forney** Construction) | +25 |
| `official_church` (**misclassified** — the page is church-like and the host wasn't a known directory/resource, so it was treated as a church's own site) | +15 |
| reachable + church content | +10 |
| **total** | **72** ≥ 65 → false `true_match` |

**Why it's now rejected (id 15, `no_match`):** the host matches the vendor
pattern (`construct`), so it is classified `vendor_reference` and **disqualified**
regardless of name/city. Independently, it would also fail the new
`official_church` gate — a contractor portfolio has no give/sermons/visit/
ministries navigation, so its ownership-signal count is < 2. The church's real
site (with church-owned navigation) wins instead, or the row returns NO MATCH.

## Inspecting any church

```
npm run cli -- discover-church --id row-4
```
prints the ranked candidates with `identity_confidence`, `name`/`city` match,
`kind`, verdict, and the scoring breakdown for each — and the final
TRUE MATCH / NO MATCH decision.
