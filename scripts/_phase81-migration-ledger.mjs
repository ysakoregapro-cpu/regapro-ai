/**
 * Summarize migration batches vs unique source records (no PII).
 * Usage: node scripts/_phase81-migration-ledger.mjs --org-id <uuid>
 */
import { createClient } from "@supabase/supabase-js";
import { loadEnvFiles, requireEnv } from "./rls-integration/lib.mjs";

loadEnvFiles();
const args = process.argv.slice(2);
const orgId =
  args[args.indexOf("--org-id") + 1] ||
  "d381bef7-768a-4325-a21e-f0b606e67ec2";
const { url, secret } = requireEnv();
const db = createClient(url, secret, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: batches, error: bErr } = await db
  .from("migration_import_batches")
  .select(
    "id, source_system, entity_kind, label, status, dry_run, batch_purpose, total_records, matched_records, failed_records, created_at",
  )
  .eq("org_id", orgId)
  .order("created_at", { ascending: false })
  .limit(50);
if (bErr) throw bErr;

const { count: recordN } = await db
  .from("migration_source_records")
  .select("id", { count: "exact", head: true });

const { data: current, error: cErr } = await db
  .from("migration_source_record_current")
  .select("source_system, entity_kind, record_status, batch_purpose")
  .eq("org_id", orgId);
if (cErr && !/does not exist|schema cache/i.test(cErr.message ?? "")) throw cErr;

const byEntity = {};
for (const r of current ?? []) {
  const k = `${r.source_system}/${r.entity_kind}`;
  byEntity[k] = byEntity[k] ?? { n: 0, byStatus: {}, byPurpose: {} };
  byEntity[k].n += 1;
  byEntity[k].byStatus[r.record_status] =
    (byEntity[k].byStatus[r.record_status] ?? 0) + 1;
  byEntity[k].byPurpose[r.batch_purpose] =
    (byEntity[k].byPurpose[r.batch_purpose] ?? 0) + 1;
}

const purposeCounts = {};
for (const b of batches ?? []) {
  const p = b.batch_purpose ?? "unknown";
  purposeCounts[p] = (purposeCounts[p] ?? 0) + 1;
}

console.log(
  JSON.stringify(
    {
      orgIdPrefix: orgId.slice(0, 8),
      migration_source_records_total: recordN,
      unique_current_n: (current ?? []).length,
      unique_by_entity: byEntity,
      batches_listed: (batches ?? []).length,
      batches_by_purpose: purposeCounts,
      recent_batches: (batches ?? []).slice(0, 15).map((b) => ({
        idPrefix: b.id.slice(0, 8),
        source_system: b.source_system,
        entity_kind: b.entity_kind,
        status: b.status,
        dry_run: b.dry_run,
        batch_purpose: b.batch_purpose ?? null,
        total_records: b.total_records,
        matched_records: b.matched_records,
        failed_records: b.failed_records,
        created_at: b.created_at,
        labelPrefix: String(b.label ?? "").slice(0, 40),
      })),
      note: "Unique expense/sales sources should be 13/191; row totals include verification batches",
    },
    null,
    2,
  ),
);
