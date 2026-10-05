// Google Business Profile 連携
//
// 注意（デプロイ前に必ず確認）:
// - Google Business Profile API の利用には Google への申請・承認が必要（審査に数日〜数週間）。
//   申請フォーム: https://support.google.com/business/contact/api_default
// - レビューの取得・返信は mybusiness.googleapis.com/v4 の Reviews リソースを使用する想定で実装しているが、
//   このAPIはGoogle側で頻繁に見直されている。本番投入前に必ず最新のAPIリファレンスと照合すること。
// - OAuth同意画面・認可情報（クライアントID/シークレット）はGoogle Cloud Consoleで作成し、
//   リダイレクトURIに `https://<region>-<project>.cloudfunctions.net/googleOAuthCallback` を登録する。

const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret } = require("firebase-functions/params");
const { FieldValue } = require("firebase-admin/firestore");
const { db } = require("./admin");

const GOOGLE_CLIENT_ID = defineSecret("GOOGLE_OAUTH_CLIENT_ID");
const GOOGLE_CLIENT_SECRET = defineSecret("GOOGLE_OAUTH_CLIENT_SECRET");
const REGION = "asia-northeast1";
const SCOPE = "https://www.googleapis.com/auth/business.manage";

function now() {
  const d = new Date();
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// Cloud Functions (2nd gen) の既定URL形式。`firebase deploy` の出力に表示される実際のURLと
// 一致していることを必ず確認し、Google Cloud ConsoleのOAuthクライアントに同じURIを登録すること。
// カスタムドメインを使う場合はこの関数を差し替える。
function googleOAuthRedirectUri() {
  return `https://${REGION}-${process.env.GCLOUD_PROJECT}.cloudfunctions.net/googleOAuthCallback`;
}

function integrationRef(storeId) {
  return db.collection("integrations").doc(`${storeId}_google`);
}

/**
 * callable: createGoogleConnectUrl()
 * ログイン中の店舗アカウント用に、Googleの認可画面URLを発行する。
 * stateはワンタイムトークンとしてFirestoreに保存し、コールバック側で検証する。
 */
const createGoogleConnectUrl = onCall({ secrets: [GOOGLE_CLIENT_ID], region: REGION }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "ログインが必要です");
  const storeId = request.auth.token.storeId;
  if (!storeId) throw new HttpsError("failed-precondition", "店舗情報が設定されていません");

  const state = db.collection("oauthStates").doc().id;
  await db.collection("oauthStates").doc(state).set({
    storeId,
    media: "google",
    createdAt: FieldValue.serverTimestamp(),
  });

  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID.value(),
    redirect_uri: googleOAuthRedirectUri(),
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    scope: SCOPE,
    state,
  });
  return { url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` };
});

/**
 * HTTP: googleOAuthCallback
 * Googleからのリダイレクトを受け取り、認可コードをトークンに交換してFirestoreへ保存する。
 */
const googleOAuthCallback = onRequest(
  { secrets: [GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET], region: REGION },
  async (req, res) => {
    const { code, state, error } = req.query;
    if (error) return res.status(400).send(`連携がキャンセルされました: ${error}`);
    if (!code || !state) return res.status(400).send("不正なリクエストです");

    const stateRef = db.collection("oauthStates").doc(String(state));
    const stateSnap = await stateRef.get();
    if (!stateSnap.exists) return res.status(400).send("認可リクエストの有効期限が切れています。もう一度お試しください");
    const { storeId } = stateSnap.data();
    await stateRef.delete();

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: String(code),
        client_id: GOOGLE_CLIENT_ID.value(),
        client_secret: GOOGLE_CLIENT_SECRET.value(),
        redirect_uri: googleOAuthRedirectUri(),
        grant_type: "authorization_code",
      }),
    });
    if (!tokenRes.ok) {
      console.error("google token exchange failed", await tokenRes.text());
      return res.status(502).send("Googleとの認可処理に失敗しました");
    }
    const tokens = await tokenRes.json();

    await integrationRef(storeId).set(
      {
        storeId,
        media: "google",
        refreshToken: tokens.refresh_token,
        accessToken: tokens.access_token,
        accessTokenExpiresAt: Date.now() + tokens.expires_in * 1000,
        connectedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    res.set("Content-Type", "text/html; charset=utf-8");
    res.send(`<!doctype html><meta charset="utf-8">
      <p>Googleアカウントと連携しました。このタブは閉じて構いません。</p>
      <p>続けて、管理画面の「連携設定」で対象の店舗ロケーションを選択してください。</p>
      <script>window.opener && window.opener.postMessage({ type: 'kuchikomi-oauth', media: 'google', ok: true }, '*'); setTimeout(() => window.close(), 1500);</script>`);
  },
);

async function getAccessToken(storeId) {
  const ref = integrationRef(storeId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("failed-precondition", "Googleアカウントが未連携です");
  const data = snap.data();
  if (data.accessToken && data.accessTokenExpiresAt > Date.now() + 60_000) {
    return data.accessToken;
  }
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID.value(),
      client_secret: GOOGLE_CLIENT_SECRET.value(),
      refresh_token: data.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!tokenRes.ok) throw new HttpsError("internal", "Googleトークンの更新に失敗しました");
  const tokens = await tokenRes.json();
  await ref.update({
    accessToken: tokens.access_token,
    accessTokenExpiresAt: Date.now() + tokens.expires_in * 1000,
  });
  return tokens.access_token;
}

/**
 * callable: listGoogleLocations()
 * 連携済みGoogleアカウントの中から、店舗として紐づけ可能なロケーション一覧を返す。
 */
const listGoogleLocations = onCall({ secrets: [GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET], region: REGION }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "ログインが必要です");
  const storeId = request.auth.token.storeId;
  const accessToken = await getAccessToken(storeId);

  const accountsRes = await fetch("https://mybusinessaccountmanagement.googleapis.com/v1/accounts", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!accountsRes.ok) throw new HttpsError("internal", "Googleアカウント一覧の取得に失敗しました");
  const { accounts = [] } = await accountsRes.json();

  const locations = [];
  for (const account of accounts) {
    const locRes = await fetch(
      `https://mybusinessbusinessinformation.googleapis.com/v1/${account.name}/locations?readMask=name,title,storefrontAddress`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!locRes.ok) continue;
    const { locations: locs = [] } = await locRes.json();
    for (const loc of locs) {
      locations.push({ name: loc.name, title: loc.title, address: loc.storefrontAddress });
    }
  }
  return { locations };
});

