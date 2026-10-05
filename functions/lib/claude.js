const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { FieldValue } = require("firebase-admin/firestore");
const Anthropic = require("@anthropic-ai/sdk");
const { db } = require("./admin");
const { buildPrompt, splitJa, fallbackDraft, DEFAULT_STYLE } = require("./prompt");

const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");

// 口コミ下書きは速度とコストを優先し、Haiku系の軽量モデルを使う。
// 文体のクオリティを重視したい場合は、デプロイ時に環境変数 DRAFT_MODEL で上書きできる。
const DRAFT_MODEL = process.env.DRAFT_MODEL || "claude-haiku-4-5-20251001";

function requireStoreAccess(auth, storeId) {
  if (!auth) {
    throw new HttpsError("unauthenticated", "ログインが必要です");
  }
  if (auth.token.storeId !== storeId) {
    throw new HttpsError("permission-denied", "他店舗のデータは操作できません");
  }
}

function now() {
  const d = new Date();
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * callable: draftReply({ reviewId })
 * 口コミ本文からAIが返信文の下書きを作成し、Firestoreに書き戻す。
 * Claude APIが利用できない場合は定型文にフォールバックする。
 */
const draftReply = onCall({ secrets: [ANTHROPIC_API_KEY], region: "asia-northeast1" }, async (request) => {
  const { reviewId } = request.data || {};
  if (!reviewId) throw new HttpsError("invalid-argument", "reviewId が必要です");

  const ref = db.collection("reviews").doc(reviewId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "口コミが見つかりません");
  const review = snap.data();

  requireStoreAccess(request.auth, review.storeId);

  const storeSnap = await db.collection("stores").doc(review.storeId).get();
  const styleSample = storeSnap.exists ? storeSnap.data().styleSample || DEFAULT_STYLE : DEFAULT_STYLE;

  let text;
  let logLine;
  try {
    const apiKey = ANTHROPIC_API_KEY.value();
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured");
    const client = new Anthropic({ apiKey });
    const res = await client.messages.create({
      model: DRAFT_MODEL,
      max_tokens: 1024,
      messages: [{ role: "user", content: buildPrompt(review, styleSample) }],
    });
    text = res.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();
    if (!text) throw new Error("empty response from Claude");
    logLine = `${now()}　AIが下書きを作成（過去の返信の文体を参照）`;
  } catch (err) {
    console.error("draftReply: falling back to template", err);
    text = fallbackDraft(review);
    logLine = `${now()}　定型の下書きを作成（AI接続なしのため）`;
  }

  const [body, ja] = splitJa(text);
  await ref.update({
    reply: body,
    replyJa: ja,
    status: review.status === "new" ? "draft" : review.status,
    log: FieldValue.arrayUnion(logLine),
    updatedAt: FieldValue.serverTimestamp(),
  });

  return { reply: body, replyJa: ja };
});

module.exports = { draftReply };
