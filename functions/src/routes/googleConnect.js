const express = require("express");
const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, APP_URL, STORES } = require("../config");
const { createState, consumeState } = require("../oauthState");
const integrations = require("../integrations");
const google = require("../google");
const { requireAuth } = require("../auth");

const router = express.Router();

function redirectUri() {
  return `${APP_URL.value()}/api/google/callback`;
}

router.get("/google/auth-url", requireAuth, async (req, res) => {
  try {
    const store = String(req.query.store || "");
    if (!STORES.includes(store)) return res.status(400).json({ error: "店舗が不正です" });
    const state = await createState({ uid: req.uid, store, media: "google" });
    const url = google.buildAuthUrl({
      clientId: GOOGLE_CLIENT_ID.value(),
      redirectUri: redirectUri(),
      state,
    });
    res.json({ url });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/google/callback", async (req, res) => {
  const { code, state, error } = req.query;
  const fail = (store, message) =>
    res.redirect(
      303,
      `${APP_URL.value()}/?connectError=google&message=${encodeURIComponent(message)}`
    );
  if (error) return fail(null, String(error));
  const parsed = await consumeState(state);
  if (!parsed || parsed.media !== "google") return fail(null, "連携用のリンクが無効または期限切れです");
  const { store } = parsed;
  try {
    const tokens = await google.exchangeCode({
      clientId: GOOGLE_CLIENT_ID.value(),
      clientSecret: GOOGLE_CLIENT_SECRET.value(),
      redirectUri: redirectUri(),
      code,
    });
    if (!tokens.refresh_token) {
      return fail(
        store,
        "Googleからrefresh tokenを取得できませんでした。一度アカウントの連携を解除してから、もう一度お試しください"
      );
    }
    const accounts = await google.listAccounts(tokens.access_token);
    const candidates = [];
    for (const account of accounts) {
      const locations = await google.listLocations(tokens.access_token, account.name);
      for (const loc of locations) {
        candidates.push({
          id: loc.name,
          label: `${account.accountName || account.name} ／ ${loc.locationName || loc.name}`,
          refreshToken: tokens.refresh_token,
          locationName: loc.name,
        });
      }
    }
    if (candidates.length === 0) {
      return fail(
        store,
        "Googleビジネスプロフィールのロケーションが見つかりませんでした。アカウントの権限をご確認ください"
      );
    }
    if (candidates.length === 1) {
      const { label, ...fields } = candidates[0];
      await integrations.setConnected(store, "google", { uid: parsed.uid, label, ...fields });
      return res.redirect(303, `${APP_URL.value()}/?connected=google`);
    }
    await integrations.setNeedsPick(store, "google", { uid: parsed.uid, candidates });
    res.redirect(303, `${APP_URL.value()}/?connected=google&pick=1`);
  } catch (e) {
    fail(store, e.message);
  }
});

router.post("/google/select", requireAuth, async (req, res) => {
  try {
    const { store, id } = req.body || {};
    if (!STORES.includes(store)) return res.status(400).json({ error: "店舗が不正です" });
    await integrations.pick(store, "google", id);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post("/google/disconnect", requireAuth, async (req, res) => {
  try {
    const { store } = req.body || {};
    if (!STORES.includes(store)) return res.status(400).json({ error: "店舗が不正です" });
    await integrations.disconnect(store, "google");
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/** reviews/reply用：保存済みのrefresh tokenから有効なアクセストークンを得る。 */
async function getValidAccessToken(store) {
  const integration = await integrations.getIntegration(store, "google");
  if (!integration || integration.status !== "connected") {
    const err = new Error("Googleが連携されていません。設定から連携してください");
    err.code = "not_connected";
    throw err;
  }
  const tokens = await google.refreshAccessToken({
    clientId: GOOGLE_CLIENT_ID.value(),
    clientSecret: GOOGLE_CLIENT_SECRET.value(),
    refreshToken: integration.refreshToken,
  });
  return { accessToken: tokens.access_token, locationName: integration.locationName };
}

module.exports = { router, getValidAccessToken };
