#!/usr/bin/env node
/**
 * 口コミ一元管理アプリのスタッフアカウントを作成する管理用スクリプト。
 *
 * 事前準備:
 *   1. Firebaseコンソール > プロジェクトの設定 > サービスアカウント からキーをダウンロードし、
 *      環境変数 GOOGLE_APPLICATION_CREDENTIALS にそのJSONファイルのパスを設定する。
 *   2. このディレクトリ（scripts/）で `npm install` を実行する。
 *
 * 使い方:
 *   node addStaff.js <メールアドレス> <パスワード> [表示名]
 */
const admin = require("firebase-admin");

const [, , email, password, displayName] = process.argv;
if (!email || !password) {
  console.error("使い方: node addStaff.js <メールアドレス> <パスワード> [表示名]");
  process.exit(1);
}

admin.initializeApp();

async function main() {
  let user;
  try {
    user = await admin.auth().getUserByEmail(email);
    console.log(`既存ユーザーが見つかりました（uid: ${user.uid}）。パスワードを更新します。`);
    await admin.auth().updateUser(user.uid, { password, displayName });
  } catch (e) {
    if (e.code !== "auth/user-not-found") throw e;
    user = await admin.auth().createUser({ email, password, displayName });
    console.log(`新しいユーザーを作成しました（uid: ${user.uid}）。`);
  }

  await admin.firestore().collection("staff").doc(user.uid).set({
    email,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  console.log(`staff/${user.uid} を作成しました。このアカウントでログインできます。`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
