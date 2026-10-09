const { db, FieldValue } = require("./admin");

const docId = (store, media) => `${store}_${media}`;

async function getIntegration(store, media) {
  const snap = await db.collection("integrations").doc(docId(store, media)).get();
  return snap.exists ? snap.data() : null;
}

/** 連携状態（画面の「API接続設定」モーダル用）。*/
function toStatus(integration) {
  if (!integration) return { connected: false };
  if (integration.status === "needs_pick") {
    return {
      connected: false,
      needsPick: true,
      candidates: (integration.candidates || []).map((c) => ({ id: c.id, label: c.label })),
    };
  }
  if (integration.status === "connected") {
    return { connected: true, label: integration.label };
  }
  return { connected: false };
}

async function setConnected(store, media, { uid, label, ...fields }) {
  await db
    .collection("integrations")
    .doc(docId(store, media))
    .set({
      store,
      media,
      status: "connected",
      label,
      ...fields,
      connectedBy: uid,
      connectedAt: FieldValue.serverTimestamp(),
    });
}

async function setNeedsPick(store, media, { uid, candidates }) {
  await db
    .collection("integrations")
    .doc(docId(store, media))
    .set({
      store,
      media,
      status: "needs_pick",
      candidates,
      connectedBy: uid,
      connectedAt: FieldValue.serverTimestamp(),
    });
}

async function disconnect(store, media) {
  await db.collection("integrations").doc(docId(store, media)).delete();
}

/** needs_pick状態の候補から1つを選び、連携済みにする。 */
async function pick(store, media, id) {
  const integration = await getIntegration(store, media);
  if (!integration || integration.status !== "needs_pick") {
    throw new Error("選択できる候補がありません。もう一度連携し直してください");
  }
  const chosen = (integration.candidates || []).find((c) => c.id === id);
  if (!chosen) throw new Error("指定された候補が見つかりません");
  const { label, ...fields } = chosen;
  await setConnected(store, media, { uid: integration.connectedBy, label, ...fields });
}

module.exports = { getIntegration, toStatus, setConnected, setNeedsPick, disconnect, pick };
