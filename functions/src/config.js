const { defineSecret, defineString } = require("firebase-functions/params");

// Meta for Developers（developers.facebook.com）で作成したアプリの情報。
const INSTAGRAM_APP_ID = defineSecret("INSTAGRAM_APP_ID");
const INSTAGRAM_APP_SECRET = defineSecret("INSTAGRAM_APP_SECRET");

// Google Cloud Console（console.cloud.google.com）で作成したOAuthクライアントの情報。
const GOOGLE_CLIENT_ID = defineSecret("GOOGLE_CLIENT_ID");
const GOOGLE_CLIENT_SECRET = defineSecret("GOOGLE_CLIENT_SECRET");

// console.anthropic.com で発行するAPIキー（AIによる返信下書き生成に使用）。
const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");

// アプリの公開URL（OAuth連携完了後にリダイレクトする先）。
const APP_URL = defineString("APP_URL", {
  default: "https://chuo-kanko-kuchikomi-ichigen-kanri.web.app",
});

const REGION = "asia-northeast1";
const GRAPH_API_VERSION = "v21.0";
const STORES = ["山麓園", "浅間茶屋"];

module.exports = {
  INSTAGRAM_APP_ID,
  INSTAGRAM_APP_SECRET,
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  ANTHROPIC_API_KEY,
  APP_URL,
  REGION,
  GRAPH_API_VERSION,
  STORES,
};
