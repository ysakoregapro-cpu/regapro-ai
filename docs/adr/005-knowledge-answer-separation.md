# ADR 005: Knowledge-Answer Separation

## Status

Accepted

## Date

2026-01-28

## Context / 背景

AI プロダクトでよくある問題: LLM の生成テキストと参照ソースが混在し、何が「事実」で何が「AI の推測」か区別できない。Regapro AI は調査（Research）と成果物（Artifact）を扱うビジネス OS として、**知識（Knowledge）** と **回答（Answer）** を明確に分離する必要がある。

## Decision / 決定

**Knowledge-Answer Separation** モデルを採用する。

### Definitions

| Concept | JA | Storage | Mutable | Source |
|---|---|---|---|---|
| Knowledge | 知識 | `research_sources` table | User can pin/edit notes | External URLs via SearXNG |
| Answer | 回答 | `artifacts.content` | User edits freely | LLM generation or manual |

### Rules

1. **Knowledge** comes from research sources — stored with URL, title, snippet
2. **Answer** is artifact content — clearly labeled if AI-generated
3. Citations link Answer → Knowledge (footnote references to source IDs)
4. Knowledge is never overwritten by LLM output
5. LLM context includes Knowledge as read-only input
6. User can accept/reject AI suggestions into Answer

### Data Flow

```
Research (Knowledge)
  → Sources stored in DB with URL/metadata
  → Pinned sources selected by user

Artifact Generation (Answer)
  → Context = Project + Pinned Knowledge
  → LLM generates Answer (draft)
  → Citations inserted referencing Knowledge source IDs
  → User reviews/edits Answer
  → Saved as artifact (versioned)
```

## Alternatives Considered / 検討した代替案

| Option | Verdict |
|---|---|
| RAG with embedded vectors only | Rejected — loses source traceability |
| Chat history as context | Rejected — chat app pattern |
| Mixed storage (sources in artifact body) | Rejected — no separation |
| **Separate tables + citation links** | **Selected** |

## Consequences / 結果

### Positive

- Clear provenance: user knows what's sourced vs generated
- Sources reusable across artifacts
- Audit-friendly for B2B compliance
- Supports "AI 下書き" labeling without confusion

### Negative

- Citation management adds UI complexity
- Source-Answer linking requires careful data model

## Related ADRs

- [010: Artifact Spec](./010-artifact-spec.md)
- [006: Research Worker Separation](./006-research-worker-separation.md)
