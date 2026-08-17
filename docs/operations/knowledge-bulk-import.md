# Bulk Knowledge Import

Knowledge Factory を置き換えない。CLI は **Candidate → Review Inbox** までの正式な大量投入入口。自動 Publish しない。

会社 Knowledge 本文と Secret は repository に置かない。投入ディレクトリは `.local/`（gitignore）。

## Domain と Security

| 軸 | 意味 | 例 |
|---|---|---|
| Domain | どの質問・retrieval で参照するか | `recruitment` / `staffing` / `telecom` |
| Clearance | 誰が見る権限を持つか | L1 `company` / L2 `people` / L3 `executive` |
| Visibility | 公開範囲 | `organization` / `restricted` / `private` |

Domain から clearance を推定しない。通常業務 Knowledge は domain が事業領域でも L1 + organization でよい。people / management でも、情報の機密性に応じて L2 / L3 / restricted を明示する。

個人プロフィール（役職・肩書・個人的価値観）は一般 Knowledge にしない。原則は「RegaloProfessional AI Operating Principles」のように一般化する。Expert Q&A の人物名は source metadata に残してよい。

## CLI

```bash
npm run build:packages
npm run knowledge:import -- ".\.local\knowledge-import\current-seed" --dry-run
npm run knowledge:import -- ".\.local\knowledge-import\current-seed"
```

認証は `REGAPRO_KNOWLEDGE_IMPORT_EMAIL` / `REGAPRO_KNOWLEDGE_IMPORT_PASSWORD`（knowledge:write ユーザー）。JWT + RLS。`service_role` では書かない。

`--dry-run` は DB / Storage を変更しない。件数集計のみ。本文と Secret は terminal に出さない。

## Manifest

JSON のみ（YAML 依存を増やさない）。ディレクトリ直下の `manifest.json`。

例: `docs/operations/knowledge-import-example/`

各 item:

- `id`, `title`, `file` または `content`
- `importMode`: `structured` | `source` | `qa`
- `domains[]`, `clearanceLevel` (1/2/3 または `company`/`people`/`executive`)
- `visibility`
- optional: `departmentId`, `projectId`, `candidateType`, `factStatus`, `isCurrent`, `sourceDate`, `validFrom`, `validUntil`, `sourceQuality`, `tags[]`, `authoritativeSeed`
- qa: `question`, `answer`, optional `expertName`

不明 Domain、不正 clearance、欠落 file、重複 id は write 前に失敗する。

## Import mode

| mode | 動き |
|---|---|
| `structured` | 1 manifest item → 1 Candidate。LLM で1文ずつ分割しない。retrieval chunk は Publish 後 |
| `source` | 既存 Factory: Source → Job → Extractor → Candidate 群。CLI は pending job を作り、処理状況から抽出する |
| `qa` | 1 Q&A → 1 Candidate。人物名は source metadata |

`authoritative_seed` + `structured` が現在正本。`sourceQuality` を高くする。古い情報は消さない。conflict / supersession は Review へ。

## Idempotency

再実行しても大量重複しない。判定は `manifest item id` / `content hash` / `source checksum`。既存と duplicate なら skip。

## Current Authoritative Seed v2 の投入手順

1. `.local/knowledge-import/current-seed/` を作る（commit しない）  
2. 各 Knowledge を markdown 等のローカルファイルにする。個人プロフィールではなく運用原則へ一般化する  
3. `manifest.json` を書く。Domain と Clearance を独立に指定。現在正本は `importMode: "structured"`, `authoritativeSeed: true`, `sourceQuality: 0.95`  
4. `npm run build:packages`  
5. dry-run で invalid / duplicate / conflict 件数を確認  
6. apply。Review Inbox に Candidate が並ぶ  
7. 人間が Approve して Publish。`--approve` は今回ない  

既存の手動投入 Source は勝手に消さない。個人情報・誤 Domain・過剰分割は Review で Reject する。
