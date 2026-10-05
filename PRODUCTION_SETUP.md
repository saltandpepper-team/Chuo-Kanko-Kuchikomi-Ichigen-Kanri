# 本番運用セットアップ手順

このドキュメントは、口コミ一元管理アプリをデモから本番運用に切り替えるために**人の手で行う必要がある**設定をまとめたものです。コード側（Firestore・Cloud Functions・ログイン・画面）はすでに実装済みですが、以下はこの開発環境（認証情報を持たないセッション）では完結できないため、Firebaseプロジェクトの管理者が実施してください。

## 0. 全体像

- データ保存・共同編集: **Firestore**（口コミ・返信・ステータスを保存。どの端末からでも同じデータを見る・編集できる）
- ログイン: **Firebase Authentication**（店舗ごとのメール/パスワードアカウント）
- AI下書き: **Cloud Functions → Anthropic API（Claude）**
- Google/Instagramの自動取得・自動返信: **Cloud Functions → Google Business Profile API / Instagram Graph API**（OAuth連携が必要）
- 食べログ／トリップアドバイザー: 公式APIが無いため、**AIが下書きしたテキストをコピーして管理画面に貼り付ける**手動アシスト方式（自動ログイン・自動投稿は行わない。スクレイピングは規約違反のリスクが高いため非推奨）

## 1. Firebaseプロジェクトの準備

