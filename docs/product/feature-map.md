# Feature Map / 機能マップ

機能を **作業単位（Work Units）** で整理。エンジニアリングモジュール名はユーザー向けマップに含めない。

## Work Unit Matrix / 作業単位マトリクス

| Work Unit | Core Features | AI / Automation | Mobile |
|---|---|---|---|
| 今日 (Today) | 今日のタスク、期限超過、進行中案件サマリ | — | Primary |
| 案件 (Projects) | CRUD、ステージ、担当者、タイムライン | ステージ提案 | List + Detail |
| 顧客 (Customers) | CRUD、関連案件、連絡先 | — | List + Detail |
| タスク (Tasks) | CRUD、割当、期限、完了 | — | Primary |
| 調査 (Research) | クエリ、ソース一覧、ピン、メモ | ソース要約 | Query + Results |
| 成果物 (Artifacts) | エディタ、テンプレート、版管理、共有 | 下書き生成、インライン提案 | View + Light edit |
| 設定 (Settings) | 組織、メンバー、ロール、連携 | LLM 選択（上級者） | Minimal |

## Feature Detail / 機能詳細

### 今日 / Today

| Feature | Priority | Status |
|---|---|---|
| 今日のタスク一覧 | P0 | Planned |
| 期限超過アラート | P0 | Planned |
| 進行中案件サマリ（コンパクト） | P1 | Planned |
| ~~KPI ダッシュボード~~ | — | **Excluded** |

### 案件 / Projects

| Feature | Priority | Status |
|---|---|---|
| 案件 CRUD | P0 | Planned |
| ステージ管理 | P0 | Planned |
| 案件タイムライン | P1 | Planned |
| 顧客リンク | P0 | Planned |
| タスク/調査/成果物タブ | P0 | Planned |

### 調査 / Research

| Feature | Priority | Status |
|---|---|---|
| 調査セッション作成 | P0 | Planned |
| ソース一覧（タイトル、URL、スニペット） | P0 | Planned |
| ソースピン / メモ | P1 | Planned |
| 案件メモへの引用 | P0 | Planned |
| ソース要約（AI） | P1 | Planned |

**Backend:** SearXNG primary; Tavily/Firecrawl/Exa as fallback interfaces (no Firecrawl API calls).

### 成果物 / Artifacts

| Feature | Priority | Status |
|---|---|---|
| 下書き作成（テンプレート） | P0 | Planned |
| リッチテキストエディタ | P0 | Planned |
| 調査ソース引用 | P0 | Planned |
| 版管理 | P1 | Planned |
| レビュー / 承認フロー | P1 | Planned |
| PDF / Markdown エクスポート | P1 | Planned |
| AI 下書き生成 | P1 | Planned |

### 設定 / Settings

| Feature | Priority | Status |
|---|---|---|
| 組織プロフィール | P0 | Planned |
| メンバー招待 / 管理 | P0 | Planned |
| ロール / 権限 | P0 | Planned |
| 外部 AI 設定（オプション） | P1 | Planned |
| ブラウザローカル LLM 設定 | P1 | Planned |

## Cross-Cutting / 横断機能

| Feature | Work Units | Notes |
|---|---|---|
| 認証 (Supabase Auth) | All | Email + OAuth |
| 検索 (Cmd+K) | All | 横断検索 |
| 通知 | Tasks, Research | In-app + email |
| 監査ログ | Settings | Admin only |
| リアルタイム更新 | Projects, Tasks | Supabase Realtime |

## Explicitly Excluded / 明示的除外

| Feature | Reason |
|---|---|
| 全画面 AI チャット | ビジネス OS ではない |
| KPI ダッシュボード | 巨大 KPI カード禁止 |
| 機能カタログ / AI Hub | 機能名ナビ禁止 |
| Firecrawl 直接統合 | Interface only, no API calls |

## Related / 関連

- [Product Definition](./product-definition.md)
- [System Architecture](../architecture/system-architecture.md)
