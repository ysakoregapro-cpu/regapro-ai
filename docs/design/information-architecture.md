# Information Architecture / 情報設計

## Navigation Model / ナビゲーションモデル

Regapro AI の IA は **作業単位（Work Units）** を軸に設計します。エンジニアリングの機能分割や Provider 名はナビゲーションに使いません。

## Global Navigation / グローバルナビ

```
┌─────────────────────────────────────────────────────┐
│ Logo   今日  案件  顧客  タスク  調査  成果物    [👤] │
└─────────────────────────────────────────────────────┘
```

| Label (JA) | Label (EN) | Route Pattern | Notes |
|---|---|---|---|
| 今日 | Today | `/today` | デフォルトランディング（チャットではない） |
| 案件 | Projects | `/projects`, `/projects/:id` | 案件ライフサイクルの中心 |
| 顧客 | Customers | `/customers`, `/customers/:id` | 取引先マスタ + 関連案件 |
| タスク | Tasks | `/tasks` | 横断タスク一覧 + フィルタ |
| 調査 | Research | `/research`, `/projects/:id/research` | 案件コンテキスト優先 |
| 成果物 | Artifacts | `/artifacts`, `/projects/:id/artifacts` | ドキュメント管理 |
| 設定 | Settings | `/settings/*` | 組織・メンバー・連携 |

## Hierarchy / 階層構造

```
Organization（組織）
└── Project（案件）
    ├── Customer link（顧客）
    ├── Tasks（タスク）
    ├── Research sessions（調査）
    └── Artifacts（成果物）
```

## Page Templates / ページテンプレート

### List View / 一覧

- コンパクトヘッダー（タイトル + フィルタ + Primary アクション 1 つ）
- テーブルまたはコンパクトリスト（カードグリッド禁止）
- ページネーションまたは仮想スクロール（**二重スクロール禁止**）

### Detail View / 詳細

- 左: コンテキスト（メタ情報、ステータス）
- 中央: 主コンテンツ（タスク、調査、成果物）
- 右（desktop）: 補助パネル（アクティビティ、関連リンク）
- Mobile: タブまたはボトムシートで切替（desktop 列の縦積み禁止）

### Editor View / 編集

- フル幅エディタ + 折りたたみ可能なサイドパネル
- 保存状態を常時表示
- AI 支援はインライン（選択テキストへの提案）— 全画面チャットではない

## Labeling Guidelines / ラベリング

### Use / 使う

- 案件、顧客、タスク、調査、成果物、下書き、レビュー、共有
- ステータス: 進行中、保留、完了、下書き

### Avoid in UI / UI で避ける

- Chat, RAG, LLM, Vector, Provider, Repository, Worker
- Firecrawl, SearXNG, Tavily（設定の詳細画面の技術者向けセクションのみ可）

## Search & Command Palette / 検索

- `Cmd/Ctrl + K`: 案件・顧客・タスク・成果物の横断検索
- 最近使った作業単位を優先表示
- 検索結果は作業単位タイプのアイコン + 文脈（所属案件名）付き

## Empty States / 空状態

空状態は **次のアクション** を示す。技術用語や機能一覧は出さない。

```
例: 「案件がまだありません」
    [+ 案件を作成]  ← Primary 1 つ
```

## Related Documents / 関連

- [Interaction Patterns](./interaction-patterns.md)
- [Mobile Patterns](./mobile-patterns.md)
- [Content Guidelines](./content-guidelines.md)
