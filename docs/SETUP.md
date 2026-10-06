# 本番環境のセットアップ（Google・Instagram の公式API連携）

本番（`https://chuo-kanko-kuchikomi-ichigen-kanri.web.app`）では、アプリは次のように動きます。

- ログインは **Firebase Authentication**（メールアドレス＋パスワード）。許可したメールアドレスだけが使えます。
- Google・Instagram は、萱沼様が各社の画面で **「許可」を押すだけ** で連携します（OAuth）。**各媒体のパスワードはアプリに入力しません。**
- 連携トークン・APIキーは **サーバー（Cloud Functions）と Firestore にだけ** 保存され、ブラウザには渡りません。
- AIの返信文・口コミの翻訳は、アプリの中で **Firebase AI Logic（Gemini）** が作成します（`public/ai.js`）。OpenAIは使いません。APIキーの入力も不要です。
- 本番ではデモ用のサンプル口コミは表示されません。
- 食べログ・トリップアドバイザーは Chrome 拡張機能（`extension/tabelog/`）で扱います。

> この本番モードは、上記のURL（`*.web.app` / `*.firebaseapp.com`）で開いたときだけ有効です。それ以外（ファイルを直接開く・claude.ai の公開版）では、これまでどおりのデモとして動きます。

---

## 1. Firebase（プロジェクト `chuo-kanko`）

1. Firebase コンソールで料金プランを **Blaze（従量課金）** にします（Cloud Functions に必要）。
2. **Authentication** →「始める」→ ログイン方法で **メール/パスワード** を有効にします。
3. **Authentication → ユーザー → ユーザーを追加** で、萱沼様のログイン用アカウント（例：`kayanuma.h@kaneyamaen.co.jp`）を作成します。パスワードは新しく決めてください。
4. **Firestore Database** を作成します（ロケーション：`asia-northeast1`、本番モード）。

## 2. Google ビジネスプロフィール API

Google Cloud コンソール（プロジェクト `chuo-kanko`）で行います。

