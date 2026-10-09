# 本番セットアップ手順

このドキュメントは、デモ画面（サンプルの口コミのみ）から実際にGoogle・Instagram（・将来的に食べログ／トリップアドバイザー）と連携した本番運用に切り替えるための手順です。

## 全体構成

- **フロントエンド**：`public/` 以下の静的サイト（Firebase Hosting）。ビルド不要。
- **バックエンド**：`functions/` の Cloud Functions（関数名 `api`）。`https://<公開URL>/api/*` にHosting経由でルーティングされます。
- **認証**：Firebase Authentication（メール／パスワード）。ログインしたアカウントが `staff` コレクションに登録されていることをCloud Functionsが確認します。
- **口コミデータ**：Firestoreには保存しません。「新着を取得」を押すたびに、Cloud Functionsが都度Google／InstagramのAPIから取得します（pull型）。
- **連携情報（アクセストークン等）**：Firestoreの `integrations` コレクションに保存しますが、セキュリティルールでクライアントからのアクセスを全面的に禁止しており、Cloud Functions（Admin SDK）だけが読み書きできます。

## 0. 前提

```bash
npm install -g firebase-tools   # 未インストールの場合
firebase login
cd functions && npm install
cd ../scripts && npm install
```

このリポジトリは既存のFirebaseプロジェクト `chuo-kanko` に紐づいています（`.firebaserc`）。

## 1. スタッフアカウントを作成する

ログインできるのは `staff` コレクションに登録されたFirebase Authユーザーだけです。店舗ごとではなく、中央観光株式会社のスタッフ（複数店舗を横断して見る人）としてアカウントを発行します。

1. Firebaseコンソール → プロジェクトの設定 → サービスアカウント → 「新しい秘密鍵の生成」でJSONキーをダウンロード
2. ローカルで実行：

```bash
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccountKey.json
cd scripts
node addStaff.js owner@example.com "強いパスワード" "担当者名"
```

必要な人数分くり返します。ログイン後、画面右上の店舗セレクタで「山麓園」「浅間茶屋」を切り替えられます。

## 2. Instagram連携（Meta for Developers）