1. [Firebase Console](https://console.firebase.google.com/) で `chuo-kanko` プロジェクトを開く。
2. **Blazeプラン（従量課金）にアップグレード**する。Cloud Functionsの外部ネットワーク呼び出し（Anthropic API・Google/Meta API）とスケジュール実行にはBlazeプランが必須です。
3. **Firestore Database** を有効化する（本番モード、リージョンは `asia-northeast1` 推奨）。
4. **Authentication** を有効化し、サインイン方法で「メール/パスワード」を有効にする。
5. Firebase CLIにログインし、プロジェクトルートで以下を実行してルール・インデックス・関数をデプロイする。

   ```bash
   npm --prefix functions install
   npx firebase-tools deploy --only firestore:rules,firestore:indexes,functions --project chuo-kanko
   ```

   初回デプロイ後、`functions` の実際のURL（例: `https://asia-northeast1-chuo-kanko.cloudfunctions.net/googleOAuthCallback`）をメモしておく。`functions/lib/google.js` と `functions/lib/instagram.js` の `googleOAuthRedirectUri()` / `instagramOAuthRedirectUri()` はこの形式を前提にしているため、実際のURLと食い違う場合はコードを合わせて修正すること。

## 2. シークレットの登録

Cloud Functionsが参照するシークレットをSecret Manager経由で登録する。

```bash
npx firebase-tools functions:secrets:set ANTHROPIC_API_KEY --project chuo-kanko
npx firebase-tools functions:secrets:set GOOGLE_OAUTH_CLIENT_ID --project chuo-kanko
npx firebase-tools functions:secrets:set GOOGLE_OAUTH_CLIENT_SECRET --project chuo-kanko
npx firebase-tools functions:secrets:set META_APP_ID --project chuo-kanko
npx firebase-tools functions:secrets:set META_APP_SECRET --project chuo-kanko
```

- `ANTHROPIC_API_KEY`: [Anthropic Console](https://console.anthropic.com/) で発行するAPIキー。
- `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET`: 手順3で作成するOAuthクライアントの値。
- `META_APP_ID` / `META_APP_SECRET`: 手順4で作成するMetaアプリの値。

外部連携（Google/Instagram）をまだ使わない場合は、`ANTHROPIC_API_KEY` だけ設定すれば口コミの共有・AI下書き機能は動作します（Google/Instagramの自動取得・自動投稿機能だけが未設定のまま動きません）。

## 3. Google Business Profile API 連携（任意・審査が必要）

1. [Google Cloud Console](https://console.cloud.google.com/) で `chuo-kanko` プロジェクトを開く。
2. 「APIとサービス」→「認証情報」でOAuth 2.0 クライアントID（ウェブアプリケーション）を作成する。
   - 承認済みのリダイレクトURI に `https://asia-northeast1-chuo-kanko.cloudfunctions.net/googleOAuthCallback` を追加する。
3. OAuth同意画面を設定する（スコープ: `https://www.googleapis.com/auth/business.manage`）。
4. **Google Business Profile APIの利用申請**を行う。このAPIは一般公開APIではなく、Googleへの申請・審査が必要です（数日〜数週間かかる場合があります）。申請フォーム: https://support.google.com/business/contact/api_default
5. 承認後、クライアントID/シークレットを手順2のSecret Managerに登録する。
6. アプリの管理画面（ログイン後の「連携設定」）から「連携する」→ ロケーションを選択、の順で店舗とGoogleビジネスプロフィールを紐付ける。

> 注意: `mybusiness.googleapis.com/v4` のレビュー取得・返信APIはGoogle側で見直しが入ることがあります。本番投入前に `functions/lib/google.js` のコメントと最新のAPIリファレンスを必ず照合してください。

## 4. Instagram Graph API 連携（任意・審査が必要）

1. [Meta for Developers](https://developers.facebook.com/) でアプリを作成する（種類: ビジネス）。
2. 対象の Facebook ページに Instagram ビジネス/クリエイターアカウントを連携しておく（前提条件）。
3. 「Facebookログイン」プロダクトを追加し、有効なOAuthリダイレクトURIに `https://asia-northeast1-chuo-kanko.cloudfunctions.net/instagramOAuthCallback` を追加する。
4. 以下の権限についてアプリレビュー（App Review）を申請する: `instagram_basic` / `instagram_manage_comments` / `pages_show_list` / `pages_read_engagement`。審査が通るまでは開発者自身が管理者登録したテストアカウントでのみ動作します。
5. 承認後、アプリID/シークレットを手順2のSecret Managerに登録する。
6. アプリの管理画面の「連携設定」から「連携する」→ 対象のFacebookページ（Instagramアカウント）を選択、の順で設定する。

## 5. 店舗アカウントの発行

1. Firebase Consoleの「プロジェクトの設定」→「サービスアカウント」からサービスアカウントキー（JSON）をダウンロードする。
2. `scripts/store-accounts.example.json` を `scripts/store-accounts.json` にコピーし、各店舗の実際のメールアドレス・パスワードを設定する（このファイルはgit管理対象外）。
3. 以下を実行する。

   ```bash
   npm --prefix scripts install
   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json node scripts/provision-store-users.js
   ```

4. 発行したメールアドレス・パスワードを各店舗のスタッフに共有する（ログイン画面の「ID（メールアドレス）」欄に入力）。

## 6. 動作確認チェックリスト

- [ ] Firestore・Authenticationが有効化されている
- [ ] `firestore:rules` / `functions` がデプロイ済み
- [ ] `ANTHROPIC_API_KEY` が設定され、口コミを選んで「AIで下書き」が動作する
- [ ] 店舗アカウントでログインでき、別のブラウザ/別の人のログインでも同じ口コミ・返信内容が見える（Firestoreでの共有を確認）
- [ ] （Google連携を使う場合）連携設定でGoogleアカウントと接続し、ロケーションを選択できる。「新着を取得」でGoogleのレビューが反映される
- [ ] （Instagram連携を使う場合）同様にFacebookページ・Instagramアカウントを選択できる
- [ ] 食べログ・トリップアドバイザーの口コミを手動登録フォームから追加できる
- [ ] Firebase Hosting へのデプロイ（`npx firebase-tools deploy --only hosting --project chuo-kanko`、または `main` マージ時のGitHub Actions）

## 7. このセッションでは検証できていないこと

開発コンテナにFirebase/Google/Meta/Anthropicの認証情報がないため、以下はコードレベルで実装していますが実際の疎通確認ができていません。認証情報が揃い次第、必ず一度ご自身の環境でテストしてください。

- Google Business Profile APIでの実際のレビュー取得・返信投稿
- Instagram Graph APIでの実際のコメント取得・返信投稿
- Claude API呼び出し（ロジックは標準的なAnthropic SDKの使い方に沿っていますが、実キーでの動作確認はできていません）
- Firebase Authenticationでの本物のログインフロー一式
