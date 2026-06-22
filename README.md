# The Principles

A personal AI decision-making agent that reasons exclusively through your own
library of principles. Bring a decision; the agent reasons only through your
principles (never general advice) and ends every response with a clear
`RECOMMENDATION`. Add new principles anytime and stress-test them against the
model.

Your principles library lives in your browser (`localStorage`). The server is
stateless — it only injects the principles you send into the model's system
prompt for each call.

## Deploy to the web (no terminal needed)

You will need two accounts: an **Anthropic** account (for the API key) and a
**Render** account (free; hosts the app). Total time: ~10 minutes.

### 1. Get an Anthropic API key

1. Go to **https://console.anthropic.com** and sign up / sign in.
2. Click **Billing** → add a payment method. You can set a low monthly limit
   (e.g. $5). Usage is pennies per conversation.
3. Click **API Keys** → **Create Key** → copy the long `sk-ant-...` string
   somewhere safe. You will only see it once.

### 2. Deploy on Render

1. Go to **https://dashboard.render.com/blueprints** and sign in with GitHub.
   When prompted, give Render access to your `Electronica` repository.
2. Click **New Blueprint Instance** and select the `Electronica` repo.
3. Render reads `render.yaml` and proposes a free web service. When it asks
   for `ANTHROPIC_API_KEY`, paste the key from step 1.
4. Click **Apply**. Render builds and starts the app — takes ~2–3 minutes.
5. When status turns green, click the URL at the top (it looks like
   `the-principles-xxxx.onrender.com`). Bookmark it.

The free Render plan sleeps the app after ~15 minutes of inactivity. The first
request after a sleep takes ~30 seconds to wake up; everything after is fast.

## Run on your own computer instead

1. `npm install`
2. `cp .env.example .env`, then paste your key after `ANTHROPIC_API_KEY=` in `.env`
3. `npm start`
4. Open **http://localhost:3000**

## Sections

- **Advise** — full conversation with the agent. Ends every response with a
  `RECOMMENDATION` block in gold.
- **Library** — every principle, numbered `P01`, `P02`, … Click one to expand
  Statement / Stress Test / Connections / Insight.
- **Add Principle** — **Save** stores immediately in your browser. **Stress
  Test** calls the model, shows a preview card, and saves on confirm.

The app ships with 7 seed principles that load the first time you open it.
