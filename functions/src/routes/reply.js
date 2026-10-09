const express = require("express");
const { STORES } = require("../config");
const integrations = require("../integrations");
const { graphRequest } = require("../graph");
const google = require("../google");
const { getValidAccessToken } = require("./googleConnect");
const { requireAuth } = require("../auth");

const router = express.Router();

router.post("/reply", requireAuth, async (req, res) => {
  try {
    const { store, media, extName, comment } = req.body || {};
    if (!STORES.includes(store)) return res.status(400).json({ error: "店舗が不正です" });
    const text = String(comment || "").trim();
    if (!extName || !text) return res.status(400).json({ error: "extNameとcommentを指定してください" });

    if (media === "google") {
      const { accessToken } = await getValidAccessToken(store);
      await google.postReply(accessToken, extName, text);
    } else if (media === "instagram") {
      const integration = await integrations.getIntegration(store, "instagram");
      if (!integration || integration.status !== "connected") {
        const err = new Error("Instagramが連携されていません。設定から連携してください");
        err.code = "not_connected";
        throw err;
      }
      await graphRequest(
        `${extName}/replies`,
        { message: text, access_token: integration.pageAccessToken },
        { method: "POST" }
      );
    } else {
      return res.status(400).json({ error: "この媒体はAPI送信に対応していません" });
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(e.code === "not_connected" ? 409 : 500).json({ error: e.message });
  }
});

module.exports = { router };
