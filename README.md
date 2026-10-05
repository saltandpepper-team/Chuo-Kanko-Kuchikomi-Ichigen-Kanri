# 口コミ一元管理_返信文自動生成（中央観光）

Google・Instagram・食べログ・トリップアドバイザーの口コミを1か所で確認し、AIが過去の返信の文体に合わせて返信文を下書きする本番運用アプリです。対象店舗：山麓園／浅間茶屋。

- 口コミ・返信・ステータスはFirestoreに保存され、複数人・複数端末から常に最新の状態を閲覧・編集できます。
- ログインはFirebase Authentication（店舗ごとのメール/パスワードアカウント）です。
- AIによる返信下書きはCloud Functions経由でClaude（Anthropic API）を呼び出します。APIが利用できない場合は定型文にフォールバックします。
- Google・Instagramは公式APIと連携し、口コミ／コメントの自動取得と返信の自動投稿に対応します（要アカウント連携）。
- 食べログ・トリップアドバイザーは公式APIが無いため、口コミはスタッフが手動登録し、返信はAI下書きをコピーして管理画面に貼り付ける方式です（自動ログイン・自動投稿は行いません）。

**本番環境としてのセットアップ手順（Firebaseプロジェクトの有効化、APIキー登録、OAuth連携、店舗アカウント発行など）は [`PRODUCTION_SETUP.md`](./PRODUCTION_SETUP.md) を参照してください。**

## 構成

- `public/index.html` — アプリ本体（単一HTML。Firebase Authentication / Firestore / Cloud Functionsをモジュール経由で利用）
- `public/firebase-init.js` — Firebase SDK（App本体・Analytics）の初期化
- `functions/` — Cloud Functions（AI下書き、Google/Instagram連携、スケジュール同期）
- `firestore.rules` / `firestore.indexes.json` — Firestoreのセキュリティルール・インデックス定義
- `scripts/provision-store-users.js` — 店舗アカウント（Firebase Authentication）発行スクリプト
- `firebase.json` / `.firebaserc` — Firebase Hosting / Firestore / Functions の設定
- `.github/workflows/firebase-hosting-merge.yml` — `main` ブランチへのマージ時に自動デプロイするGitHub Actions
- `PRODUCTION_SETUP.md` — 本番運用に必要な手動セットアップ手順

## デプロイ

このセッションにはFirebase/Google/Meta/Anthropicの認証情報がないため、実際のセットアップ・デプロイ・動作確認はご自身の環境で行ってください。手順は [`PRODUCTION_SETUP.md`](./PRODUCTION_SETUP.md) にまとめています。

Hosting単体の再デプロイのみであれば以下で行えます。

```bash
npx firebase-tools deploy --only hosting --project chuo-kanko
```

Firestoreルール・Cloud Functionsを含めてデプロイする場合は以下を使用してください。

```bash
npm --prefix functions install
npx firebase-tools deploy --only firestore:rules,firestore:indexes,functions,hosting --project chuo-kanko
```

### GitHub Actionsでの自動デプロイ（Hosting）

`main` ブランチへのマージ時にHostingを自動デプロイする設定はすでに `.github/workflows/firebase-hosting-merge.yml` にあります。GitHubリポジトリのSecretsに `FIREBASE_SERVICE_ACCOUNT_CHUO_KANKO` を登録してください。

```bash
npx firebase-tools init hosting:github
```

Cloud Functions・Firestoreルールの自動デプロイは含まれていないため、更新時は上記コマンドで手動デプロイしてください。