/**
 * callable: setGoogleLocation({ locationName })
 * 連携設定画面で選んだロケーションを、店舗の正式な紐付け先として保存する。
 */
const setGoogleLocation = onCall({ region: REGION }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "ログインが必要です");
  const storeId = request.auth.token.storeId;
  const { locationName } = request.data || {};
  if (!locationName) throw new HttpsError("invalid-argument", "locationName が必要です");
  await integrationRef(storeId).set({ locationName }, { merge: true });
  return { ok: true };
});

async function upsertReview({ storeId, storeName, media, externalId, author, rating, text, createTime }) {
  const existing = await db
    .collection("reviews")
    .where("storeId", "==", storeId)
    .where("media", "==", media)
    .where("externalId", "==", externalId)
    .limit(1)
    .get();
  if (!existing.empty) return false;

  await db.collection("reviews").add({
    storeId,
    store: storeName,
    media,
    externalId,
    author,
    rating,
    lang: "ja",
    text,
    reply: "",
    replyJa: "",
    status: "new",
    date: createTime || new Date().toISOString(),
    log: [`${now()}　Google Business Profile API から取得`],
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return true;
}

async function syncOneStore(storeId, locationName) {
  if (!locationName) return; // ロケーション未選択の店舗はスキップ
  const accessToken = await getAccessToken(storeId);
  const storeSnap = await db.collection("stores").doc(storeId).get();
  const storeName = storeSnap.exists ? storeSnap.data().name : storeId;

  // 注意: レビューの一覧取得は Reviews: list (mybusiness.googleapis.com/v4) 相当のエンドポイントを想定。
  // locationName は accounts/{account}/locations/{location} 形式。
  const accountPath = locationName.split("/locations/")[0];
  const res = await fetch(`https://mybusiness.googleapis.com/v4/${accountPath}/locations/${locationName.split("/locations/")[1]}/reviews`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`fetch failed: ${await res.text()}`);
  }
  const { reviews = [] } = await res.json();
  for (const r of reviews) {
    await upsertReview({
      storeId,
      storeName,
      media: "google",
      externalId: r.reviewId || r.name,
      author: r.reviewer && r.reviewer.displayName,
      rating: r.starRating ? { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 }[r.starRating] : null,
      text: r.comment || "",
      createTime: r.createTime,
    });
  }
}

/**
 * スケジュール実行: 15分おきに連携済みの全店舗のGoogleレビューを取得し、Firestoreに反映する。
 */
const syncGoogleReviews = onSchedule(
  { schedule: "every 15 minutes", secrets: [GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET], region: REGION },
  async () => {
    const integrations = await db.collection("integrations").where("media", "==", "google").get();
    for (const doc of integrations.docs) {
      const { storeId, locationName } = doc.data();
      try {
        await syncOneStore(storeId, locationName);
      } catch (err) {
        console.error(`syncGoogleReviews: error for store ${storeId}`, err);
      }
    }
  },
);

/**
 * callable: syncGoogleReviewsNow()
 * 「新着を取得」ボタンから、自分の店舗分だけ即時に同期する。
 */
const syncGoogleReviewsNow = onCall({ secrets: [GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET], region: REGION }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "ログインが必要です");
  const storeId = request.auth.token.storeId;
  const snap = await integrationRef(storeId).get();
  if (!snap.exists || !snap.data().locationName) throw new HttpsError("failed-precondition", "この店舗はGoogleと連携されていません");
  try {
    await syncOneStore(storeId, snap.data().locationName);
  } catch (err) {
    console.error(`syncGoogleReviewsNow: error for store ${storeId}`, err);
    throw new HttpsError("internal", "Googleレビューの取得に失敗しました");
  }
  return { ok: true };
});

