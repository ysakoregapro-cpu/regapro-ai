# Knowledge ingestion runbook

本番の社内 Knowledge を Knowledge Factory へ継続投入する手順。`db reset --linked` と本番 truncate は禁止。

## 1. Migration history

```bash
npx supabase migration list
npx supabase db push --dry-run
```

Local / Remote の version が揃い、dry-run が **未適用の新しい migration だけ** を示すこと。過去 SQL を revert して再 push しない。

新規 schema は timestamp 付き migration のみ。適用後:

```bash
npx supabase db push
npx supabase db lint --linked
npm run db:gen-types
```

## 2. 最初の本番投入（確定情報シード）

実会社 Knowledge をリポジトリに置かない。**正式な大量投入は Bulk CLI**。UI は少量の確認用。

1. ローカルに `.local/knowledge-import/current-seed/` を用意（`.gitignore` 済み）
2. `manifest.json` で Domain と Clearance を**別々に**指定する
3. `npm run knowledge:import -- ".\.local\knowledge-import\current-seed" --dry-run`
4. 問題なければ同じコマンドから `--dry-run` を外して投入
5. Review Inbox で承認してから Publish。CLI は自動公開しない

同じテーマの古い会話（例: 許可取得準備中）より、シード（許可取得済み）が current 検索で優先される。古い事実は物理削除せず、supersede で historical にする。一括承認しない。

詳細手順は [knowledge-bulk-import.md](./knowledge-bulk-import.md)。

## 3. 大量ファイル / 会話

- 原本は `knowledge-sources`（private）。巨大 binary は DB に入れない  
- Job はブラウザを閉じても続く。処理状況から「続きを処理」  
- 失敗 chunk は「失敗を再試行」。poison は個別確認  
- LLM 停止中は `waiting_for_extractor`。偽候補は作らない。復旧後に再開  
- 会話投入は private のまま organization へ自動拡張しない  

## 4. Worker / 障害

Vercel インスタンス切断や deploy 中断後:

1. `lease_expires_at` 経過 → 別 invocation が claim  
2. 同じ chunk を二重処理しても Candidate は `source_chunk_id + content_hash` で重複しない  
3. Cancel は未処理のみ。既存 Source/Candidate は残す  

Queue 実装は Postgres claim RPC。pgmq 未使用。将来の外部 worker は port 差し替え。

## 5. 失敗パターン

| 症状 | 対応 |
|---|---|
| `requires_ocr` | スキャン PDF。OCR 接続まで Review 停止 |
| `waiting_for_extractor` | 推論キー / 予算。復旧後 Resume |
| `poison_chunk` | 原文を分割し直すか手動 Candidate |
| Storage 成功 DB 失敗 | orphan 補償で object 削除 |
| 同一 checksum | 既存 Source に紐づく Job を再利用 |

## 6. 観測

診断情報は件数と extractor version のみ。Langfuse に raw private / secret を送らない。L2/L3 は metadata-only。

## 7. バックアップ

Source・Candidate・Published・Storage object は独立。Published を消さずに Source を soft-delete できる。復元は `deleted_at` と Storage 原本から。

## 8. 将来の自社モデル

`SelfHostedModelProvider` を抽出 generate に差し替える。prompt version / extractor version を上げると cache miss で再抽出できる。
