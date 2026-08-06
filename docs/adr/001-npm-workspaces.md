# ADR 001: npm Workspaces for Monorepo

## Status

Accepted

## Date

2026-01-15

## Context / 背景

Regapro AI は複数のパッケージ（Web アプリ、ドメイン、Application Service、UI コンポーネント、調査ワーカー）で構成される。コード共有、一貫した依存関係管理、統一された品質ゲートが必要。

## Decision / 決定

**npm workspaces** をモノレポ管理に採用する。

```
regapro-ai/
├── apps/web/           @regapro/web
├── packages/domain/    @regapro/domain
├── packages/application/ @regapro/application
├── packages/ui/        @regapro/ui
├── packages/shared/    @regapro/shared
└── services/research-worker/  @regapro/research-worker
```

### Root package.json

```json
{
  "workspaces": ["apps/*", "packages/*", "services/*"],
  "scripts": {
    "dev": "npm run dev --workspace=@regapro/web",
    "build": "npm run build --workspaces --if-present",
    "check": "npm run typecheck && npm run lint && npm run test && npm run build"
  }
}
```

## Alternatives Considered / 検討した代替案

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| npm workspaces | Built-in, zero config | Slower than pnpm | **Selected** |
| pnpm workspaces | Fast, strict | Additional tool | Future consideration |
| Turborepo | Caching, pipeline | Complexity overhead | Overkill for now |
| Nx | Full toolchain | Heavy, learning curve | Rejected |
| Multi-repo | Independent deploy | Shared code pain | Rejected |

## Consequences / 結果

### Positive

- Single `npm install` for all packages
- Shared TypeScript configs and ESLint rules
- Unified `npm run check` quality gate
- Internal packages referenced via workspace protocol

### Negative

- npm hoisting can cause duplicate dependencies
- No built-in caching (acceptable at current scale)

## Compliance / 遵守事項

- Node.js >= 24 required
- All workspaces must implement `typecheck`, `lint` scripts
- Packages must not create circular dependencies
