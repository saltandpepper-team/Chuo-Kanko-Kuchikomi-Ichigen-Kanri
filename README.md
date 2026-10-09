# 口コミ一元管理_返信文自動生成（中央観光株式会社）

Google・Instagram・食べログ・トリップアドバイザーの口コミを1か所で確認し、AIが過去の返信の文体に合わせて返信文を下書きするアプリです。対象店舗：山麓園／浅間茶屋。

- Firebase Hostingの公開URL以外（ローカルプレビュー等）で開いた場合は、サンプルの口コミによるデモ表示になります。
- 公開URLでは、Firebase Authenticationでログインしたスタッフが、Google・Instagramと実際に連携して口コミの取得・返信を行えます（本番モード）。本番モードを有効にする手順は [`docs/SETUP.md`](docs/SETUP.md) を参照してください。
- 食べログ・トリップアドバイザーは公式の返信用APIが無いため、ブラウザ拡張機能と連携する受け口のみ実装済みです（拡張機能自体は別途開発が必要。詳細は `docs/SETUP.md`）。
- AIによる返信下書きは、本番モードではCloud Functions経由でClaude APIを呼び出します。

## 構成

- `public/index.html` — アプリ本体（単一HTML・ビルド不要の静的サイト）
- `public/firebase-init.js` — Firebase SDK（Authentication / Analytics）の初期化、`window.appBackend` の提供
- `functions/` — Cloud Functions（`api`）。`/api/*` でHosting経由から呼び出されるバックエンド（Google・Instagram連携、AI下書き生成）
- `scripts/addStaff.js` — ログイン可能なスタッフアカウントを作成する管理用スクリプト
- `firebase.json` / `.firebaserc` / `firestore.rules` / `firestore.indexes.json` — Firebase Hosting・Functions・Firestore の設定
- `.github/workflows/firebase-hosting-merge.yml` — `main` ブランチへのマージ時に自動デプロイするGitHub Actions
- `docs/SETUP.md` — 本番連携（Instagram／Google／AI）の詳細なセットアップ手順

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
3. デプロイ（画面だけを更新する場合）
   ```bash
   npx firebase-tools deploy --only hosting --project chuo-kanko
   ```
   Google・Instagram連携などバックエンドも含めて本番運用する場合は、先に [`docs/SETUP.md`](docs/SETUP.md) のシークレット設定を行ってから
   ```bash
   npx firebase-tools deploy --only functions,firestore,hosting --project chuo-kanko
   ```
4. デプロイ後のURL
   - `https://chuo-kanko-kuchikomi-ichigen-kanri.web.app`
   - `https://chuo-kanko-kuchikomi-ichigen-kanri.firebaseapp.com`

### GitHub Actionsでの自動デプロイ（任意）

`main` ブランチへのマージ時に自動デプロイしたい場合は、Firebaseのサービスアカウントキーを発行し、GitHubリポジトリのSecretsに `FIREBASE_SERVICE_ACCOUNT_CHUO_KANKO` として登録してください。

```bash
npx firebase-tools init hosting:github
```
