# 機密情報モデル（Confidentiality Model）

情報の機密度（ConfidentialityLevel）と共有範囲（Visibility）を分離する。

## ConfidentialityLevel

| key | rank | UI |
|---|---|---|
| company | 1 | 全社 |
| people | 2 | 人事・管理 |
| executive | 3 | 経営戦略 |

比較は rank で行う。主要な一般UIには「Level」表記を出さない。

## Visibility

`private` / `participants` / `project` / `department` / `organization` / `restricted`

Level 3 を選んでも経営戦略部全体へ自動共有しない。新規チャット既定は `private`。

## 部署既定 Clearance

| department key | 最大 |
|---|---|
| sales | company |
| people | people |
| executive_strategy | executive |

`organization_memberships.clearance_override` がある場合のみ上書き（`clearance:manage` のみ変更可。自己変更不可）。

## 原則

- 権限外データを取得してから隠すことは禁止
- RLS が正本、Application Service でも再検証
- `conversation:audit` は経営戦略権限へ自動付与しない
