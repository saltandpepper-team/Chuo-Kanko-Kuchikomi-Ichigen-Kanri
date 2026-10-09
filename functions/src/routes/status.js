const express = require("express");
const { STORES } = require("../config");
const integrations = require("../integrations");
const { requireAuth } = require("../auth");

const MEDIA = ["google", "instagram"];
const router = express.Router();

router.get("/status", requireAuth, async (req, res) => {
  try {
    const stores = {};
    for (const store of STORES) {
      stores[store] = {};
      for (const media of MEDIA) {
        stores[store][media] = integrations.toStatus(await integrations.getIntegration(store, media));
      }
    }
    res.json({ stores });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = { router };
