# ホームからアシスタントへの導線

1. 入力検証
2. Membership / 最大情報区分を DB（または dev-sample 正本）から解決
3. 選択された情報区分を検証
4. 機密検知（SecurityClassification）
5. 必要なら引き上げ確認
6. ChatThread + 最初の Message 保存（Idempotency-Key）
7. `/assistant?thread=&started=1` へ遷移し再入力なしで回答開始
8. 失敗時は入力を復元
