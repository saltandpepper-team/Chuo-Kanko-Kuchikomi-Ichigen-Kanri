const crypto = require("crypto");
const { db, FieldValue } = require("./admin");

const STATE_TTL_MS = 10 * 60 * 1000; // 10分

async function createState({ uid, store, media }) {
  const state = crypto.randomBytes(16).toString("hex");
  await db
    .collection("oauthStates")
    .doc(state)
    .set({ uid, store, media, createdAt: FieldValue.serverTimestamp() });
  return state;
}

/** 一度だけ使えるstateを検証して消費する。無効・期限切れならnullを返す。 */
async function consumeState(state) {
  if (!state) return null;
  const ref = db.collection("oauthStates").doc(String(state));
  const snap = await ref.get();
  if (!snap.exists) return null;
  const data = snap.data();
  await ref.delete();
  if (data.createdAt && Date.now() - data.createdAt.toMillis() > STATE_TTL_MS) return null;
  return data;
}

module.exports = { createState, consumeState };
