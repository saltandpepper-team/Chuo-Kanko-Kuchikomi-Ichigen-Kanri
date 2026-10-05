// Instagram Graph API 連携（Instagramビジネス/クリエイターアカウント + 連携Facebookページが必要）
//
// 注意（デプロイ前に必ず確認）:
// - Meta for Developers でアプリを作成し、instagram_basic / instagram_manage_comments /
//   pages_show_list / pages_read_engagement 等の権限についてApp Reviewの承認を受ける必要がある
//   （開発モードのままではテスト登録した管理者アカウントでしか動作しない）。
// - 本実装は Instagram の「コメント」を口コミ相当として扱う（Instagramには公式のレビュー機能がないため）。
// - Graph APIのバージョンは頻繁に更新される。本番投入前に最新のAPIバージョン・エンドポイントを確認すること。

const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret } = require("firebase-functions/params");
const { FieldValue } = require("firebase-admin/firestore");
const { db } = require("./admin");

const META_APP_ID = defineSecret("META_APP_ID");
const META_APP_SECRET = defineSecret("META_APP_SECRET");
const REGION = "asia-northeast1";
const GRAPH_VERSION = "v21.0";
const SCOPE = ["instagram_basic", "instagram_manage_comments", "pages_show_list", "pages_read_engagement"].join(",");

function now() {
  const d = new Date();
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function instagramOAuthRedirectUri() {
  return `https://${REGION}-${process.env.GCLOUD_PROJECT}.cloudfunctions.net/instagramOAuthCallback`;
}

function integrationRef(storeId) {
  return db.collection("integrations").doc(`${storeId}_instagram`);
}

const createInstagramConnectUrl = onCall({ secrets: [META_APP_ID], region: REGION }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "ログインが必要です");
  const storeId = request.auth.token.storeId;
  if (!storeId) throw new HttpsError("failed-precondition", "店舗情報が設定されていません");

  const state = db.collection("oauthStates").doc().id;
  await db.collection("oauthStates").doc(state).set({
    storeId,
    media: "instagram",
    createdAt: FieldValue.serverTimestamp(),
  });

  const params = new URLSearchParams({
    client_id: META_APP_ID.value(),
    redirect_uri: instagramOAuthRedirectUri(),
    response_type: "code",
    scope: SCOPE,
    state,
  });
  return { url: `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth?${params.toString()}` };
});

const instagramOAuthCallback = onRequest(
  { secrets: [META_APP_ID, META_APP_SECRET], region: REGION },
  async (req, res) => {
    const { code, state, error } = req.query;
    if (error) return res.status(400).send(`連携がキャンセルされました: ${error}`);
    if (!code || !state) return res.status(400).send("不正なリクエストです");

    const stateRef = db.collection("oauthStates").doc(String(state));
    const stateSnap = await stateRef.get();
    if (!stateSnap.exists) return res.status(400).send("認可リクエストの有効期限が切れています。もう一度お試しください");
    const { storeId } = stateSnap.data();
    await stateRef.delete();

    const shortTokenParams = new URLSearchParams({
      client_id: META_APP_ID.value(),
      client_secret: META_APP_SECRET.value(),
      redirect_uri: instagramOAuthRedirectUri(),
      code: String(code),
    });
    const shortRes = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token?${shortTokenParams.toString()}`);
    if (!shortRes.ok) {
      console.error("instagram short-lived token exchange failed", await shortRes.text());
      return res.status(502).send("Metaとの認可処理に失敗しました");
    }
    const { access_token: shortToken } = await shortRes.json();

    const longParams = new URLSearchParams({
      grant_type: "fb_exchange_token",
      client_id: META_APP_ID.value(),
      client_secret: META_APP_SECRET.value(),
      fb_exchange_token: shortToken,
    });
    const longRes = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token?${longParams.toString()}`);
    if (!longRes.ok) {
      console.error("instagram long-lived token exchange failed", await longRes.text());
      return res.status(502).send("Metaとの認可処理に失敗しました");
    }
    const { access_token: userToken } = await longRes.json();

    await integrationRef(storeId).set(
      {
        storeId,
        media: "instagram",
        userAccessToken: userToken,
        connectedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    res.set("Content-Type", "text/html; charset=utf-8");
    res.send(`<!doctype html><meta charset="utf-8">
      <p>Metaアカウントと連携しました。このタブは閉じて構いません。</p>
      <p>続けて、管理画面の「連携設定」で対象のInstagramアカウントを選択してください。</p>
      <script>window.opener && window.opener.postMessage({ type: 'kuchikomi-oauth', media: 'instagram', ok: true }, '*'); setTimeout(() => window.close(), 1500);</script>`);
  },
);

/**
 * callable: listInstagramAccounts()
 * 連携済みのFacebookページから、紐づいているInstagramビジネスアカウントの一覧を返す。
 */
const listInstagramAccounts = onCall({ region: REGION }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "ログインが必要です");
  const storeId = request.auth.token.storeId;
  const snap = await integrationRef(storeId).get();
  if (!snap.exists || !snap.data().userAccessToken) throw new HttpsError("failed-precondition", "Metaアカウントが未連携です");
  const userToken = snap.data().userAccessToken;

  const pagesRes = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/me/accounts?fields=id,name,access_token,instagram_business_account&access_token=${userToken}`,
  );
  if (!pagesRes.ok) throw new HttpsError("internal", "Facebookページ一覧の取得に失敗しました");
  const { data = [] } = await pagesRes.json();

  const accounts = data
    .filter((page) => page.instagram_business_account)
    .map((page) => ({
      pageId: page.id,
      pageName: page.name,
      igUserId: page.instagram_business_account.id,
    }));
  // ページアクセストークンはクライアントに返さず、サーバー側にのみ保持する
  return { accounts };
});

/**
 * callable: setInstagramAccount({ pageId })
 * 連携設定画面で選んだFacebookページ（とそれに紐づくInstagramアカウント）を保存する。
 * ページアクセストークンは再取得してサーバー側にのみ保持する。
 */
const setInstagramAccount = onCall({ region: REGION }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "ログインが必要です");
  const storeId = request.auth.token.storeId;
  const { pageId } = request.data || {};
  if (!pageId) throw new HttpsError("invalid-argument", "pageId が必要です");

  const snap = await integrationRef(storeId).get();
  if (!snap.exists || !snap.data().userAccessToken) throw new HttpsError("failed-precondition", "Metaアカウントが未連携です");
  const pagesRes = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/me/accounts?fields=id,name,access_token,instagram_business_account&access_token=${snap.data().userAccessToken}`,
  );
  const { data = [] } = await pagesRes.json();
  const page = data.find((p) => p.id === pageId);
  if (!page || !page.instagram_business_account) throw new HttpsError("not-found", "指定されたページにInstagramアカウントが見つかりません");

  await integrationRef(storeId).set(
    {
      pageId: page.id,
      pageName: page.name,
      pageAccessToken: page.access_token,
      igUserId: page.instagram_business_account.id,
    },
    { merge: true },
  );
  return { ok: true };
});

