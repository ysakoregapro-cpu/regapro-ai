# ADR 007: UI Information Architecture

## Status

Accepted

## Date

2026-02-05

## Context / 背景

AI プロダクトの UI は often チャット中心または機能カタログ中心になる。Regapro AI は **ビジネス OS** として、ユーザーの日常業務（案件、タスク、調査、成果物）に沿った IA が必要。機能名や実装名（Provider, Repository）をユーザーに見せてはならない。

## Decision / 決定

**Work-unit based Information Architecture** を採用する。

### Navigation Structure

```
今日 | 案件 | 顧客 | タスク | 調査 | 成果物 | 設定
```

- Default landing: **今日** (not chat, not dashboard)
- All screens organized by what the user is **doing**, not by system feature
- Internal names hidden from general users

### Page Design Rules

| Rule | Rationale |
|---|---|
| Compact headers | No huge titles + long descriptions |
| No card grids | Tables and lists for information density |
| No giant KPI cards | Metrics inline in context |
| One primary action per view | Reduce decision fatigue |
| No AI decorations | Professional business software aesthetic |
| Mobile purpose-built | Not desktop columns stacked vertically |
| No double scroll | Single scroll container per view |

### Visual Constraints

- Accent: `#0F766E` (teal, not blue-purple)
- No gradients, glow, glass, sparkle decorations
- Radius: 6–12px (not 20px+)
- Shadows: drawers, menus, modals only

## Alternatives Considered / 検討した代替案

| Option | Verdict |
|---|---|
| Chat-first IA | Rejected — not a chat app |
| Feature catalog / AI Hub | Rejected — exposes features not work |
| Dashboard-first | Rejected — KPI cards anti-pattern |
| CRM clone IA | Rejected — doesn't highlight research→artifact flow |
| **Work-unit IA** | **Selected** |

## Consequences / 結果

### Positive

- Matches user mental model (案件中心)
- Differentiates from AI chat products
- Scales as features grow (new work units, not new AI features)
- Cursor rules enforce consistency

### Negative

- Requires discipline to maintain (resist chat-first features)
- "調査" and "成果物" may need onboarding for new users

## Related ADRs

- [008: Task Domain](./008-task-domain.md)
- [010: Artifact Spec](./010-artifact-spec.md)

## Enforcement

- `.cursor/rules/information-architecture.mdc`
- `.cursor/rules/ui-design-system.mdc`
- `docs/design/anti-patterns.md`
