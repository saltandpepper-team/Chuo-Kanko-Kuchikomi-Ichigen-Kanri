// Firebase Cloud Functions のエントリーポイント
// 設定値・シークレットの登録方法は docs/SETUP.md を参照
const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret, defineString } = require('firebase-functions/params');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const crypto = require('crypto');
const { createApp } = require('./app');

initializeApp();
const fs = getFirestore();

const GOOGLE_CLIENT_SECRET = defineSecret('GOOGLE_CLIENT_SECRET');
const META_APP_SECRET = defineSecret('META_APP_SECRET');
const OPENAI_API_KEY = defineSecret('OPENAI_API_KEY');
const GOOGLE_CLIENT_ID = defineString('GOOGLE_CLIENT_ID');
const META_APP_ID = defineString('META_APP_ID');
const ALLOWED_EMAILS = defineString('ALLOWED_EMAILS', { description: '利用を許可するメールアドレス（カンマ区切り）' });
const PUBLIC_BASE_URL = defineString('PUBLIC_BASE_URL', { default: 'https://chuo-kanko-kuchikomi-ichigen-kanri.web.app' });
const OPENAI_MODEL = defineString('OPENAI_MODEL', { default: 'gpt-4o-mini' });
const OPENAI_MODEL_HIGH = defineString('OPENAI_MODEL_HIGH', { default: 'gpt-4o' });

const app = createApp({
  db: {
    get: async p => { const s = await fs.doc(p).get(); return s.exists ? s.data() : null; },
    set: async (p, v) => { await fs.doc(p).set(v); },
    del: async p => { await fs.doc(p).delete(); }
  },
  verifyIdToken: t => getAuth().verifyIdToken(t),
  fetch: (...a) => fetch(...a),
  randomId: () => crypto.randomBytes(24).toString('hex'),
  config: () => ({
    googleClientId: GOOGLE_CLIENT_ID.value(), googleClientSecret: GOOGLE_CLIENT_SECRET.value(),
    metaAppId: META_APP_ID.value(), metaAppSecret: META_APP_SECRET.value(),
    openaiApiKey: OPENAI_API_KEY.value(), openaiModel: OPENAI_MODEL.value(), openaiModelHigh: OPENAI_MODEL_HIGH.value(),
    allowedEmails: ALLOWED_EMAILS.value(), publicBaseUrl: PUBLIC_BASE_URL.value()
  })
});

exports.api = onRequest({
  region: 'asia-northeast1', timeoutSeconds: 120, memory: '256MiB', maxInstances: 3,
  secrets: [GOOGLE_CLIENT_SECRET, META_APP_SECRET, OPENAI_API_KEY]
}, app);
