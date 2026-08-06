# セキュリティインシデント（機密）

疑われる権限外開示が発生した場合:

1. 対象 Thread / Knowledge の Visibility を restricted または非公開に変更（人手）
2. 監査ケースを開く
3. AccessContext / AuditLog を確認（本文フルダンプは避ける）
4. Clearance Override の見直し
5. リモートへの破壊的 reset は行わない
