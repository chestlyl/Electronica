# wealth-agent

An **integrity-first** agent that helps grow a **$100 seed** into more — through
honest research, products, and commerce (including [Moltbook](https://www.moltbook.com),
the social network for AI agents) — **without ever touching your bank account.**

> **Read this first — the honest version.**
> No software turns $100 into riches on autopilot; anything that claims to is the
> scam itself. This tool does not promise wealth and does not move your money. It
> *finds and ranks honest opportunities, drafts the work, and tracks the money as
> a virtual ledger* — while **you** approve and execute every real transaction.
> Its whole design goal is to make the dishonest shortcuts (pump posts, fake
> reviews, vote gaming, overspending) **impossible by construction**, so the only
> path it leaves open is the legitimate one.

It is a sibling to [`church-intel`](../church-intel) and shares its discipline:
**every claim carries its evidence and an honest confidence; uncertain actions go
to a human; deception and manipulation are refused in code.**

---

## The three hard guarantees

1. **The agent never moves real money.** There is no bank, card, brokerage, or
   wallet credential anywhere in this project. Capital lives only in a *virtual
   ledger* (`src/ledger.ts`). The agent can **propose** entries; **you** approve,
   reject, and — after *you personally* complete the real transaction — mark them
   executed. `AGENT_MAY_MOVE_REAL_MONEY = false` is a constant, not a setting.

2. **Every outward action passes an integrity gate first** (`src/integrity.ts`).
   A `block` verdict is a hard stop. The rules:

   | Rule | What it blocks |
   |---|---|
   | `disclosure` | Public posts that don't disclose the author is an AI agent |
   | `no-impersonation` | Claiming to be human / fake identities / fake reviews |
   | `no-market-manipulation` | Pump-and-dump, hype, "guaranteed returns" (esp. m/cryptocurrency) |
   | `no-vote-gaming` | Vote inflation, brigading, karma farming |
   | `no-credential-harvest` | Asking for or handling passwords, keys, bank details |
   | `rate-limit` | Acting too fast (spammy cadence) |
   | `no-duplicate-spam` | Re-posting the same content across channels |
   | `spend-within-ledger` | Proposing to spend more than the seed has |
   | `disclose-paid-promotion` | Undisclosed affiliate/sponsored content (warns) |

3. **Nothing is posted by default.** The Moltbook client (`src/moltbook.ts`) is
   `dryRun` until you set a claimed agent handle *and* implement the network seam.
   It auto-appends an AI-agent disclosure to every post.

---

## Try it offline (no credentials, nothing posted, no money moved)

```bash
cd wealth-agent
npm install
npm run demo
```

The demo seeds a $100 virtual ledger, scouts + ranks honest opportunities,
proposes a first-move spend (proposed only — awaiting your approval), and runs
two Moltbook drafts through the integrity engine: an honest one (allowed,
dry-run) and a pump post (**blocked**).

Run the tests (27 assertions across the ledger, integrity engine, and scoring):

```bash
npm test
```

---

## How it works

```
                     $100 seed (virtual ledger only)
                                │
                   ┌────────────▼─────────────┐
                   │  scout: honest, low-cap   │   vetted catalog (offline),
                   │  opportunities + evidence │   optionally extended by Claude
                   └────────────┬─────────────┘
                                │ score (affordability · return · speed · confidence)
                                ▼
                      ranked plan, top pick first
                                │
                   agent PROPOSES a ledger entry  ──▶  human approves / rejects
                                │                              │
                                │                       human executes the REAL
                                │                       transaction, then marks it
                                ▼                              ▼
        any outward action (Moltbook post, outreach, spend)   ledger balance updates
                                │
                   ┌────────────▼─────────────┐
                   │  assessIntegrity(action)  │  block → never happens
                   └────────────┬─────────────┘
                                ▼
                   dry-run Moltbook (discloses AI identity; never posts by default)
```

The first opportunity in the catalog **productizes the `church-intel` engine that
already exists in this repo** — selling evidence-backed org/lead research as a
done-for-you deliverable. It's the highest-scoring path because it reuses real,
working code and has a real buyer.

---

## CLI

```bash
npm run cli -- status                 # money mode + ledger balance
npm run cli -- scout                  # rank honest opportunities vs. your capital
npm run cli -- integrity-policy       # print the rules every action is checked against
npm run cli -- check --kind post --content "..."   # test one action through the gate

# the agent proposes; a human decides (these are separate commands on purpose)
npm run cli -- propose --amount 20 --desc "API + landing page" --opp research-as-a-service
npm run cli -- ledger
npm run cli -- approve --id <id>      # HUMAN action
npm run cli -- execute --id <id>      # HUMAN action — you already paid/received in real life

# draft a Moltbook post through the integrity gate (dry-run; never posts)
npm run cli -- moltbook-draft --channel m/sideprojects --content "..."
```

---

## Configuration

Copy `.env.example` to `.env`. The agent needs **no financial credentials**. Key
settings: `SEED_CAPITAL_USD` (default 100), `MONEY_MODE` (`advise_only` default),
`MOLTBOOK_DRY_RUN` (default true), and an optional `ANTHROPIC_API_KEY` to let the
scout research additional opportunities (the built-in vetted catalog is always the
trustworthy floor).

### Money modes

| Mode | Meaning |
|---|---|
| `advise_only` *(default)* | Agent proposes; you execute every real transaction. Honors "don't touch my bank account" literally. |
| `prepaid_wallet` | You fund a *separate* prepaid instrument (isolated from your bank); agent still only proposes, you approve per action. |
| `scoped_autonomy` | Reserved. Requires explicit per-category limits you set later, once you trust the ledger. |

---

## What this is **not**

- Not a trading bot, and not financial advice. Market speculation is deliberately
  excluded as a primary path — it's the most likely way to lose the $100 and the
  most integrity-fraught corner of Moltbook (m/cryptocurrency).
- Not autonomous spending. The separation between *propose* (agent) and
  *approve/execute* (human) is the core safety property, enforced in `ledger.ts`.
- Not a guarantee. Opportunities carry honest confidence and named risks; the
  scoring **hard-caps** anything it isn't sure about.

## Project structure

```
wealth-agent/
├─ src/
│  ├─ types.ts          # core types (money in integer cents)
│  ├─ money.ts          # cents <-> dollars helpers
│  ├─ config.ts         # env config; AGENT_MAY_MOVE_REAL_MONEY = false
│  ├─ ledger.ts         # virtual ledger: agent proposes, human approves/executes
│  ├─ integrity.ts      # the integrity engine — every action is checked here
│  ├─ opportunities.ts  # conservative, confidence-capped scoring
│  ├─ scout.ts          # vetted opportunity catalog (+ optional Claude extension)
│  ├─ moltbook.ts       # integrity-gated, dry-run-by-default Moltbook client
│  ├─ cli.ts            # commands
│  ├─ demo.ts           # offline end-to-end demo
│  └─ tests/            # ledger / integrity / opportunities
└─ .env.example
```
