// アプリ内のAI（Firebase AI Logic → Gemini）。OpenAIは使わず、APIキーの入力も不要。
// Agent Platform Gemini API（旧Vertex AI）経由で呼び出す。利用料は他のFirebase/Cloudの請求に統合される
// （Gemini Developer API・AI Studio側の前払いクレジットとは別会計のため、そちらが切れても影響しない）。
// Google Cloud コンソールで「Vertex AI API」を有効にしておく必要がある。
// index.html からは window.appAI.generate(prompt, {onText}) で使う。
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAI, getGenerativeModel, AgentPlatformBackend } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-ai.js";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app-check.js";

// Firebase App Check（第三者にAIを使われないための仕組み）で使う reCAPTCHA Enterprise（Fraud Defense）のキーID。
// Firebase コンソールの App Check でこのアプリを登録したときのサイトキーを入れる（空なら App Check を使わない）
const RECAPTCHA_SITE_KEY = "6LeqTA8uAAAAAOGZtGHHUJXeQKyTBw0wRUeiprJO";

const firebaseConfig = {
  apiKey: "AIzaSyD_MPoBkHVdPDD2jz67iK-BGGsY93g4YuI",
  authDomain: "chuo-kanko.firebaseapp.com",
  projectId: "chuo-kanko",
  storageBucket: "chuo-kanko.firebasestorage.app",
  messagingSenderId: "5788029924",
  appId: "1:5788029924:web:3d79dc0e9428203e9fedf1",
};

// firebase-init.js（別バージョンのSDK）と干渉しないよう、名前付きの別アプリとして初期化する
const app = initializeApp(firebaseConfig, "ai");
if (RECAPTCHA_SITE_KEY) initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(RECAPTCHA_SITE_KEY), isTokenAutoRefreshEnabled: true });
const ai = getAI(app, { backend: new AgentPlatformBackend() });

// 先頭から順に試す。費用を抑えるため、一番安いFlash-Liteを最初に試し、使えない（提供終了・未提供）場合は
// 通常のFlashにフォールバックする。混雑で失敗したときはその回だけ次のモデルで試す
const MODELS = ["gemini-3.1-flash-lite", "gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.8-flash"];
let modelIndex = 0;
const unavailable = (e) => /not found|404|not supported|is not available|no longer available|unknown model/i.test(String(e?.message || e));
const busy = (e) => /high demand|overloaded|UNAVAILABLE|\b50[03]\b|try again later/i.test(String(e?.message || e));

async function generate(prompt, opts = {}) {
  let lastError;
  for (let i = modelIndex; i < MODELS.length; i++) {
    const model = getGenerativeModel(ai, { model: MODELS[i], generationConfig: { temperature: 0.7, maxOutputTokens: 2048 } });
    try {
      const result = await model.generateContentStream(prompt);
      let text = "";
      for await (const chunk of result.stream) {
        text += chunk.text();
        opts.onText?.({ text });
      }
      if (!text.trim()) throw new Error("AIからの応答が空でした");
      return { text, model: MODELS[i] };
    } catch (e) {
      lastError = e;
      if (unavailable(e)) { if (i === modelIndex) modelIndex = Math.min(i + 1, MODELS.length - 1); continue; }
      if (busy(e)) continue;
      throw e;
    }
  }
  throw lastError;
}

window.appAI = { generate };
window.dispatchEvent(new Event("app-ai-ready"));
