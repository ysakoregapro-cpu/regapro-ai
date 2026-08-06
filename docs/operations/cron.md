# Cron / 定期実行

Regapro AI の定期実行ジョブ設定。Supabase pg_cron または外部 cron サービスを使用。

## Job Inventory / ジョブ一覧

| Job | Schedule | Description | Runner |
|---|---|---|---|
| `cleanup-stale-research` | `0 */6 * * *` | Failed/stale research sessions → failed | pg_cron |
| `audit-log-retention` | `0 3 * * 0` | Delete audit logs > 90 days | pg_cron |
| `task-due-reminder` | `0 8 * * 1-5` | Email reminders for due tasks | Edge Function |
| `backup-verify` | `0 4 * * *` | Verify latest backup integrity | External cron |

## pg_cron Setup / pg_cron 設定

Enable in Supabase Dashboard → Database → Extensions → `pg_cron`.

```sql
-- Enable extension
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Cleanup stale research sessions (running > 1 hour)
SELECT cron.schedule(
  'cleanup-stale-research',
  '0 */6 * * *',
  $$
    UPDATE research_sessions
    SET status = 'failed', error_message = 'Timeout: session exceeded 1 hour'
    WHERE status = 'running'
      AND created_at < now() - interval '1 hour';
  $$
);

-- Audit log retention (90 days)
SELECT cron.schedule(
  'audit-log-retention',
  '0 3 * * 0',
  $$
    DELETE FROM audit_logs
    WHERE created_at < now() - interval '90 days';
  $$
);
```

## Edge Function Cron / Edge Function 定期実行

Supabase Dashboard → Edge Functions → Schedule:

```typescript
// supabase/functions/task-due-reminder/index.ts
import { createClient } from "@supabase/supabase-js";

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { data: tasks } = await supabase
    .from("tasks")
    .select("*, projects(name), members(email)")
    .eq("status", "todo")
    .eq("due_date", new Date().toISOString().split("T")[0]);

  // Send reminders (email service integration)
  return new Response(JSON.stringify({ sent: tasks?.length ?? 0 }));
});
```

Schedule: `0 8 * * 1-5` (weekdays 8am JST).

## External Cron (API endpoint) / 外部 Cron

For Vercel/hosted deployments without pg_cron:

```typescript
// apps/web/src/app/api/cron/cleanup/route.ts
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Run cleanup logic via Application Service
  return NextResponse.json({ ok: true });
}
```

Vercel Cron (vercel.json):

```json
{
  "crons": [
    {
      "path": "/api/cron/cleanup",
      "schedule": "0 */6 * * *"
    }
  ]
}
```

## Monitoring / 監視

- pg_cron: `SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 20;`
- Log all cron executions to `audit_logs`
- Alert on consecutive failures (3+)

## Security / セキュリティ

- Cron endpoints protected by `CRON_SECRET`
- pg_cron runs as postgres superuser — limit to safe SQL
- Edge Functions use `service_role` — no user context
- Never expose cron URLs or secrets to client

## Related / 関連

- [Environment Variables](./environment-variables.md)
- [Backup and Recovery](./backup-and-recovery.md)
