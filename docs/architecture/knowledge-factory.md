# Knowledge Factory

RegaloProfessional の社内 Knowledge 生産基盤。LLM の単発 context 上限に依存せず、原文を保持したまま継続投入する。

通常の回答検索は **公開済み（published）** の `knowledge_documents` / `knowledge_chunks` のみ。Raw Source・Candidate・Review・Audit・private 会話は通常 retrieval に入らない。

## Source model

| 概念 | 既存テーブル | 役割 |
|---|---|---|
| KnowledgeSource | `knowledge_sources` | 原文（貼付・Q&A・ファイル・URL・Research・会話・transcript・API） |
| KnowledgeIngestionJob | `knowledge_ingestion_jobs` | 再開可能な分割処理。将来 Queue/worker に交換可能な port |
| KnowledgeSourceChunk | `knowledge_source_chunks` | 決定的分割。検索 RPC の対象外 |
| KnowledgeCandidate | `knowledge_candidates` | 抽出結果。必ず source / excerpt を持つ |
| KnowledgeFact | `knowledge_facts` | 構造化事実の証拠リンク（retrieval ではない） |
| KnowledgeReview | `knowledge_candidate_reviews` | 承認・却下・重複・置き換えの監査 |
| KnowledgeDocument | `knowledge_documents` | 公開ライフサイクル（既存） |
| KnowledgeChunk | `knowledge_chunks` | E5 384-d + lexical。Hybrid 検索 |

同じ意味のテーブルは増やさない。既存 `knowledge_documents.status`（draft/review/approved/published/superseded/expired/archived）を維持する。

## Ingestion

入口: テキスト貼付 / Q&A / ファイル（txt, md, csv, PDF, DOCX, XLSX） / URL / Web Research / 会話キャプチャ / transcript port / 将来 API（`origin_kind=api`）。

1. checksum（`content_hash`）で同一 Source の重複投入を防ぐ  
2. budget 設定で決定的チャンク分割（文字数は business logic にベタ書きしない）  
3. チャンク単位で抽出（pending → processing → completed / failed）  
4. 失敗は個別再開。バッチ全体は rollback しない  

巨大 Source を 1 回の LLM context に入れない。現 MVP 抽出器は決定的ヒューリスティック（モデル呼び出しなし）。Conflict など必要なときだけ reasoning を足せる。

Job は `total_units` / `processed_units` / `failed_units` / `cursor_index` / `error_summary`（本文・secret 禁止）を持つ。

## Chunking

`splitKnowledgeBody`（見出し → 段落 → 文 → 固定長）。Source 分割と公開時チャンクで同じ決定的 splitter を使う。同一 `content_hash` なら再 embedding しない。

## Extraction

Candidate type: fact / policy / procedure / decision / strategy / knowhow / qa / definition / organization / historical_event。

Fact status: fact / decision / proposal / hypothesis / rejected / historical。

「検討していた」を「現在実施している」へ変換しない。Q&A は原文 Q&A と一般化候補を別レコードで持つ。

各 Candidate は `source_id` / `source_chunk_id` / `source_excerpt` / `extracted_at` を必須とする。

## Lifecycle

```
Raw Source → Job / SourceChunk → Candidate → Review → Approved
  → Published Document → knowledge_chunks → E5 embedding → Hybrid retrieval
```

AI は Published に直接しない。private 会話の自動 organization 公開は禁止。

## Review

Workspace / ナレッジ と 管理センターのナレッジ承認に Review Inbox。

フィルタ: 新規 / 重複 / 矛盾 / 更新候補 / 承認済み / 却下。

操作: 承認 / 編集して承認 / 却下 / 重複 / 置き換え（supersede）。矛盾は一括承認不可。

## Freshness / supersession

`valid_from` / `valid_until` / `observed_at` / `source_date` / `fact_status` / `is_current` / `supersedes_id` / `superseded_by_id` / `confidence` / `source_quality`。

新しい Fact は古い行を物理削除しない。historical として残す。現在質問は current を優先。過去質問（当時/以前 等）は historical も利用。

## Security

既存 AccessContext / RLS を継承。Source の visibility / confidentiality を Candidate・Published へコピーする。自動で範囲を広げない。AI がユーザー権限以上の clearance を付けない。

通常検索: published のみ。`regapro_knowledge_chunk_retrievable` は変更せず、Factory テーブルは RPC に載せない。

## Embedding

公開時: Xenova/multilingual-e5-small、384 次元。失敗時は Published のまま成功扱いしない（`embedding_status=failed`、status を approved に戻し retry 可能）。

## Bulk ingestion

複数ファイルは 1 ファイル 1 Source。個別失敗は他を止めない。checksum で同一ファイルを検出。

## Conversational capture

「これをナレッジに追加して」等で Candidate を作る。質問・根拠・回答・指示を provenance として残す。private / 機微（健康・政治・宗教・私生活等）は organization 候補へ昇格しない。未検証の AI 回答は `source_quality` を低くする。

## URL / Research

Firecrawl 等で取得した本文を Source として保存。`origin_url` / `canonical_url` / `domain` / `retrieved_at` を保持。自動 Published 禁止。

## Training dataset

`TrainingDatasetPort` と `knowledge_training_candidates`。Question / Evidence / Model Answer / Evaluation / Corrected Answer。Knowledge retrieval とは混同しない。Fine-tuning は今回しない。

## Zero-evidence

明確な internal-only で社内 evidence 0 かつ Web なしのときは、追加 LLM を呼ばず「確認できる社内Knowledgeがありません。」を返す。一般知識や Web 調査は止めない。

## Live smoke

`REGAPRO_KNOWLEDGE_FACTORY_SMOKE=1 npm run smoke:knowledge-factory`

機密でない短い fixture を投入し、公開 → chunk → E5 → Hybrid まで確認したあと削除する。本番 Knowledge 本文はソースコードにハードコードしない。
