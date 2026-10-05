#!/usr/bin/env node
/**
 * 店舗アカウントの作成・更新スクリプト。
 *
 * 使い方:
 *   1. scripts/store-accounts.example.json を store-accounts.json にコピーし、
 *      実際のメールアドレス・パスワードを設定する（このファイルはgit管理しない）。
 *   2. Firebaseサービスアカウントキーを用意し、環境変数で指定する:
 *        export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
 *   3. 実行する:
 *        node scripts/provision-store-users.js
 *
 * 実行内容:
 *   - 各店舗についてFirebase Authenticationにメール/パスワードアカウントを作成（既存なら更新）
 *   - カスタムクレーム { storeId } を設定（Firestoreセキュリティルールがこれで店舗を判定する）
 *   - Firestore の stores/{storeId} ドキュメントを作成・更新する
 */
const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");

const configPath = path.join(__dirname, "store-accounts.json");
if (!fs.existsSync(configPath)) {
  console.error(
    `設定ファイルが見つかりません: ${configPath}\n` +
      "scripts/store-accounts.example.json をコピーして store-accounts.json を作成し、内容を書き換えてください。",
  );
  process.exit(1);
}
const { stores } = JSON.parse(fs.readFileSync(configPath, "utf8"));

admin.initializeApp({ credential: admin.credential.applicationDefault() });

async function upsertUser({ storeId, name, email, password }) {
  let user;
  try {
    user = await admin.auth().getUserByEmail(email);
    await admin.auth().updateUser(user.uid, { password });
    console.log(`既存アカウントを更新: ${email}`);
  } catch (err) {
    if (err.code !== "auth/user-not-found") throw err;
    user = await admin.auth().createUser({ email, password, displayName: name });
    console.log(`新規アカウントを作成: ${email}`);
  }
  await admin.auth().setCustomUserClaims(user.uid, { storeId });

  await admin
    .firestore()
    .collection("stores")
    .doc(storeId)
    .set({ name }, { merge: true });

  console.log(`  -> storeId=${storeId} を紐付けました（店舗名: ${name}）`);
}

(async () => {
  for (const store of stores) {
    if (!store.email || !store.password || store.password.includes("置き換えてください")) {
      console.warn(`store-accounts.json の ${store.storeId} はパスワード未設定のためスキップしました`);
      continue;
    }
    await upsertUser(store);
  }
  console.log("完了しました。店舗スタッフにメールアドレスとパスワードを共有してください。");
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
