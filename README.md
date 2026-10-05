# 口コミ一元管理_返信文自動生成（中央観光株式会社）

Google・Instagram・食べログ・トリップアドバイザーの口コミを1か所で確認し、AIが過去の返信の文体に合わせて返信文を下書きするデモアプリです。対象店舗：山麓園／浅間茶屋。

- 表示されている口コミ・返信内容はすべて架空のサンプルです。
- ログインはデモ用の簡易認証（ID／パスワードのハッシュ照合）で、本番運用にはサーバー側の認証基盤への置き換えが必要です。
- AIによる返信下書きは、AI連携が利用できない環境では定型文にフォールバックします。

## 構成

- `public/index.html` — アプリ本体（単一HTML・ビルド不要の静的サイト）
- `public/firebase-init.js` — Firebase SDK（Analytics）の初期化
- `extension/tabelog/` — 食べログ 口コミ返信アシスタント（Chrome拡張機能。新着の確認・AIでの返信文作成・返信欄への下書き入力。使い方は同フォルダの README.md）
- `firebase.json` / `.firebaserc` — Firebase Hosting の設定
- `.github/workflows/firebase-hosting-merge.yml` — `main` ブランチへのマージ時に自動デプロイするGitHub Actions

## Firebase Hosting へのデプロイ（初回セットアップ）

このセッションにはFirebaseへの認証情報がないため、実際のデプロイはご自身の環境で行ってください。

1. Firebase CLI にログイン
   ```bash
   npx firebase-tools login
   ```
2. 希望のURL名（`chuo-kanko-kuchikomi-ichigen-kanri`）でHosting siteを作成（初回のみ・世界で一意な名前である必要があります）
   ```bash
   npx firebase-tools hosting:sites:create chuo-kanko-kuchikomi-ichigen-kanri --project chuo-kanko
   ```
3. デプロイ
   ```bash
   npx firebase-tools deploy --only hosting --project chuo-kanko
   ```
4. デプロイ後のURL
   - `https://chuo-kanko-kuchikomi-ichigen-kanri.web.app`
   - `https://chuo-kanko-kuchikomi-ichigen-kanri.firebaseapp.com`

### GitHub Actionsでの自動デプロイ（任意）

`main` ブランチへのマージ時に自動デプロイしたい場合は、Firebaseのサービスアカウントキーを発行し、GitHubリポジトリのSecretsに `FIREBASE_SERVICE_ACCOUNT_CHUO_KANKO` として登録してください。

```bash
npx firebase-tools init hosting:github
```