async function upsertReview({ storeId, storeName, externalId, author, text, createTime }) {
  const existing = await db
    .collection("reviews")
    .where("storeId", "==", storeId)
    .where("media", "==", "instagram")
    .where("externalId", "==", externalId)
    .limit(1)
    .get();
  if (!existing.empty) return false;

  await db.collection("reviews").add({
    storeId,
    store: storeName,
    media: "instagram",
    externalId,
    author,
    rating: null,
    lang: "ja",
    text,
    reply: "",
    replyJa: "",
    status: "new",
    date: createTime || new Date().toISOString(),
    log: [`${now()}　Instagram Graph API から取得`],
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return true;
}

async function syncOneStore(storeId, igUserId, pageAccessToken) {
  if (!igUserId || !pageAccessToken) return; // アカウント未選択の店舗はスキップ
  const storeSnap = await db.collection("stores").doc(storeId).get();
  const storeName = storeSnap.exists ? storeSnap.data().name : storeId;

  const mediaRes = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${igUserId}/media?fields=id,timestamp&limit=10&access_token=${pageAccessToken}`,
  );
  if (!mediaRes.ok) throw new Error(`media fetch failed: ${await mediaRes.text()}`);
  const { data: mediaList = [] } = await mediaRes.json();

  for (const media of mediaList) {
    const commentsRes = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${media.id}/comments?fields=id,text,username,timestamp&access_token=${pageAccessToken}`,
    );
    if (!commentsRes.ok) continue;
    const { data: comments = [] } = await commentsRes.json();
    for (const c of comments) {
      await upsertReview({
        storeId,
        storeName,
        externalId: c.id,
        author: `@${c.username}`,
        text: c.text,
        createTime: c.timestamp,
      });
    }
  }
}

/**
 * スケジュール実行: 15分おきに連携済みの全店舗の最新投稿のコメントを取得し、Firestoreに反映する。
 */
const syncInstagramComments = onSchedule({ schedule: "every 15 minutes", region: REGION }, async () => {
  const integrations = await db.collection("integrations").where("media", "==", "instagram").get();
  for (const doc of integrations.docs) {
    const { storeId, igUserId, pageAccessToken } = doc.data();
    try {
      await syncOneStore(storeId, igUserId, pageAccessToken);
    } catch (err) {
      console.error(`syncInstagramComments: error for store ${storeId}`, err);
    }
  }
});

/**
 * callable: syncInstagramCommentsNow()
 * 「新着を取得」ボタンから、自分の店舗分だけ即時に同期する。
 */
const syncInstagramCommentsNow = onCall({ region: REGION }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "ログインが必要です");
  const storeId = request.auth.token.storeId;
  const snap = await integrationRef(storeId).get();
  if (!snap.exists || !snap.data().igUserId) throw new HttpsError("failed-precondition", "この店舗はInstagramと連携されていません");
  try {
    await syncOneStore(storeId, snap.data().igUserId, snap.data().pageAccessToken);
  } catch (err) {
    console.error(`syncInstagramCommentsNow: error for store ${storeId}`, err);
    throw new HttpsError("internal", "Instagramコメントの取得に失敗しました");
  }
  return { ok: true };
});

/**
 * callable: postInstagramReply({ reviewId })
 * Firestoreに保存されている承認済み返信文を、Instagramのコメントへの返信として投稿する。
 */
const postInstagramReply = onCall({ region: REGION }, async (request) => {
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
  if (!integSnap.exists || !integSnap.data().pageAccessToken) {
    throw new HttpsError("failed-precondition", "この店舗はInstagramと連携されていません");
  }

  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${review.externalId}/replies`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      message: review.reply,
      access_token: integSnap.data().pageAccessToken,
    }),
  });
  if (!res.ok) {
    console.error("postInstagramReply failed", await res.text());
    throw new HttpsError("internal", "Instagramへの返信投稿に失敗しました");
  }

  await ref.update({
    status: "sent",
    log: FieldValue.arrayUnion(`${now()}　Instagram Graph API で返信を投稿`),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return { ok: true };
});

module.exports = {
  createInstagramConnectUrl,
  instagramOAuthCallback,
  listInstagramAccounts,
  setInstagramAccount,
  syncInstagramComments,
  syncInstagramCommentsNow,
  postInstagramReply,
};