/**
 * callable: postGoogleReply({ reviewId })
 * Firestoreに保存されている承認済み返信文を、実際にGoogleへ投稿する。
 */
const postGoogleReply = onCall({ secrets: [GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET], region: REGION }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "ログインが必要です");
  const { reviewId } = request.data || {};
  if (!reviewId) throw new HttpsError("invalid-argument", "reviewId が必要です");

  const ref = db.collection("reviews").doc(reviewId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "口コミが見つかりません");
  const review = snap.data();
  if (review.storeId !== request.auth.token.storeId) throw new HttpsError("permission-denied", "他店舗のデータは操作できません");
  if (!review.reply || !review.reply.trim()) throw new HttpsError("failed-precondition", "返信文が空です");

  const integSnap = await integrationRef(review.storeId).get();
  if (!integSnap.exists || !integSnap.data().locationName) {
    throw new HttpsError("failed-precondition", "この店舗はGoogleと連携されていません");
  }
  const accessToken = await getAccessToken(review.storeId);

  const res = await fetch(`https://mybusiness.googleapis.com/v4/${integSnap.data().locationName}/reviews/${review.externalId}/reply`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ comment: review.reply }),
  });
  if (!res.ok) {
    console.error("postGoogleReply failed", await res.text());
    throw new HttpsError("internal", "Googleへの返信投稿に失敗しました");
  }

  await ref.update({
    status: "sent",
    log: FieldValue.arrayUnion(`${now()}　Google Business Profile API で返信を投稿`),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return { ok: true };
});

module.exports = {
  createGoogleConnectUrl,
  googleOAuthCallback,
  listGoogleLocations,
  setGoogleLocation,
  syncGoogleReviews,
  syncGoogleReviewsNow,
  postGoogleReply,
};