1. **API の利用申請**：Google ビジネスプロフィール API は申請・承認制です。[利用申請フォーム](https://developers.google.com/my-business/content/prereqs) から申請してください（承認まで数日〜数週間）。
2. **API を有効化**：「APIとサービス」→「ライブラリ」で次の3つを有効にします。
   - My Business Account Management API
   - My Business Business Information API
   - Google My Business API（口コミの取得・返信）
3. **OAuth 同意画面**：
   - ユーザーの種類：外部
   - スコープ：`https://www.googleapis.com/auth/business.manage`
   - **公開ステータスを「本番環境」にしてください。**「テスト」のままだと、連携が7日ごとに切れます。
4. **OAuth クライアント ID**（種類：ウェブアプリケーション）を作成します。
   - 承認済みのリダイレクト URI：`https://chuo-kanko-kuchikomi-ichigen-kanri.firebaseapp.com/api/google/callback`
   - 作成後の「クライアント ID」と「クライアント シークレット」を控えます。

## 3. Instagram（Meta for Developers）

前提：Instagram アカウントが **ビジネス（またはクリエイター）アカウント** で、**Facebook ページに紐づいている** こと。

1. [Meta for Developers](https://developers.facebook.com/) でアプリを作成します（種類：ビジネス）。
2. 「Facebookログイン」を追加し、有効な OAuth リダイレクト URI に次を登録します。
   `https://chuo-kanko-kuchikomi-ichigen-kanri.firebaseapp.com/api/instagram/callback`
3. 使う権限：`instagram_basic`、`instagram_manage_comments`、`pages_show_list`、`pages_read_engagement`、`business_management`
   - アプリが「開発モード」の間は、アプリの **管理者・テスター** に登録したアカウントだけが連携できます。萱沼様のFacebookアカウントを管理者かテスターに追加してください。
   - 他のアカウントでも使う場合は、アプリレビュー（権限の審査）とビジネス認証が必要です。
4. 「アプリID」と「app secret」を控えます。

## 4. AI（Firebase AI Logic／Gemini）

返信文の作成と口コミの翻訳に使います。**本番で使う前に、次の設定が必要です（Google・Instagram の連携とは関係なく、今すぐ必要です）。**

1. Firebase コンソール（プロジェクト `chuo-kanko`）→ 左メニュー「AI Logic」→「始める」を押します。
2. API の提供元は **「Gemini Developer API」** を選びます（無料枠あり。Spark プランのままでも使えます）。
3. 画面の案内どおりに進めると、必要な API が有効になります。アプリ側のコードの変更は不要です。
4. （推奨）第三者にAIを使われないよう、**App Check**（reCAPTCHA Enterprise）を設定します。

- 使うモデルは `public/ai.js` の `MODELS` です（先頭から順に試し、提供終了などで使えないモデルは飛ばします）。
- 無料枠の上限を超えると、作成が一時的に止まります（アプリは1分待って再試行します）。件数が多い場合は、AI Logic の設定で従量課金（Blaze）にします。
- 無料枠では、送った内容（公開済みの口コミ本文）が Google のサービス改善に使われる場合があります。気になる場合は従量課金にしてください。

## 5. 設定値の登録とデプロイ

> **最初に次の2か所を変更してください**（サーバーの準備ができるまでは、本番URLでもデモと同じ簡易ログインで動くようにしてあります）。
> - `public/index.html` の `const BACKEND_ENABLED = false;` を `true` に変更
> - `firebase.json` の `hosting.rewrites` の先頭に次を追加
>   ```json
>   { "source": "/api/**", "function": { "functionId": "api", "region": "asia-northeast1" } }
>   ```


開発用PCで Firebase CLI を使います。

```bash
npm install -g firebase-tools
firebase login

# 公開してよい設定値（functions/.env）
cp functions/.env.example functions/.env
#   → functions/.env を編集（GOOGLE_CLIENT_ID / META_APP_ID / ALLOWED_EMAILS）

# 秘密の値（Secret Manager に保存。コマンド実行後に値を貼り付け）
firebase functions:secrets:set GOOGLE_CLIENT_SECRET
firebase functions:secrets:set META_APP_SECRET

# デプロイ
(cd functions && npm ci)
firebase deploy --only functions,firestore:rules,hosting --project chuo-kanko
```

> `main` ブランチへのマージ時に GitHub Actions が Hosting だけを自動デプロイします。**Hosting の設定が `api` 関数を参照しているため、最初に必ず上記のコマンドで Functions をデプロイしてから** `main` にマージしてください。

## 6. 連携の手順（萱沼様）

1. `https://chuo-kanko-kuchikomi-ichigen-kanri.web.app` を開き、手順1で作成したアカウントでログインします。
2. ヘッダーの歯車（API接続設定）を開き、店舗（山麓園／浅間茶屋）を選びます。
3. **「Googleと連携する」** を押します。Googleビジネスプロフィールを管理している Google アカウントでログインし、「許可」を押します。
4. **「Instagramと連携する」** を押します。Facebook でログインし、対象のページと Instagram アカウントを選んで「許可」を押します。
5. 複数の店舗（ロケーション／アカウント）がある場合は、その店舗として使うものを選びます。
6. 連携が終わると、口コミ・コメントが自動で取得されます。以降は「新着を取得」で最新を取得し、内容を確認して「承認して送信」を押すと各媒体に返信が投稿されます。

## 現時点の制限

- **作業状態の保存**：AIの下書き・承認待ちなどの状態はサーバーに保存していません。ページを再読み込みすると、Google・Instagram の口コミは取得し直します（返信済みかどうかは各媒体から取得します）。食べログの取り込み分は再読み込みで消えます。
- **Instagram の取得範囲**：直近10投稿のコメントが対象です。
- **食べログ・トリップアドバイザー**：Chrome 拡張機能で連携しています（`extension/tabelog/README.md`）。
- サーバーの `/api/ai/generate`（OpenAI）は使っていません（AIはアプリ内の Firebase AI Logic を使います）。

## 開発者向け

- バックエンドのテスト：`cd functions && npm test`（Google・Meta・OpenAI・Firestore はすべてモック）
- バックエンドの構成：`functions/app.js`（API本体）、`functions/index.js`（Firebase への接続・設定値）
- Firestore のルールは全面拒否（`firestore.rules`）。データはサーバーからのみ読み書きします。
