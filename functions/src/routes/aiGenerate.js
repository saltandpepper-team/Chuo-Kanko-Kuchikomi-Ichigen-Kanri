const express = require("express");
const Anthropic = require("@anthropic-ai/sdk");
const { ANTHROPIC_API_KEY } = require("../config");
const { requireAuth } = require("../auth");

const router = express.Router();
const MODEL_BY_TIER = { quick: "claude-haiku-5-5" };
const DEFAULT_MODEL = "claude-sonnet-5-5";

router.post("/ai/generate", requireAuth, async (req, res) => {
  try {
    const { prompt, tier } = req.body || {};
    const text = String(prompt || "").trim();
    if (!text) return res.status(400).json({ error: "promptを指定してください" });

    const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value() });
    const message = await client.messages.create({
      model: MODEL_BY_TIER[tier] || DEFAULT_MODEL,
      max_tokens: 4096,
      messages: [{ role: "user", content: text }],
    });
    const out = message.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");
    res.json({ text: out });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = { router };
