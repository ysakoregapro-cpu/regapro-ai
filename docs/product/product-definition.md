# Product Definition / プロダクト定義

## One-Liner / 一行定義

**Regapro AI** — 営業・案件管理・調査・成果物作成を統合する **ビジネス OS（Business OS）**。

## What It Is / それは何か

| Is | Is Not |
|---|---|
| 案件中心の作業環境 | AI チャットアプリ |
| 調査→成果物のワークフロー | 汎用 ChatGPT ラッパー |
| 組織向け B2B SaaS | 個人向け AI ツール |
| AI 支援付き業務ソフト | AI 機能のカタログ展示 |

## Problem Statement / 課題

営業・コンサル・PM は以下を **別ツール** で行っている:

1. CRM（顧客・案件管理）
2. タスク管理
3. Web 調査（タブ地獄）
4. ドキュメント作成（Word/Notion）
5. AI ツール（ChatGPT 等）

→ コンテキストが分断され、調査結果が成果物に反映されにくい。

## Solution / 解決策

Regapro AI は **案件（Project）** を中心に:

- タスク管理
- 調査（Research）— ソース管理付き
- 成果物（Artifact）— 提案書、議事録等
- AI 支援 — 各作業に **埋め込み**（チャット単体ではない）

## Core Entities / コアエンティティ

```
Organization
├── Members (roles)
├── Customers（顧客）
├── Projects（案件）
│   ├── Tasks（タスク）
│   ├── ResearchSessions（調査）
│   └── Artifacts（成果物）
└── Settings
```

## Key Differentiators / 差別化

1. **Work-unit IA** — 機能名ではなく作業単位で整理
2. **Research → Artifact pipeline** — 調査結果が成果物に構造的に反映
3. **Optional external AI** — 外部 AI API なしでも基本動作（ブラウザローカル LLM 対応）
4. **Provider architecture** — 調査/AI/ストレージを差し替え可能
5. **Professional UI** — AI demo 美学を避けた業務ソフト UI

## Target Market / ターゲット

- 日本の中小〜中堅 B2B 企業
- 営業チーム、コンサルタント、プロジェクトマネージャー
- 10–500 名規模の組織

## Business Model (Planned) / ビジネスモデル（予定）

- 組織単位のサブスクリプション
- メンバー数 + ストレージ + 外部 AI 利用量（オプション）

## Success Criteria / 成功基準

- ユーザーが Regapro AI を「チャットツール」ではなく「仕事の場」として認識
- 案件あたりの成果物作成時間短縮
- 調査ソースの再利用率

## Related / 関連

- [User Personas](./user-personas.md)
- [Feature Map](./feature-map.md)
- [Product Experience](../design/product-experience.md)
