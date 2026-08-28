# Local Agent / ローカルエージェント

RegaloProfessional Local Agent は、Vercel 上の Web アプリが PC の filesystem に直接触れないための **filesystem / terminal / git bridge** です。任意の `C:\` 全体は読めません。明示許可した Workspace だけです。

## Transport 比較と選択

| 方式 | Vercel→PC | 採用 |
|---|---|---|
| localhost 直結（Vercel から） | 不可 | 禁止 |
| 同一 PC の 127.0.0.1 bridge | 可（開発） | 補助 |
| 素の inbound WebSocket | NAT/Firewall で破綻 | 不採用 |
| Supabase Realtime wakeup | 可 | 将来の補助 |
| **Outbound poll + command queue** | 可 | **Production 主経路** |

Production では Agent がクラウドへ outbound し、署名付きでコマンドを引き取ります。

## 起動

リポジトリルート:

```bash
npm run build:packages
npm run start --workspace=@regapro/local-agent -- serve
```

Workspace を許可:

```bash
npm run start --workspace=@regapro/local-agent -- allow "C:\Users\natan\source\regapro-expense"
npm run start --workspace=@regapro/local-agent -- allow "C:\Users\natan\source\regapro-ai"
```

`C:\` や `/` は拒否します。

設定と秘密鍵は `%USERPROFILE%\.regapro\local-agent\config.json`（mode 600 相当）。**Web UI に秘密鍵は出しません。**

## Pairing / 認証

1. アシスタントまたは API `POST /api/coding/devices` `{ "action": "pair_start" }` で 8 文字コードを発行（10 分、ハッシュ保存）。
2. 端末で `npm run start --workspace=@regapro/local-agent -- pair <CODE>`。Ed25519 公開鍵とコードを `POST /api/coding/pair/redeem`。
3. ユーザーが `{ "action": "pair_confirm", "deviceId" }` で承認。
4. 以降の poll/result は公開鍵検証。短い timestamp + nonce。
5. `{ "action": "revoke", "deviceId" }` で失効。

Local Agent は Supabase `service_role` を保持しません。検証は Vercel 上の Application Service が行います。

組織バインド: device は作成ユーザー + org に紐づきます。他テナントからは見えません（RLS）。

短命の実行認可: コマンドは queued → claimed → done。DANGEROUS は `coding_approvals` 無しでは実行されません。

## 監査

`coding_audit_events` と `coding_runs`（メタデータのみ）。コード全文は残しません。

## Recovery / Uninstall

- 停止: プロセスに SIGINT。
- 鍵ローテ: config.json を削除して再 pair。
- Uninstall: `apps/local-agent` のプロセスを止め、`%USERPROFILE%\.regapro\local-agent` を削除。クラウド側で device を revoke。
- 詰まった queue: ユーザーが run を stop。古い command は claimed 後に破棄可能。

## Troubleshooting

| 症状 | 確認 |
|---|---|
| `WORKSPACE_TOO_BROAD` | `C:\` を許可していないか |
| `WORKSPACE_NOT_ALLOWED` | `allow` した絶対パスとクラウドの root が一致しているか |
| `UNAUTHORIZED_DEVICE` | pair_confirm 済みか、時計ずれ（2 分）、revoke 済みか |
| 貼り付け GAS が失敗扱い | Local Agent 無しでも動く。コードをフェンスで貼る |
| 検証スクリプトが無い | 既存 package.json を改変して test を足していません |

## Desktop / Notebook

`deviceLabel` を `NOTEBOOK` / `DESKTOP` にできます。将来の Device selector はこのラベルを使います。
