const express = require("express");
const { STORES } = require("../config");
const integrations = require("../integrations");
const { graphRequest } = require("../graph");
const google = require("../google");
const { getValidAccessToken } = require("./googleConnect");
const { requireAuth } = require("../auth");

const router = express.Router();
const STAR = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

async function fetchGoogleReviews(store) {
  const { accessToken, locationName } = await getValidAccessToken(store);
  const reviews = await google.fetchReviews(accessToken, locationName);
  return reviews.map((v) => ({
    media: "google",
    extId: "google:" + v.name,
    extName: v.name,
    author: v.reviewer?.displayName || "Googleユーザー",
    rating: STAR[v.starRating] ?? null,
    createTime: v.createTime,
    text: v.comment || "",
    reply: v.reviewReply?.comment || "",
  }));
}

async function fetchInstagramReviews(store) {
  const integration = await integrations.getIntegration(store, "instagram");
  if (!integration || integration.status !== "connected") {
    const err = new Error("Instagramが連携されていません。設定から連携してください");
    err.code = "not_connected";
    throw err;
  }
  const accessToken = integration.pageAccessToken;
  const igId = integration.igBusinessAccountId;
  const me = await graphRequest(`${igId}`, { fields: "username", access_token: accessToken });
  const media = await graphRequest(`${igId}/media`, {
    fields: "id,caption,permalink,timestamp",
    limit: 10,
    access_token: accessToken,
  });
  const out = [];
  for (const post of media.data || []) {
    const comments = await graphRequest(`${post.id}/comments`, {
      fields: "id,text,username,timestamp,replies{username,text}",
      limit: 50,
      access_token: accessToken,
    });
    for (const c of comments.data || []) {
      if (c.username === me.username) continue;
      const mine = (c.replies?.data || []).find((r) => r.username === me.username);
      out.push({
        media: "instagram",
        extId: "instagram:" + c.id,
        extName: c.id,
        permalink: post.permalink,
        author: "@" + (c.username || "instagram"),
        rating: null,
        createTime: c.timestamp,
        text: c.text || "",
        reply: mine?.text || "",
      });
    }
  }
  return out;
}

router.get("/reviews", requireAuth, async (req, res) => {
  try {
    const store = String(req.query.store || "");
    const media = String(req.query.media || "");
    if (!STORES.includes(store)) return res.status(400).json({ error: "店舗が不正です" });
    const items =
      media === "google"
        ? await fetchGoogleReviews(store)
        : media === "instagram"
          ? await fetchInstagramReviews(store)
          : null;
    if (!items) return res.status(400).json({ error: "対応していない媒体です" });
    res.json({ items });
  } catch (e) {
    res.status(e.code === "not_connected" ? 409 : 500).json({ error: e.message });
  }
});

module.exports = { router };
