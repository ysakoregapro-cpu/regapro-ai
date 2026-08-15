# Supabase Cloud Operations Runbook

Regapro AI を **Supabase Cloud** へ接続・運用するための短い手順です。Docker / ローカル Supabase は必須ではありません。

恒久的な `REGAPRO_DATA_MODE=supabase` 切替は、検証完了後に別途判断してください。デフォルトは `dev-sample` のままです。

## 1. 新 PC での接続

1. Node.js >= 24 を入れる
2. リポジトリを clone する
3. `npm install`（リポジトリルート）
4. Supabase CLI を入れる（`npx supabase` でも可）
5. `apps/web/.env.local` を作成（**Git にコミットしない**）

最低限の env 例:

```env
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable_or_anon_key>
SUPABASE_SECRET_KEY=<service_role_or_secret>   # サーバー専用。ブラウザに出さない
REGAPRO_DATA_MODE=dev-sample                   # 既定。一時検証時のみ supabase
# クライアントの空カタログ切替が必要な場合のみ:
# NEXT_PUBLIC_REGAPRO_DATA_MODE=supabase
```

秘密鍵・DB パスワード・`.env.local` は **決して Git に入れない**。

## 2. supabase login / link

```bash
npx supabase login
npx supabase link --project-ref <project-ref>
```

リンク後、Cloud プロジェクトに対して migration / types / verify を実行できます。

## 3. Migration 確認（破壊しない）

```bash
npx supabase migration list
```

ローカルと remote の適用状況を確認します。

```bash
npx supabase db push --dry-run
```

差分適用のプレビューのみ。問題なければ:

```bash
npx supabase db push
```

```bash
npx supabase db lint
```

## 4. 型・組織・接続検証

```bash
npm run db:gen-types
npm run db:bootstrap-org          # 既存データがある場合は冪等／安全確認を読んでから
npm run db:verify-live
npm run db:test-rls
```

- `db:verify-live` … 接続と組織スナップショットの読み取り確認
- `db:test-rls` … 認証 JWT による RLS 統合テスト（fixture はタグ付き・クリーンアップあり）

**本番組織・管理者データの削除はしないこと。**

## 5. REGAPRO_DATA_MODE

| 値 | 意味 |
|---|---|
| `dev-sample`（既定） | インメモリ確認用データ。Auth API はサンプル |
| `supabase` | Cloud Auth + DB + RLS。永続化は ports 経由 |

一時検証:

```env
REGAPRO_DATA_MODE=supabase
NEXT_PUBLIC_REGAPRO_DATA_MODE=supabase
```

検証後は再び `dev-sample` に戻してよいです。恒久切替はこの runbook 外の判断で行います。

## 6. Migration ルール

1. **適用済み migration を書き換えない** — 常に新しい timestamp ファイルを追加する
2. テナント表は **RLS 必須**、ポリシーは membership / level に整合させる
3. `INSERT … RETURNING` が失敗する場合、SELECT ポリシーが同トランザクション行をどう見るかを確認する（再クエリ依存を避ける）
4. 詳細は [migration-operation.md](./migration-operation.md) を参照

## 7. 既知の制約（恒久切替前）

- 成果物本文: `artifact_versions.canonical_content`（DB）が canonical。PDF/DOCX 等の **rendered export** は将来 `storage_path` + Storage
- ファイル: `file_objects` + `chat-attachments` Storage（認証 JWT）。長寿命 signed URL は使わない
- Research: ResearchRun は DB 保存されるが、**実 Web 検索バックエンド未接続**（確認用フロー。UI は実検索済みと誤認させない）
- 最終ブラウザ E2E（管理者ログイン）は人手確認が残る場合があります

~process-local artifact cache / pending:// は Durable Storage Phase で排除済み。

## 8. 品質ゲート

```bash
npm run typecheck
npm run lint
npm run test
npm run build
npm run db:test-rls
```

または `npm run check`（typecheck / lint / test / build）。

## 関連ドキュメント

- [supabase-setup.md](./supabase-setup.md)
- [environment-variables.md](./environment-variables.md)
- [bootstrap.md](./bootstrap.md)
- [migration-operation.md](./migration-operation.md)
