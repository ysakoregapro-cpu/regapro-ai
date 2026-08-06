# ADR 010: Artifact Spec

## Status

Accepted

## Date

2026-02-12

## Context / 背景

成果物（Artifact）は Regapro AI の主要出力 — 提案書、議事録、レポート等。コンテンツモデル、版管理、AI 生成ラベル、引用形式、エクスポート形式を定義する必要がある。ADR 005 の Knowledge-Answer Separation を成果物レベルで具体化。

## Decision / 決定

### Artifact Entity

```typescript
interface Artifact {
  id: ArtifactId;
  projectId: ProjectId;
  orgId: OrgId;
  type: ArtifactType;
  title: string;
  content: ArtifactContent;
  version: number;
  status: ArtifactStatus;
  createdBy: MemberId;
  createdAt: Date;
  updatedAt: Date;
}

type ArtifactType = "proposal" | "minutes" | "report" | "memo" | "custom";
type ArtifactStatus = "draft" | "review" | "approved" | "published";
```

### Content Model

```typescript
interface ArtifactContent {
  format: "prosemirror" | "markdown";
  body: string | ProseMirrorDoc;
  citations: Citation[];
  metadata: {
    templateId?: string;
    generatedBy?: "user" | "ai-local" | "ai-external";
    sourceSessionIds?: string[];
  };
}

interface Citation {
  sourceId: string;  // research_sources.id
  url: string;
  title: string;
  position: number;
}
```

### Lifecycle

```
draft → review → approved → published
         ↓ (changes requested)
       draft (version++)
```

### Templates

| Type | JA | Sections |
|---|---|---|
| proposal | 提案書 | 表紙、背景、提案内容、スケジュール、費用 |
| minutes | 議事録 | 日時、参加者、議題、決定事項、TODO |
| report | レポート | 概要、分析、結論、参考文献 |
| memo | メモ | 自由形式 |

### AI Generation Rules

1. Generated content: `metadata.generatedBy = "ai-local" | "ai-external"`
2. UI label: 「AI 下書き」— no sparkle/glow decoration
3. Citations from pinned research sources (Knowledge → Answer link)
4. User must explicitly review before status → review
5. No auto-publish

### Version Management

- Same version: user edits within draft/review
- Version increment: approved → new draft cycle
- Optional `artifact_versions` table for full history

### Export

| Format | Priority | Method |
|---|---|---|
| PDF | P0 | Server-side render |
| Markdown | P1 | Direct export |
| DOCX | P2 | Future |

## Alternatives Considered / 検討した代替案

| Option | Verdict |
|---|---|
| Plain text only | Rejected — no formatting for business docs |
| Google Docs embed | Rejected — external dependency, data leaves platform |
| Markdown only | Rejected — limited formatting for proposals |
| **ProseMirror + Markdown dual format** | **Selected** |
| Chat message as artifact | Rejected — chat app pattern |

## Consequences / 結果

### Positive

- Structured business documents with provenance
- Template system enables quick start
- Citation model supports compliance
- Clear AI vs human content distinction

### Negative

- Rich editor complexity (ProseMirror integration)
- PDF export requires server-side rendering infra
- Version management adds storage

## Related ADRs

- [005: Knowledge-Answer Separation](./005-knowledge-answer-separation.md)
- [004: Browser Local LLM](./004-browser-local-llm.md)

## Related Docs

- [Artifact Generation](../architecture/artifact-generation.md)
- [Component Guidelines](../design/component-guidelines.md)
