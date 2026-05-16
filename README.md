# The Principles

A personal AI decision-making agent that reasons exclusively through your own
library of principles. Talk to it about a decision and it answers only through
your principles — never general advice — and ends every response with a clear
RECOMMENDATION. Add new principles anytime; stress-test them against the model.

## Setup

1. Install dependencies:

   ```
   npm install
   ```

2. Add your Anthropic API key:

   ```
   cp .env.example .env
   ```

   Then open `.env` and paste your key after `ANTHROPIC_API_KEY=`.

3. Start the app:

   ```
   npm start
   ```

4. Open it in your browser:

   ```
   http://localhost:3000
   ```

## Sections

- **Advise** — a full conversation with the agent. It reasons only through your
  principles and ends every response with a `RECOMMENDATION`.
- **Library** — every principle, numbered `P01`, `P02`, … Click one to expand
  its Statement, Stress Test, Connections, and Insight.
- **Add Principle** — write a principle and either **Save** it immediately
  (works without an API key) or **Stress Test** it (refines the language,
  finds where it fails, connects it to existing principles, surfaces one
  insight) and confirm before saving.

Principles persist in `principles.json` between sessions. The app ships with 7
seed principles. Saving never requires an API key; Advise and Stress Test do.
