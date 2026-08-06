# Artifact Generation / 成果物生成

Regapro AI における成果物（Artifact）の生成・編集・版管理パイプライン。

## Artifact Types / 成果物タイプ

| Type | JA | Template |
|---|---|---|
| proposal | 提案書 | 表紙、背景、提案内容、スケジュール、費用 |
| minutes | 議事録 | 日時、参加者、議題、決定事項、TODO |
| report | レポート | 概要、分析、結論、参考文献 |
| memo | メモ | 自由形式 |
| custom | カスタム | ユーザー定義 |

## Generation Pipeline / 生成パイプライン

```
┌──────────────┐     ┌───────────────────┐     ┌──────────────┐
│ User action  │────▶│ ArtifactService   │────▶│ LLM Provider │
│ "下書き作成"  │     │ .generateDraft()  │     │ (local/cloud)│
└──────────────┘     └─────────┬─────────┘     └──────────────┘
                               │
                     ┌─────────▼─────────┐
                     │ Gather context:    │
                     │ - Project metadata │
                     │ - Pinned sources   │
                     │ - Previous artifacts│
                     └─────────┬─────────┘
                               │
                     ┌─────────▼─────────┐
                     │ Apply template     │
                     │ Generate content   │
                     │ Store as draft     │
                     └───────────────────┘
```

## Content Model / コンテンツモデル

```typescript
interface ArtifactContent {
  format: "prosemirror" | "markdown";
  body: string | JSON; // ProseMirror doc or Markdown
  citations: Citation[];
  metadata: {
    templateId?: string;
    generatedBy?: "user" | "ai-local" | "ai-external";
    sourceSessionIds?: string[];
  };
}

interface Citation {
  sourceId: string;
  url: string;
  title: string;
  position: number; // character offset or block ref
}
```

## Context Assembly / コンテキスト組み立て

Application Service gathers context server-side (or client-side for local LLM):

```typescript
interface ArtifactContext {
  project: { name: string; stage: string; customer?: string };
  pinnedSources: ResearchSource[];
  recentTasks: TaskSummary[];
  previousArtifact?: ArtifactContent; // for iteration
}
```

**Knowledge/Answer separation:** Research sources are **knowledge** (stored, cited). LLM output is **answer** (draft, editable). See [ADR 005](../adr/005-knowledge-answer-separation.md).

## Version Management / 版管理

| Event | Version Action |
|---|---|
| Create draft | v1 |
| User edit + save | v1 (same version, updated) |
| Submit for review | v1 → status: review |
| Approve | v1 → status: approved |
| Request changes | new draft from approved → v2 |
| Publish | current version → status: published |

```sql
-- Optional: artifact_versions table for full history
CREATE TABLE artifact_versions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id UUID NOT NULL REFERENCES artifacts(id),
  version     INTEGER NOT NULL,
  content     JSONB NOT NULL,
  created_by  UUID NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now()
);
```

## AI Generation Rules / AI 生成ルール

- Generated content labeled 「AI 下書き」in UI
- Citations from pinned sources inserted as footnotes
- User must review before status change to review/approved
- No auto-publish of AI content

## Export / エクスポート

| Format | Method |
|---|---|
| PDF | Server-side rendering (Puppeteer or @react-pdf) |
| Markdown | Direct content export |
| DOCX | Future |

## Spec Reference / 仕様参照

Full artifact specification: [ADR 010](../adr/010-artifact-spec.md).

## Related / 関連

- [Browser Local LLM](./browser-local-llm.md)
- [Domain Model](./domain-model.md)
