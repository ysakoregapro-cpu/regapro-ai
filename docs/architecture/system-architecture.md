# System Architecture / システムアーキテクチャ

## Overview / 概要

Regapro AI は npm workspaces モノレポで構成される **ビジネス OS** プラットフォーム。

```
┌─────────────────────────────────────────────────────────────┐
│                        Client (Browser)                    │
│  Next.js App (apps/web) — React 19, Server Components     │
│  Optional: Browser Local LLM (WebGPU / WASM)                │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTPS
┌──────────────────────────▼──────────────────────────────────┐
│                     Application Layer                        │
│  Server Actions / API Routes / Application Services          │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                      Domain Layer                             │
│  Entities: Project, Customer, Task, Research, Artifact        │
│  Domain Services, Value Objects                               │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                   Infrastructure Layer                        │
│  Repositories (Supabase) │ Providers (Research, LLM, Storage) │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                      Supabase                                 │
│  PostgreSQL + Auth + RLS + Realtime + Storage + Edge Fn     │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│              Research Worker (services/research-worker)      │
│  Async job processing — SearXNG primary                      │
└─────────────────────────────────────────────────────────────┘
```

## Monorepo Structure / モノレポ構成

```
regapro-ai/
├── apps/
│   └── web/              # Next.js frontend + API
├── packages/
│   ├── domain/           # Domain entities & services
│   ├── application/      # Application services (use cases)
│   ├── ui/               # Shared UI components
│   └── shared/           # Types, utils, constants
├── services/
│   └── research-worker/  # Background research jobs
└── docs/                 # Documentation
```

## Layer Rules / レイヤールール

| Layer | Can Call | Cannot Call |
|---|---|---|
| UI (apps/web) | Application Services | Repository, Provider directly |
| Application | Domain, Repository, Provider | — |
| Domain | — (pure) | Infrastructure |
| Repository | Supabase client | UI |
| Provider | External APIs (server-side) | UI |

## Key Flows / 主要フロー

### Read Flow / 読み取り

```
Browser → Server Component → ApplicationService.getProjects()
  → ProjectRepository.findByOrg() → Supabase (RLS) → DTO → UI
```

### Research Flow / 調査

```
Browser → API → ResearchService.startSession()
  → Job queue → Research Worker
  → SearXNGProvider.search() → Store sources → Notify client
```

### Artifact Generation / 成果物生成

```
Browser → API → ArtifactService.generateDraft()
  → LLMProvider (browser-local or external) → Store artifact → UI
```

## Technology Stack / 技術スタック

| Component | Technology |
|---|---|
| Frontend | Next.js 16, React 19, Tailwind CSS v4 |
| Backend | Next.js API Routes, Server Actions |
| Database | Supabase (PostgreSQL) |
| Auth | Supabase Auth |
| Research | SearXNG (primary) |
| LLM | Browser-local (optional) + External (optional) |
| Monorepo | npm workspaces |

## Security / セキュリティ

- RLS on all tenant tables
- Service role key: worker processes only
- No secrets in client bundle
- See [RLS Matrix](./rls-matrix.md), [Permission Matrix](./permission-matrix.md)

## Quality Gates / 品質ゲート

```bash
npm run typecheck && npm run lint && npm run test && npm run build
```

## Related / 関連

- [Domain Model](./domain-model.md)
- [Provider Architecture](./provider-architecture.md)
- [ADR 001: npm workspaces](../adr/001-npm-workspaces.md)
