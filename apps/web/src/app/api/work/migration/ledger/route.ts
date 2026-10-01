import { NextResponse } from "next/server";
import { catchToJson, jsonError } from "@/lib/application/api-errors";
import { withPlatformGuard } from "@/lib/platform/api-guard";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * Migration ledger for staff managers: batch purpose vs unique source current state.
 * No emails/names — prefixes and counts only.
 */
export const GET = withPlatformGuard(
  {
    anyPermissions: ["admin.staff_manage", "employment_terms.manage"],
  },
  async ({ access }) => {
    try {
      if (!access.organizationId) return jsonError("FORBIDDEN");
      const client = await createServerSupabaseClient();
      const orgId = access.organizationId;

      const { data: batchesRaw, error: bErr } = await client
        .from("migration_import_batches")
        .select(
          "id, source_system, entity_kind, label, status, dry_run, batch_purpose, total_records, matched_records, failed_records, created_at",
        )
        .eq("org_id", orgId)
        .order("created_at", { ascending: false })
        .limit(40);
      if (bErr) throw new Error(bErr.message);
      const batches = (batchesRaw ?? []) as Array<Record<string, unknown>>;

      const { data: currentRaw, error: cErr } = await client
        .from("migration_source_record_current")
        .select("source_system, entity_kind, record_status, batch_purpose")
        .eq("org_id", orgId);
      if (cErr && !/does not exist|schema cache/i.test(cErr.message)) {
        throw new Error(cErr.message);
      }
      const current = (currentRaw ?? []) as Array<Record<string, unknown>>;

      const { data: approvedRaw, error: aErr } = await client
        .from("migration_approved_identities")
        .select("source_system, affiliation_kind")
        .eq("org_id", orgId);
      if (aErr && !/does not exist|schema cache/i.test(aErr.message)) {
        throw new Error(aErr.message);
      }
      const approved = (approvedRaw ?? []) as Array<Record<string, unknown>>;

      const uniqueByEntity: Record<
        string,
        { n: number; byStatus: Record<string, number>; byPurpose: Record<string, number> }
      > = {};
      for (const r of current) {
        const k = `${String(r.source_system)}/${String(r.entity_kind)}`;
        uniqueByEntity[k] ??= { n: 0, byStatus: {}, byPurpose: {} };
        uniqueByEntity[k].n += 1;
        const st = String(r.record_status ?? "unknown");
        const pu = String(r.batch_purpose ?? "unknown");
        uniqueByEntity[k].byStatus[st] = (uniqueByEntity[k].byStatus[st] ?? 0) + 1;
        uniqueByEntity[k].byPurpose[pu] = (uniqueByEntity[k].byPurpose[pu] ?? 0) + 1;
      }

      const approvedBySystem: Record<string, number> = {};
      for (const a of approved) {
        const s = String(a.source_system);
        approvedBySystem[s] = (approvedBySystem[s] ?? 0) + 1;
      }

      return NextResponse.json({
        ok: true,
        uniqueCurrentN: current.length,
        uniqueByEntity,
        approvedIdentityN: approved.length,
        approvedBySystem,
        batches: batches.map((b) => ({
          idPrefix: String(b.id).slice(0, 8),
          sourceSystem: b.source_system,
          entityKind: b.entity_kind,
          status: b.status,
          dryRun: b.dry_run,
          batchPurpose: b.batch_purpose ?? null,
          totalRecords: b.total_records,
          matchedRecords: b.matched_records,
          failedRecords: b.failed_records,
          createdAt: b.created_at,
          labelPrefix: String(b.label ?? "").slice(0, 48),
        })),
        notes: [
          "Unique legacy expense applications target: 13",
          "Unique legacy sales records target: 191 (183 with allocations, 8 without)",
          "Row totals in migration_source_records include verification batches",
          "Personal history publishes only via migration_approved_identities",
        ],
      });
    } catch (err) {
      return catchToJson(err);
    }
  },
);
