# Domain Model / ドメインモデル

## Entity Relationship / エンティティ関係

```
Organization (組織)
├── id: UUID
├── name: string
├── settings: OrgSettings
│
├── Member (メンバー)
│   ├── id, userId, orgId, role
│   └── role: owner | admin | manager | member | viewer
│
├── Customer (顧客)
│   ├── id, orgId, name, contactInfo
│   └── projects[] → Project
│
├── Project (案件)
│   ├── id, orgId, customerId, name, stage, ownerId
│   ├── stage: lead | proposal | negotiation | won | lost
│   ├── tasks[] → Task
│   ├── researchSessions[] → ResearchSession
│   └── artifacts[] → Artifact
│
├── Task (タスク)
│   ├── id, projectId, title, assigneeId, dueDate, status
│   └── status: todo | in_progress | done | cancelled
│
├── ResearchSession (調査)
│   ├── id, projectId, query, status, createdBy
│   ├── status: pending | running | completed | failed
│   └── sources[] → ResearchSource
│
├── ResearchSource (調査ソース)
│   ├── id, sessionId, url, title, snippet, pinned
│   └── metadata: jsonb
│
└── Artifact (成果物)
    ├── id, projectId, type, title, content, version, status
    ├── type: proposal | minutes | report | memo | custom
    └── status: draft | review | approved | published
```

## Value Objects / 値オブジェクト

```typescript
// packages/domain/src/value-objects/

type OrgId = string & { readonly brand: unique symbol };
type ProjectId = string & { readonly brand: unique symbol };
type Email = string & { readonly brand: unique symbol };
type Url = string & { readonly brand: unique symbol };

interface DateRange {
  start: Date;
  end: Date;
}

interface Money {
  amount: number;
  currency: "JPY" | "USD";
}
```

## Aggregates / 集約

| Aggregate Root | Entities | Invariants |
|---|---|---|
| Organization | Member | 1+ owner; unique member per user |
| Customer | — | name required; org-scoped |
| Project | Task, ResearchSession, Artifact | org-scoped; valid stage transitions |
| ResearchSession | ResearchSource | sources belong to session |
| Artifact | — | version increments on publish |

## Domain Services / ドメインサービス

| Service | Responsibility |
|---|---|
| `ProjectStageService` | Valid stage transitions |
| `TaskAssignmentService` | Assignee must be org member |
| `ArtifactVersionService` | Version bump on status change |
| `ResearchCitationService` | Link sources to artifact content |

## Domain Events / ドメインイベント

| Event | Trigger | Consumers |
|---|---|---|
| `ProjectCreated` | New project | Notification, audit |
| `TaskCompleted` | Task status → done | Timeline, metrics |
| `ResearchCompleted` | Session status → completed | Notification, artifact suggestion |
| `ArtifactPublished` | Status → published | Audit, export |

## Boundaries / 境界

- Domain layer has **no dependencies** on infrastructure
- All external I/O through Repository interfaces and Provider interfaces
- UI receives **ViewModels**, not domain entities directly

## Related / 関連

- [Database Schema](./database-schema.md)
- [ADR 008: Task Domain](../adr/008-task-domain.md)
