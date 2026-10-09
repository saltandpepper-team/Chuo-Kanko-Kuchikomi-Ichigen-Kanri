const express = require("express");
const { INSTAGRAM_APP_ID, INSTAGRAM_APP_SECRET, APP_URL, STORES } = require("../config");
const { createState, consumeState } = require("../oauthState");
const integrations = require("../integrations");
const { graphRequest } = require("../graph");
const { requireAuth } = require("../auth");

const router = express.Router();

const SCOPES = [
  "instagram_basic",
  "instagram_manage_comments",
  "pages_show_list",
  "pages_read_engagement",
].join(",");

function redirectUri() {
  return `${APP_URL.value()}/api/instagram/callback`;
}

router.get("/instagram/auth-url", requireAuth, async (req, res) => {
  try {
    const store = String(req.query.store || "");
    if (!STORES.includes(store)) return res.status(400).json({ error: "店舗が不正です" });
    const state = await createState({ uid: req.uid, store, media: "instagram" });
    const url = new URL("https://www.facebook.com/v21.0/dialog/oauth");
    url.searchParams.set("client_id", INSTAGRAM_APP_ID.value());
    url.searchParams.set("redirect_uri", redirectUri());
    url.searchParams.set("state", state);
    url.searchParams.set("scope", SCOPES);
    url.searchParams.set("response_type", "code");
    res.json({ url: url.toString() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/instagram/callback", async (req, res) => {
  const { code, state, error, error_description: errorDescription } = req.query;
  const fail = (message) =>
    res.redirect(
      303,
      `${APP_URL.value()}/?connectError=instagram&message=${encodeURIComponent(message)}`
    );
  if (error) return fail(errorDescription || String(error));
  const parsed = await consumeState(state);
  if (!parsed || parsed.media !== "instagram") return fail("連携用のリンクが無効または期限切れです");
  const { store, uid } = parsed;
  try {
    const shortLived = await graphRequest("oauth/access_token", {
      client_id: INSTAGRAM_APP_ID.value(),
      client_secret: INSTAGRAM_APP_SECRET.value(),
      redirect_uri: redirectUri(),
      code,
    });
    const longLived = await graphRequest("oauth/access_token", {
      grant_type: "fb_exchange_token",
      client_id: INSTAGRAM_APP_ID.value(),
      client_secret: INSTAGRAM_APP_SECRET.value(),
      fb_exchange_token: shortLived.access_token,
    });
    const pages = await graphRequest("me/accounts", {
      access_token: longLived.access_token,
      fields: "id,name,access_token,instagram_business_account{id,username}",
    });
    const candidates = (pages.data || [])
      .filter((p) => p.instagram_business_account)
      .map((p) => ({
        id: p.id,
        label: `${p.name}（Instagram: @${p.instagram_business_account.username}）`,
        pageAccessToken: p.access_token,
        igBusinessAccountId: p.instagram_business_account.id,
        igUsername: p.instagram_business_account.username,
      }));

    if (candidates.length === 0) {
      return fail(
        "InstagramビジネスアカウントがリンクされたFacebookページが見つかりませんでした。Facebookページの設定でInstagramアカウントをリンクしてから、もう一度お試しください"
      );
    }
    if (candidates.length === 1) {
      const { label, ...fields } = candidates[0];
      await integrations.setConnected(store, "instagram", { uid, label, ...fields });
      return res.redirect(303, `${APP_URL.value()}/?connected=instagram`);
    }
    await integrations.setNeedsPick(store, "instagram", { uid, candidates });
    res.redirect(303, `${APP_URL.value()}/?connected=instagram&pick=1`);
  } catch (e) {
    fail(e.message);
  }
});

router.post("/instagram/select", requireAuth, async (req, res) => {
  try {
    const { store, id } = req.body || {};
    if (!STORES.includes(store)) return res.status(400).json({ error: "店舗が不正です" });
    await integrations.pick(store, "instagram", id);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post("/instagram/disconnect", requireAuth, async (req, res) => {
  try {
    const { store } = req.body || {};
    if (!STORES.includes(store)) return res.status(400).json({ error: "店舗が不正です" });
    await integrations.disconnect(store, "instagram");
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

module.exports = { router };