1. [developers.facebook.com](https://developers.facebook.com/) でアプリを作成（種類：ビジネス）
2. 製品に **Instagram Graph API** を追加
3. 「Facebookログイン」の設定で、有効なOAuthリダイレクトURIに以下を追加：
   ```
   https://chuo-kanko-kuchikomi-ichigen-kanri.web.app/api/instagram/callback
   ```
4. 必要な権限（アプリの役割がテスターの間は審査不要、本番公開には**App Review**が必要）：
   - `instagram_basic`
   - `instagram_manage_comments`
   - `pages_show_list`
   - `pages_read_engagement`
5. 連携したいInstagramアカウントは、あらかじめ「プロアカウント（ビジネス/クリエイター）」にし、Facebookページにリンクしておく
6. アプリ設定から **アプリID** と **App Secret** を控える

> テスト段階では、Meta Developersの「役割」にテスター／管理者として追加したアカウントのみ連携できます。他店舗の一般アカウントで使うには、Metaの審査（App Review）を通過させる必要があります。審査には数日〜数週間かかることがあります。

## 3. Google連携（Google Business Profile API）

1. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクトを作成（または既存のものを使用）
2. 「APIとサービス」→「認証情報」→ OAuthクライアントID（ウェブアプリケーション）を作成
   - 承認済みのリダイレクトURI：
     ```
     https://chuo-kanko-kuchikomi-ichigen-kanri.web.app/api/google/callback
     ```
3. OAuth同意画面を設定（スコープ：`https://www.googleapis.com/auth/business.manage`）
4. **Business Profile API（旧 Google My Business API）を有効化**
   - ⚠️ このAPIは申請制です。Googleの[アクセスリクエストフォーム](https://developers.google.com/my-business/content/prereqs)から利用申請を行い、承認を待つ必要があります（新規プロジェクトでは数日〜数週間かかることがあります）
5. クライアントIDとクライアントシークレットを控える

## 4. シークレットの設定

```bash
cd functions
firebase functions:secrets:set INSTAGRAM_APP_ID
firebase functions:secrets:set INSTAGRAM_APP_SECRET
firebase functions:secrets:set GOOGLE_CLIENT_ID
firebase functions:secrets:set GOOGLE_CLIENT_SECRET
firebase functions:secrets:set ANTHROPIC_API_KEY   # console.anthropic.com で発行
```

それぞれ実行するとプロンプトで値の入力を求められます。

## 5. デプロイ

```bash
firebase deploy --only functions,firestore,hosting
```

## 6. 本番モードを有効にする

`public/index.html` 内の次の行を `true` に変更してコミット・デプロイします。

```js
const BACKEND_ENABLED = true;
```

これにより、Firebase Hostingの公開URL（`chuo-kanko-kuchikomi-ichigen-kanri.web.app` / `.firebaseapp.com`）で開いたときだけ、デモ用サンプルの代わりにFirebaseログイン・サーバー連携モードになります（それ以外のホスト名、例えばローカルプレビューではデモのままです）。

## 7. 動作確認

1. ログイン画面でスタッフアカウントでログイン
2. 画面右上の歯車アイコン「API接続設定」を開く
3. 店舗タブを選び、「Instagramと連携する」または「Googleと連携する」を押す
4. 各社の画面で許可すると、このアプリに戻ってきます
   - 連携先の候補（Facebookページ／Googleのロケーション）が複数ある場合は、選択画面が表示されます
5. 「新着を取得」を押して、実際の口コミ／コメントが表示されることを確認
6. 下書きを作成し、内容を確認して承認 → 実際にGoogle/Instagram側に返信が投稿されます

## 8. 食べログ・トリップアドバイザーについて

この2媒体には口コミ返信用の公式APIが公開されていません。このリポジトリのWebアプリ側は、ブラウザ拡張機能と連携する前提の受け口（`window.postMessage`）をすでに実装していますが、**拡張機能自体はこのリポジトリに含まれていません**。別途開発が必要です。

拡張機能側が実装すべきメッセージ契約（`public/index.html` 内の該当箇所を参照）：

- ページ → 拡張機能
  - `{source:'kuchikomi-app', type:'hello'}`：拡張機能が入っているか確認するための呼びかけ
  - `{source:'kuchikomi-app', type:'setDraft', key, reply}`：承認された返信文を、対象の口コミの返信欄に自動入力してほしいという指示
- 拡張機能 → ページ（`window.postMessage` で送信、`source:'tabelog-assistant'`）
  - `{type:'ready'}`：拡張機能が有効であることの通知
  - `{type:'reviews', reviews:[{key, media:'tabelog'|'tripadvisor', store, author, rating, date, text, title, pageUrl, replied, reply, draft, firstSeenAt}]}`：店舗管理画面から読み取った口コミ一覧

拡張機能は、食べログ・トリップアドバイザーの店舗管理画面（ログイン済みのブラウザ）の中で動作し、画面に表示されている口コミを読み取ってこのアプリに知らせ、承認された返信文を返信欄に入力する、という役割分担を想定しています（送信ボタンは必ず人が押す設計）。

## セキュリティ上の注意

- `integrations` コレクション（アクセストークンを含む）と `oauthStates` コレクションは、Firestoreセキュリティルールでクライアントからのアクセスを完全に禁止しています。Cloud Functions（Admin SDK）だけがアクセスできます。
- `staff` コレクションは、本人のドキュメントのみ読み取り可能（存在確認用）。書き込みはAdmin SDK経由（`scripts/addStaff.js`）のみです。
- Client SecretやAPIキーは、このリポジトリのコードやFirestoreのクライアント公開領域には一切保存されません。すべてCloud Functionsのシークレット（`firebase functions:secrets:set`）またはサーバー側Firestoreに保持されます。
