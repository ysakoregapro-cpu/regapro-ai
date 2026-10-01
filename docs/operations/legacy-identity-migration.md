# Legacy Identity Migration / 旧システム同一性の移行

旧・経費 / 売上の人物を `staff_id` へ安全に対応付け、承認後にのみ個人履歴を公開する手順。

## 原則 / Principles

1. **承認済み対応表だけが移行根拠** — `migration_approved_identities`
2. メール一致・Auth ID 一致・社員番号一致は **候補（proposed）のみ**。個人公開しない
3. `--confirm-email-matches` は **廃止**（指定すると importer が即拒否）
4. fixture staff（`record_kind=fixture` / `RLSFIX*`）へは **絶対に結ばない**
5. 未確認人物へログイン招待・業務ロールを付けない
6. 旧経費と旧売上の同名は **別人の可能性**を残す（別 source_system の行として承認）
7. 旧 PJ は SELECT のみ

## テーブル

| オブジェクト | 役割 |
|---|---|
| `staff.record_kind` | `operational` / `fixture` / `legacy_pending` |
| `staff.affiliation_kind` | `employee` / `left` / `external` / `test` / `unknown` |
| `migration_approved_identities` | 人が承認した external_user_id → staff_id |
| `migration_identity_matches` | バッチごとの提案ログ（確定根拠にしない） |
| `migration_import_batches.batch_purpose` | `import` / `verification` / `fail_inject` |
| `migration_source_record_current` | 出典 ID 単位の最新状態（822 行 ≠ 13/191 一意） |
| `expense_applications.reviewed_by_*` | 審査者未対応でも履歴 snapshot |
| `personal_sales_cases.migration_hold_reason` | 例: `no_allocations`（個人公開しない） |

## 人物確認フロー（ログインなし）

1. `node scripts/_phase81-person-review-table.mjs --org-id <org>`  
   → `tmp/legacy-import/_restricted/person_mapping_review.json`（gitignore）
2. レビュー表で各 personKey について確認:
   - 経費 profile と売上 member が同一人物か
   - 所属区分（在籍 / 退職 / 外部 / テスト）
   - 紐づける operational staff（無ければ `legacy_pending` shell を作成。fixture 禁止）
3. 承認後のみ INSERT:

```sql
INSERT INTO migration_approved_identities (
  org_id, source_system, external_user_id, staff_id, affiliation_kind, review_label, evidence_notes
) VALUES (
  '<org>', 'legacy_expense', '<profile_uuid>', '<staff_uuid>', 'employee', 'P1 expense', 'manual review'
);
-- 売上側は source_system='legacy_sales' で別行（同名・別人の余地を残す）
```

4. 招待・ロールは別手順。承認済みでも自動招待しない。

## 取り込み

```bash
# dry-run（公開ゼロ想定 until approved）
node scripts/legacy-expense-sales-import.mjs --entity expense --org-id <org> --dry-run --source-dir tmp/legacy-import/expense
node scripts/legacy-expense-sales-import.mjs --entity sales --org-id <org> --dry-run --source-dir tmp/legacy-import/sales

# apply（承認済み対応がある人物の行だけ import）
node scripts/legacy-expense-sales-import.mjs --entity expense --org-id <org> --apply --source-dir tmp/legacy-import/expense
node scripts/legacy-expense-sales-import.mjs --entity sales --org-id <org> --apply --source-dir tmp/legacy-import/sales
```

- 配賦なし売上 8 件: quarantine + `migration_hold_reason=no_allocations`。管理者台帳で追跡、個人売上としては非公開
- 旧 30/70 配賦 snapshot は再計算しない
- 領収書 path は保持、コピーは別フェーズ（deferred）

## 台帳の見方

- `migration_source_records` 行数は検証 batch を含む（現状数百行）
- 一意出典: expense 13 / sales 191 → view `migration_source_record_current`
- 試験 batch を消す場合: 出典 JSON の hash と `batch_purpose` を証明してから verification/fail_inject のみ削除。`import` で imported の実データは消さない

```bash
node scripts/_phase81-migration-ledger.mjs --org-id <org>
```

## 禁止

- メール一致だけで `migration_approved_identities` を埋める
- 3 PJ 共通メールの「テスト申請者」を酒匂さんへ自動結合
- fixture への承認マップ
- 旧 DB への書き込み
