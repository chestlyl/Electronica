require("dotenv").config();

const fs = require("fs");
const path = require("path");
const express = require("express");
const Anthropic = require("@anthropic-ai/sdk");

const PORT = process.env.PORT || 3000;
const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-4-7";
const PRINCIPLES_FILE = path.join(__dirname, "principles.json");

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));
app.use("/fonts", express.static(path.join(__dirname, "fonts")));

function readPrinciples() {
  try {
    return JSON.parse(fs.readFileSync(PRINCIPLES_FILE, "utf8"));
  } catch {
    return [];
  }
}

function writePrinciples(principles) {
  fs.writeFileSync(PRINCIPLES_FILE, JSON.stringify(principles, null, 2) + "\n");
}

function anthropic() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    const err = new Error(
      "No Anthropic API key. Add ANTHROPIC_API_KEY to your .env file."
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
        `Stress Test: ${p.stressTest}\n` +
        `Connections: ${p.connections}\n` +
        `Insight: ${p.insight}`
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

app.get("/api/principles", (req, res) => {
  res.json(readPrinciples());
});

app.post("/api/principles", (req, res) => {
  const { name, refined, stressTest, connections, insight, raw } = req.body || {};
  const statement = (refined || raw || "").trim();
  if (!statement) {
    return res.status(400).json({ error: "A principle statement is required." });
  }

  const principles = readPrinciples();
  let finalName = (name || "").trim();
  if (!finalName) {
    finalName = statement
      .split(/\s+/)
      .slice(0, 4)
      .join(" ")
      .replace(/[.,;:!?]+$/, "");
  }

  const principle = {
    id: `p-${Date.now()}`,
    name: finalName,
    refined: statement,
    stressTest: (stressTest || "").trim(),
    connections: (connections || "").trim(),
    insight: (insight || "").trim(),
    dateAdded: new Date().toISOString().slice(0, 10),
  };

  principles.push(principle);
  writePrinciples(principles);
  res.json(principle);
});

app.post("/api/chat", async (req, res) => {
  try {
    const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
    if (messages.length === 0) {
      return res.status(400).json({ error: "No messages provided." });
    }

    const client = anthropic();
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: [
        {
          type: "text",
          text: buildSystemPrompt(readPrinciples()),
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

    const existing = readPrinciples().map((p) => `${p.name}: ${p.refined}`);
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
