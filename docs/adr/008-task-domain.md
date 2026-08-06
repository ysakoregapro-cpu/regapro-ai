# ADR 008: Task Domain

## Status

Accepted

## Date

2026-02-08

## Context / 背景

タスク管理は Regapro AI の中核機能。独立したタスク管理 SaaS ではなく、**案件（Project）コンテキスト内** の実行可能な作業項目として設計する必要がある。タスクのドメインモデル、ステータス遷移、UI 表示を定義。

## Decision / 決定

### Task as Project-Scoped Entity

```typescript
interface Task {
  id: TaskId;
  projectId: ProjectId;
  orgId: OrgId;
  title: string;
  assigneeId: MemberId | null;
  dueDate: Date | null;
  status: TaskStatus;
  createdAt: Date;
  updatedAt: Date;
}

type TaskStatus = "todo" | "in_progress" | "done" | "cancelled";
```

### Status Transitions

```
todo → in_progress → done
todo → done (quick complete)
todo → cancelled
in_progress → cancelled
done → todo (reopen, manager+)
cancelled → todo (reopen, manager+)
```

### UI Surfaces

| Surface | Content |
|---|---|
| 今日 (Today) | Tasks due today + overdue across projects |
| 案件詳細 | Project-scoped task list |
| タスク | Cross-project task list with filters |
| Mobile | Compact task rows, swipe to complete |

### Rules

- Tasks always belong to a Project (no orphan tasks)
- "Today" view aggregates across projects — primary mobile entry point
- Task completion triggers domain event → project timeline update
- No task-specific KPI cards — inline counts only

## Alternatives Considered / 検討した代替案

| Option | Verdict |
|---|---|
| Global tasks (no project) | Rejected — loses business context |
| Subtasks / nested tasks | Deferred — v2 consideration |
| Kanban board as primary | Rejected — table/list first, board optional later |
| **Project-scoped with cross-project views** | **Selected** |

## Consequences / 結果

### Positive

- Clear ownership: task → project → customer
- "Today" view drives daily workflow
- Simple domain model, easy RLS (org-scoped)
- Natural fit for mobile quick-complete

### Negative

- Cannot create task without project (extra step)
- Cross-project views require joins

## Related ADRs

- [007: UI Information Architecture](./007-ui-information-architecture.md)
- [009: Supabase RLS](./009-supabase-rls.md)
