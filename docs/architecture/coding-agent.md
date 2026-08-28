# Coding Agent Runtime / コーディング実行基盤

RegaloProfessional AI Runtime の **新しい能力** です。別製品ではありません。

既存の Internal RAG / Web Intelligence / Citation / Knowledge Factory / Model Runtime は維持し、コーディング要求だけを `@regapro/coding-runtime` に渡します。filesystem / terminal は `ai-runtime` に埋め込みません。

## Modes / モード

| Mode | いつ | Workspace |
|---|---|---|
| Pasted Code | チャットへコードを貼る（GAS / TS / JS / SQL / PowerShell / Python / React） | 不要 |
| Local Workspace | 許可したフォルダを Workspace にする | Local Agent |
| Vibe Coding | 自然言語 → 調査 → 計画 → 編集 → 検証 → diff | Local Agent + Agent Loop |

貼り付け GAS（`SpreadsheetApp` / `DriveApp` / `FormApp` / Triggers）は、ローカルファイルが無くてもエラーにしません。

## Architecture / アーキテクチャ

```
Assistant
  → IntentRouter (code + codingMode: pasted|workspace|vibe)
  → RetrievalPlanner（社内Knowledge が必要なら従来どおり）
  → CodingRuntime
       Intent → Planner → AgentLoop
         ToolRegistry / ToolExecutor
         WorkspaceBoundary / Risk / Approval
         Verification / Git snapshot / Diff
  → Local Agent (optional adapter)
       NodeWorkspaceFs / Git / Command
```

Vercel から Windows localhost へは接続しません。Local Agent が **outbound poll**（コマンドキュー）します。同一 PC 開発用に 127.0.0.1 bridge もありますが、Production 経路ではありません。

将来の Device selector（NOTEBOOK / DESKTOP）は `coding_devices.label` で拡張します。

## Agent Loop / エージェントループ

```
Goal → Plan → Tool → Observe → Reason → Tool → … → Verify → Finish
```

Guard: max iteration / tool calls / time / cost。同じ失敗の無限反復は FailureGuard で止めます。観測ログは truncate + secret mask。巨大ログを Context に入れません。

モデルは `REGAPRO_MODEL_CODE`（role `code`）。複雑な構成は `reasoning` → `code`。Provider 名は業務ロジックにハードコードしません。

## Tools / ツール

READ（自動許可可）: workspace_list/info, list_directory, read_file, read_file_range, search_files, find_text, git_status/diff/log/branch, inspect_pasted, typecheck/lint/test/build（既存 script のみ）

WRITE（Workspace 許可）: write_file, create_file, apply_patch, rename_file, git_add, git_checkout, run_command（非破壊）

DANGEROUS（明示承認）: delete, git reset --hard, git clean, force checkout/push, production DB mutation, secret/env mutation, commit/push

第一選択の編集は `apply_patch`。`expectedHash` で stale edit を拒否し、再 read します。

## Repository context / リポジトリ文脈

巨大 repo を Prompt に載せません。最初は tree / package metadata / configs / git status。その後 search/read。`CodeIndexPort` は lexical 実装で、将来 AST / embeddings / symbol に差し替えます。

## Git

開始時 `git status`、終了時 `git diff` + `git status`。既存 dirty は AI 変更と分け、reset しません。commit/push は承認必須。

## Secrets

`.env` / credentials / private keys はモデルへ送りません。read_file 側で mask。秘密ファイルの書き込みは承認。terminal 出力も redact。Local Agent は `service_role` を持ちません。

## Persistence / Observability

`coding_runs` に goal / device / workspace / status / plan / tool 名 / changed_files / verification / 時刻。本文・巨大ログ・秘密は保存しません。Langfuse には intent / role / tool 名 / latency / iterations / success。コード本文は送りません。

## Tests

Unit: permissions, path traversal, workspace boundary, secret masking, patch, stale file, dangerous approval, git dirty, iteration limit。

Integration: 一時 git repo で read → patch → test。ユーザーの既存 repo は破壊しません。

regapro-ai 自身を Workspace にする場合、最初は READ only。WRITE の Live E2E は temporary fixture で行います。
