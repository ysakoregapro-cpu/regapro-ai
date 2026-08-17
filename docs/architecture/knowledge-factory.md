# Knowledge Factory

RegaloProfessional の社内 Knowledge 生産基盤。LLM の単発 context 上限に依存せず、原文を保持したまま継続投入する。

通常の回答検索は **公開済み（published）** の `knowledge_documents` / `knowledge_chunks` のみ。Raw Source・Candidate・Review・Audit・private 会話は通常 retrieval に入らない。

運用手順は [knowledge-ingestion-runbook.md](../operations/knowledge-ingestion-runbook.md) を参照。

## Migration history

Cloud へ MCP `apply_migration` したときの version 名と、リポジトリのファイル名がずれることがある。**適用済み SQL 本文は書き換えない。`db reset --linked` は禁止。**

履歴だけを揃えるときは、ローカルファイル名を remote version に合わせる（中身は idempotent な既存 SQL のまま）。remote にだけ存在する no-op version は、再実行しても schema を変えない placeholder を置く。

確認:

```bash
npx supabase migration list
npx supabase db push --dry-run
```

dry-run が過去 migration を再適用しようとする場合は、revert して push し直さない（本番 schema が再実行される）。filename / `migration repair --status applied` で履歴だけ合わせる。

## Source model

| 概念 | 既存テーブル | 役割 |
|---|---|---|
| KnowledgeSource | `knowledge_sources` | 原文。貼付・Q&A は `raw_text`。ファイル原本は private bucket `knowledge-sources` |
| KnowledgeIngestionJob | `knowledge_ingestion_jobs` | Durable job。lease / pause / cancel / retry |
| KnowledgeSourceChunk | `knowledge_source_chunks` | 決定的分割。lease・poison・`waiting_for_extractor` |
| KnowledgeCandidate | `knowledge_candidates` | 抽出結果。excerpt 必須。extractor version を保持 |
| KnowledgeFact | `knowledge_facts` | 構造化事実の証拠リンク（retrieval ではない） |
| KnowledgeReview | `knowledge_candidate_reviews` | 承認・却下・重複・置き換えの監査 |
| KnowledgeDocument | `knowledge_documents` | 公開ライフサイクル（既存） |
| KnowledgeChunk | `knowledge_chunks` | E5 384-d + lexical。Hybrid 検索 |
| Extraction cache | `knowledge_extraction_cache` | chunk hash + extractor/model/prompt version |

同じ意味のテーブルは増やさない。既存 `knowledge_documents.status` を維持する。

## Ingestion

入口: **Bulk CLI**（正式な大量投入） / テキスト貼付 / 確定シード (`authoritative_seed`) / Q&A / ファイル（txt, md, csv, PDF, DOCX, XLSX） / URL / Web Research / 会話キャプチャ / transcript / 将来 API（`origin_kind=api`）。

CLI は Factory を置き換えない。`structured` は 1 item → 1 Candidate（Review まで、自動 Publish しない）。`source` は既存 Job / Extractor 経路。手順は [knowledge-bulk-import.md](../operations/knowledge-bulk-import.md)。

Domain（retrieval 対象）と Security（clearance / visibility）は別概念。Domain から clearance を推定しない。

1. checksum（本文 `content_hash` またはファイル `checksum`）で同一 Source の重複投入を防ぐ  
2. budget 設定で決定的チャンク分割  
3. Worker が lease → 1〜N chunk → checkpoint。ブラウザを閉じても DB に残る  
4. 失敗は個別再開。poison chunk は無限 retry しない  
5. 外部 LLM が無い chunk は `waiting_for_extractor`。偽 Candidate は作らない  

巨大 Source を 1 回の LLM context に入れない。Heuristic は前処理 / オフライン前段。通常抽出は structured LLM（fast/main）。矛盾・supersession の判断が難しいときだけ reasoning。

## Extraction

流れ: SourceChunk → Heuristic 前分析 → LLM structured JSON → Zod 検証 → 既存 Knowledge 比較 → Candidate。

検証失敗は retry、それでも不正なら chunk を `retryable` / poison 後 `failed`。壊れた JSON を補完して成功扱いしない。

Extractor version: `heuristic-v1` / `llm-extractor-v1`。Candidate に `extractor_type` / `extractor_version` / `model_role` / `model_id` / `prompt_version` / `extractedAt`。一般 UI に provider 名は出さない。診断画面のみ。

会話 / transcript は健康・政治・宗教・私生活・認証情報などを organization 候補にしない。案件の失敗から作った運用ルールは候補になり得る。private → organization の自動拡張は禁止。

## Durable jobs / queue

pgmq / Supabase Queues は未導入。Postgres テーブル + `SKIP LOCKED` claim RPC が Durable Queue。domain は `KnowledgeJobQueue` / `KnowledgeJobLease` / `KnowledgeJobWorker` port。将来 Vercel Queue / 外部 worker に交換可能。

Worker 1 回: job lease → N chunks（budget）→ commit。lease 切れは再取得。Cancel は未処理のみ止め、既存 Source/Candidate は削除しない。

## Storage

private bucket `knowledge-sources`。path: `org/{orgId}/knowledge-sources/{sourceId}/{filename}`。`file_objects` ラベル + RLS。signed URL を恒久保存しない。service_role で通常アクセスを迂回しない。

補償: metadata 成功 → Storage 失敗なら metadata を soft-delete。Storage 成功 → DB 失敗なら object を削除（orphan DELETE ポリシー）。

scan PDF / 空抽出は `requires_ocr`。空 text を成功扱いしない。Spreadsheet は sheet/row provenance を可能な範囲で残す。

## Lifecycle

```
Raw Source → Storage（ファイル）→ Job / SourceChunk → LLM Candidate → Review → Approved
  → Published Document → knowledge_chunks → E5 embedding → Hybrid retrieval
```

Source は公開後も原則残す（監査）。削除要求時は Published を cascade しない。依存件数の警告を出す。

## Review

フィルタ: 新規 / 重複 / 矛盾 / 更新候補 / 承認済み / 却下。検索・領域・現在/過去。

一括承認は低リスク（`new` かつ矛盾なし）のみ。矛盾・不確実な supersession・private→広い visibility は個別。

## Freshness / authoritative seed

`authoritative_seed` は人間 Review を省略しない。`source_quality` を高くし、current retrieval で古い transcript より優先する。新しいからという理由だけで自動 supersede しない。

Hybrid RPC は `is_current DESC, source_quality DESC, score DESC`。

## Security

既存 AccessContext / RLS。自動で範囲を広げない。Langfuse の抽出 trace は sourceId/jobId/chunkId/version/latency/tokens/cost。L2/L3/private は metadata-only。secret と raw private 本文は送らない。

## Embedding

公開時: Xenova/multilingual-e5-small、384 次元。失敗時は Published のまま成功扱いしない。

## Zero-evidence / zero-model

社内 evidence 0 の回答経路は従来どおり。Knowledge Factory は LLM 停止中も Source / chunk / hash を継続し、抽出だけ待つ。

## Live smoke

`REGAPRO_KNOWLEDGE_FACTORY_SMOKE=1` または `REGAPRO_KNOWLEDGE_HARDENING_SMOKE=1 npm run smoke:knowledge-factory`

機密でない短い fixture。本番 Knowledge 本文はソースコードにハードコードしない。
