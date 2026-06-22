require("dotenv").config();

const fs = require("fs");
const path = require("path");
const express = require("express");
const Anthropic = require("@anthropic-ai/sdk");

const PORT = process.env.PORT || 3000;
const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-4-7";
const SEEDS_FILE = path.join(__dirname, "principles.json");

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));
app.use("/fonts", express.static(path.join(__dirname, "fonts")));

let seedsCache = null;
function readSeeds() {
  if (!seedsCache) {
    seedsCache = JSON.parse(fs.readFileSync(SEEDS_FILE, "utf8"));
  }
  return seedsCache;
}

function anthropic() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    const err = new Error(
      "No Anthropic API key is set on the server. Add ANTHROPIC_API_KEY in your hosting dashboard."
    );
    err.statusCode = 400;
    throw err;
  }
  return new Anthropic({ apiKey });
}

function buildSystemPrompt(principles) {
  const formatted = principles
    .map(
      (p, i) =>
        `P${String(i + 1).padStart(2, "0")} — ${p.name}\n` +
        `Statement: ${p.refined}\n` +
        `Stress Test: ${p.stressTest || "—"}\n` +
        `Connections: ${p.connections || "—"}\n` +
        `Insight: ${p.insight || "—"}`
    )
    .join("\n\n");

  return `You are a personal strategic advisor — a principles-based decision-making agent built exclusively on the accumulated wisdom of the person you serve. You do not draw from general knowledge or outside frameworks. You reason through the lens of these specific principles only.

PRINCIPLES:
${formatted}

RULES:
- Engage in deep probing strategic conversation — not shallow reassurance
- Apply relevant principles naturally, by name, without being mechanical
- Challenge thinking where the principles suggest a different path
- Ask one sharp question at a time — never multiple questions
- You are not a yes-man. Stress test. Find what might be missing.
- Keep responses sharp and focused
- Always end with: RECOMMENDATION: followed by a direct actionable recommendation. No hedging. One clear direction.`;
}

app.get("/api/seeds", (req, res) => {
  res.json(readSeeds());
});

app.post("/api/chat", async (req, res) => {
  try {
    const { messages, principles } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "No messages provided." });
    }
    const lib = Array.isArray(principles) ? principles : [];
    if (lib.length === 0) {
      return res.status(400).json({ error: "No principles to reason through." });
    }

    const client = anthropic();
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: [
        {
          type: "text",
          text: buildSystemPrompt(lib),
          cache_control: { type: "ephemeral" },
        },
      ],
      messages,
    });

    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    res.json({ reply: text });
  } catch (err) {
    res
      .status(err.statusCode || 500)
      .json({ error: err.message || "Failed to reach the advisor." });
  }
});

app.post("/api/refine", async (req, res) => {
  try {
    const raw = (req.body?.raw || "").trim();
    if (!raw) {
      return res.status(400).json({ error: "Nothing to stress test." });
    }

    const existing = Array.isArray(req.body?.existing)
      ? req.body.existing.map((p) => `${p.name}: ${p.refined}`)
      : [];

    const client = anthropic();
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4000,
      messages: [
        {
          role: "user",
          content: `Process this raw principle and return ONLY valid JSON, no markdown:
Raw principle: "${raw}"
Existing principles: ${JSON.stringify(existing)}
Return: {"name":"2-4 word name","refined":"precise statement","stressTest":"conditions where this fails","connections":"how this connects to existing principles","insight":"one additional insight"}`,
        },
      ],
    });

    let text = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return res
        .status(502)
        .json({ error: "The model did not return valid JSON. Try again." });
    }

    res.json(parsed);
  } catch (err) {
    res
      .status(err.statusCode || 500)
      .json({ error: err.message || "Failed to stress test the principle." });
  }
});

app.listen(PORT, () => {
  console.log(`The Principles running at http://localhost:${PORT}`);
});
