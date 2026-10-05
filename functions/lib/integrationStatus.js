const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { db } = require("./admin");

const REGION = "asia-northeast1";

/**
 * callable: getIntegrationStatus()
 * 連携設定画面向けに、トークン等の機密情報を含まない接続状況だけを返す。
 * integrations/* はセキュリティルールでクライアントから直接読めないため、この関数経由で公開する。
 */
const getIntegrationStatus = onCall({ region: REGION }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "ログインが必要です");
  const storeId = request.auth.token.storeId;

  const [googleSnap, instagramSnap] = await Promise.all([
    db.collection("integrations").doc(`${storeId}_google`).get(),
    db.collection("integrations").doc(`${storeId}_instagram`).get(),
  ]);

  const google = googleSnap.exists
    ? { connected: true, locationSelected: Boolean(googleSnap.data().locationName) }
    : { connected: false, locationSelected: false };

  const instagram = instagramSnap.exists
    ? {
        connected: true,
        accountSelected: Boolean(instagramSnap.data().igUserId),
        pageName: instagramSnap.data().pageName || null,
      }
    : { connected: false, accountSelected: false, pageName: null };

  return { google, instagram };
});

module.exports = { getIntegrationStatus };
