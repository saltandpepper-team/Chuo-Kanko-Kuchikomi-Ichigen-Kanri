// アプリ内のAI（Firebase AI Logic → Gemini）。OpenAIは使わず、APIキーの入力も不要。
// Firebase コンソールの「AI Logic」で Gemini Developer API を有効にしておく必要がある。
// index.html からは window.appAI.generate(prompt, {onText}) で使う。
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAI, getGenerativeModel, GoogleAIBackend } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-ai.js";

const firebaseConfig = {
  apiKey: "AIzaSyD_MPoBkHVdPDD2jz67iK-BGGsY93g4YuI",
  authDomain: "chuo-kanko.firebaseapp.com",
  projectId: "chuo-kanko",
  storageBucket: "chuo-kanko.firebasestorage.app",
  messagingSenderId: "5788029924",
  appId: "1:5788029924:web:3d79dc0e9428203e9fedf1",
};

// firebase-init.js（別バージョンのSDK）と干渉しないよう、名前付きの別アプリとして初期化する
const ai = getAI(initializeApp(firebaseConfig, "ai"), { backend: new GoogleAIBackend() });

// 先頭から順に試し、使えないモデル（提供終了など）なら次へ
const MODELS = ["gemini-3.6-flash", "gemini-3.5-flash", "gemini-2.5-flash"];
let modelIndex = 0;
const unavailable = (e) => /not found|404|not supported|is not available|unknown model/i.test(String(e?.message || e));

async function generate(prompt, opts = {}) {
  for (;;) {
    const model = getGenerativeModel(ai, { model: MODELS[modelIndex], generationConfig: { temperature: 0.7 } });
    try {
      const result = await model.generateContentStream(prompt);
      let text = "";
      for await (const chunk of result.stream) {
        text += chunk.text();
        opts.onText?.({ text });
      }
      if (!text.trim()) throw new Error("AIからの応答が空でした");
      return { text, model: MODELS[modelIndex] };
    } catch (e) {
      if (unavailable(e) && modelIndex < MODELS.length - 1) { modelIndex++; continue; }
      throw e;
    }
  }
}

window.appAI = { generate };
window.dispatchEvent(new Event("app-ai-ready"));
