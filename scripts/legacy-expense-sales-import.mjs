/**
 * Phase 8 legacy expense / sales import (dry-run default).
 * Never writes to legacy Supabase projects. No display-name-only matching.
 * Does not invent current actors as historical approvers/payers.
 *
 * Env (new app): via scripts/rls-integration/lib.mjs
 * Legacy RO:
 *   LEGACY_EXPENSE_URL / LEGACY_EXPENSE_SERVICE_ROLE_KEY
 *   LEGACY_SALES_URL / LEGACY_SALES_SERVICE_ROLE_KEY
 *
 * Usage:
 *   node scripts/legacy-expense-sales-import.mjs --entity expense --dry-run
 *   node scripts/legacy-expense-sales-import.mjs --entity sales --dry-run
 *   node scripts/legacy-expense-sales-import.mjs --entity expense --apply --org-id <uuid>
 */
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { loadEnvFiles, requireEnv } from "./rls-integration/lib.mjs";

loadEnvFiles();

const args = process.argv.slice(2);
const argVal = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
};
const entity = argVal("--entity") ?? "expense";
const dryRun = !args.includes("--apply");
const orgIdArg = argVal("--org-id");

function client(url, key) {
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function hashPayload(obj) {
  return createHash("sha256").update(JSON.stringify(obj)).digest("hex");
}

function prefix(id) {
  return typeof id === "string" ? id.slice(0, 8) : "????";
}

function normalizeCode(v) {
  if (typeof v !== "string") return "";
  return v.trim().toLowerCase();
}

function rateToBps(rate) {
  const n = Number(rate);
  if (!Number.isFinite(n)) return 0;
  if (n <= 1) return Math.round(n * 10000);
  if (n <= 100) return Math.round(n * 100);
  return Math.round(n);
}

function yenFromNumeric(v) {
  if (v == null) return 0;
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n);
}

const { url, secret } = requireEnv();
const newDb = client(url, secret);

const { data: staffRows, error: staffErr } = await newDb
  .from("staff")
  .select("staff_id, staff_no, status, org_id");
if (staffErr) throw staffErr;

const { data: identityRows, error: idErr } = await newDb
  .from("staff_identities")
  .select("staff_id, identity_type, source_system, external_user_id, auth_user_id, metadata");
if (idErr) throw idErr;

const byStaffNo = new Map();
const byAuth = new Map();
const byLegacyExternal = new Map();
for (const s of staffRows ?? []) {
  byStaffNo.set(normalizeCode(s.staff_no), s);
}
for (const i of identityRows ?? []) {
  if (i.auth_user_id) byAuth.set(i.auth_user_id, i.staff_id);
  if (i.source_system && i.external_user_id) {
    byLegacyExternal.set(`${i.source_system}:${i.external_user_id}`, i.staff_id);
  }
}

const orgId =
  orgIdArg ??
  (staffRows ?? []).find((s) => s.status === "active")?.org_id ??
  null;
if (!orgId) {
  console.log(JSON.stringify({ error: "org_id unresolved" }, null, 2));
  process.exit(1);
}

const systemStaffId =
  (staffRows ?? []).find((s) => s.org_id === orgId && s.status === "active")?.staff_id ?? null;
if (!systemStaffId) {
  console.log(JSON.stringify({ error: "no active staff in org for created_by" }, null, 2));
  process.exit(1);
}

const report = {
  entity,
  dryRun,
  orgIdPrefix: prefix(orgId),
  staffCatalog: {
    staffN: (staffRows ?? []).length,
    identitiesN: (identityRows ?? []).length,
    appAuthN: (identityRows ?? []).filter((i) => i.identity_type === "app_auth" && i.auth_user_id)
      .length,
  },
  identity: {
    unique: 0,
    collision: 0,
    unmatched: 0,
    leftOrSuspended: 0,
  },
  import: {
    sourceN: 0,
    imported: 0,
    skippedHash: 0,
    quarantined: 0,
    excludedSoftDeleted: 0,
    excludedInactive: 0,
  },
  samples: { unique: [], collision: [], unmatched: [], imported: [], quarantined: [] },
};

function resolveStaffCandidates(row) {
  const candidates = new Map();
  const methods = [];
  const authUserId = row.auth_user_id ?? row.authUserId ?? null;
  const loginId = row.login_id ?? row.employee_code ?? row.employeeCode ?? null;
  const externalId = row.id ?? row.profile_id ?? row.member_id ?? null;

  if (authUserId && byAuth.has(authUserId)) {
    candidates.set(byAuth.get(authUserId), "auth_user_id");
    methods.push("auth_user_id");
  }
  if (loginId) {
    const hit = byStaffNo.get(normalizeCode(loginId));
    if (hit) {
      candidates.set(hit.staff_id, "staff_no");
      methods.push("staff_no");
    }
  }
  for (const source of ["legacy_expense", "legacy_sales"]) {
    if (externalId && byLegacyExternal.has(`${source}:${externalId}`)) {
      candidates.set(byLegacyExternal.get(`${source}:${externalId}`), "existing_identity");
      methods.push("existing_identity");
    }
  }
  return { candidates, methods: [...new Set(methods)] };
}

function matchPerson(row, { count = false } = {}) {
  const { candidates, methods } = resolveStaffCandidates(row);
  const list = [...candidates.keys()];
  if (list.length === 1) {
    const staff = (staffRows ?? []).find((s) => s.staff_id === list[0]);
    if (count) {
      if (staff && staff.status !== "active") report.identity.leftOrSuspended += 1;
      report.identity.unique += 1;
      if (report.samples.unique.length < 5) {
        report.samples.unique.push({
          externalPrefix: prefix(String(row.id ?? "")),
          staffPrefix: prefix(list[0]),
          methods,
          staffStatus: staff?.status ?? null,
        });
      }
    }
    return { staffId: list[0], methods };
  }
  if (list.length > 1) {
    if (count) {
      report.identity.collision += 1;
      if (report.samples.collision.length < 5) {
        report.samples.collision.push({
          externalPrefix: prefix(String(row.id ?? "")),
          staffPrefixes: list.map(prefix),
          methods,
        });
      }
    }
    return { staffId: null, methods, collision: true };
  }
  if (count) {
    report.identity.unmatched += 1;
    if (report.samples.unmatched.length < 5) {
      report.samples.unmatched.push({
        externalPrefix: prefix(String(row.id ?? "")),
        hasAuth: Boolean(row.auth_user_id),
        hasLoginId: Boolean(row.login_id),
      });
    }
  }
  return { staffId: null, methods };
}

async function ensureBatch(label) {
  const { data, error } = await newDb
    .from("migration_import_batches")
    .insert({
      org_id: orgId,
      source_system: entity === "expense" ? "legacy_expense" : "legacy_sales",
      entity_kind: entity,
      label,
      dry_run: dryRun,
      created_by_staff_id: systemStaffId,
      status: dryRun ? "validating" : "ready",
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

async function quarantine(batchId, externalId, externalUserId, payload, reason) {
  const contentHash = hashPayload(payload);
  const { data: src, error } = await newDb
    .from("migration_source_records")
    .upsert(
      {
        batch_id: batchId,
        external_record_id: externalId,
        external_user_id: externalUserId,
        payload,
        content_hash: contentHash,
        status: "unmatched",
      },
      { onConflict: "batch_id,external_record_id" },
    )
    .select("id")
    .maybeSingle();
  if (error) throw error;
  await newDb.from("migration_errors").insert({
    batch_id: batchId,
    source_record_id: src?.id ?? null,
    error_code: "UNMATCHED_OR_COLLISION",
    message: reason,
    context: { externalPrefix: prefix(externalId) },
  });
  report.import.quarantined += 1;
  if (report.samples.quarantined.length < 5) {
    report.samples.quarantined.push({ externalPrefix: prefix(externalId), reason });
  }
}

const legacyUrl =
  entity === "expense" ? process.env.LEGACY_EXPENSE_URL : process.env.LEGACY_SALES_URL;
const legacyKey =
  entity === "expense"
    ? process.env.LEGACY_EXPENSE_SERVICE_ROLE_KEY
    : process.env.LEGACY_SALES_SERVICE_ROLE_KEY;

if (!legacyUrl || !legacyKey) {
  report.skipped = true;
  report.reason = `LEGACY_${entity.toUpperCase()}_* env not set`;
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

const legacy = client(legacyUrl, legacyKey);
const batchId = dryRun
  ? null
  : await ensureBatch(`phase8 ${entity} ${new Date().toISOString()}`);
report.batchId = batchId;

if (entity === "expense") {
  const { data: profiles, error: pErr } = await legacy
    .from("profiles")
    .select("id, login_id, is_active, role");
  if (pErr) throw pErr;
  const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));
  for (const p of profiles ?? []) {
    matchPerson({ id: p.id, login_id: p.login_id, auth_user_id: p.id }, { count: true });
  }

  const { data: categories, error: cErr } = await legacy
    .from("expense_categories")
    .select("id, code, name, sort_order, is_active");
  if (cErr) throw cErr;

  const categoryIdByLegacy = new Map();
  if (!dryRun) {
    for (const c of categories ?? []) {
      const code = String(c.code ?? `legacy_${c.id}`);
      const { data: upserted, error: uErr } = await newDb
        .from("expense_categories")
        .upsert(
          {
            org_id: orgId,
            code,
            name: String(c.name ?? code),
            sort_order: Number(c.sort_order ?? 0),
            active: c.is_active !== false,
          },
          { onConflict: "org_id,code" },
        )
        .select("id")
        .single();
      if (uErr) throw uErr;
      categoryIdByLegacy.set(c.id, upserted.id);
    }
  } else {
    for (const c of categories ?? []) categoryIdByLegacy.set(c.id, `dry:${c.id}`);
  }

  const { data: apps, error: aErr } = await legacy.from("expense_applications").select("*");
  if (aErr) throw aErr;
  const { data: versions, error: vErr } = await legacy
    .from("expense_application_versions")
    .select("*");
  if (vErr) throw vErr;
  const { data: events, error: eErr } = await legacy.from("expense_events").select("*");
  if (eErr) throw eErr;

  report.import.sourceN = (apps ?? []).length;
  report.legacyCounts = {
    profiles: (profiles ?? []).length,
    categories: (categories ?? []).length,
    applications: (apps ?? []).length,
    versions: (versions ?? []).length,
    events: (events ?? []).length,
    softDeleted: (apps ?? []).filter((a) => a.deleted_at).length,
    withReceiptPath: (apps ?? []).filter((a) => a.receipt_path).length,
  };

  const versionsByApp = new Map();
  for (const v of versions ?? []) {
    const list = versionsByApp.get(v.application_id) ?? [];
    list.push(v);
    versionsByApp.set(v.application_id, list);
  }

  for (const app of apps ?? []) {
    const profile = profileMap.get(app.applicant_id);
    const person = matchPerson({
      id: app.applicant_id,
      login_id: profile?.login_id,
      auth_user_id: app.applicant_id,
    });
    const externalId = String(app.id);
    const payload = {
      application: app,
      versions: versionsByApp.get(app.id) ?? [],
      events: (events ?? []).filter((e) => e.application_id === app.id),
    };
    const contentHash = hashPayload(payload);

    if (!person.staffId || person.collision) {
      if (!dryRun && batchId) {
        await quarantine(
          batchId,
          externalId,
          String(app.applicant_id ?? ""),
          payload,
          person.collision ? "identity_collision" : "identity_unmatched",
        );
      } else {
        report.import.quarantined += 1;
      }
      continue;
    }

    const statusMap = { pending: "pending", approved: "approved", returned: "returned" };
    const status = statusMap[app.status] ?? "pending";
    const categoryId = categoryIdByLegacy.get(app.category_id);
    if (!categoryId) {
      if (!dryRun && batchId) {
        await quarantine(batchId, externalId, String(app.applicant_id ?? ""), payload, "category_missing");
      } else report.import.quarantined += 1;
      continue;
    }

    if (dryRun) {
      report.import.imported += 1;
      continue;
    }

    const { data: existing } = await newDb
      .from("expense_applications")
      .select("id, migration_content_hash")
      .eq("org_id", orgId)
      .eq("migration_external_id", externalId)
      .maybeSingle();
    if (existing?.migration_content_hash === contentHash) {
      report.import.skippedHash += 1;
      continue;
    }

    // Map reviewer only when identity uniquely resolves; never invent current operator.
    const reviewer = app.reviewed_by
      ? matchPerson({ id: app.reviewed_by, auth_user_id: app.reviewed_by })
      : { staffId: null };
    const approvedBy =
      status === "approved" && reviewer.staffId && !reviewer.collision ? reviewer.staffId : null;
    const returnedBy =
      status === "returned" && reviewer.staffId && !reviewer.collision ? reviewer.staffId : null;

    const row = {
      org_id: orgId,
      staff_id: person.staffId,
      status,
      current_version_no: Number(app.version ?? 1),
      application_type: app.application_type === "advance" ? "advance" : "after",
      category_id: categoryId,
      amount_yen: yenFromNumeric(app.amount),
      expense_date: app.expense_date,
      description: String(app.description ?? ""),
      after_reason: app.after_reason ?? null,
      legacy_receipt_path: app.receipt_path ?? null,
      legacy_receipt_migrated: false,
      submitted_at: app.submitted_at ?? null,
      submitted_by_staff_id: person.staffId,
      returned_at: status === "returned" ? app.reviewed_at ?? null : null,
      returned_by_staff_id: returnedBy,
      return_reason: status === "returned" ? app.admin_note ?? null : null,
      approved_at: status === "approved" ? app.reviewed_at ?? null : null,
      approved_by_staff_id: approvedBy,
      created_by_staff_id: person.staffId,
      created_at: app.created_at ?? new Date().toISOString(),
      updated_at: app.updated_at ?? new Date().toISOString(),
      deleted_at: app.deleted_at ?? null,
      deleted_by_staff_id: null,
      migration_import_batch_id: batchId,
      migration_external_id: externalId,
      migration_content_hash: contentHash,
    };

    const { data: upserted, error: upErr } = await newDb
      .from("expense_applications")
      .upsert(row, { onConflict: "org_id,migration_external_id" })
      .select("id")
      .single();
    if (upErr) throw upErr;

    await newDb.from("expense_application_versions").delete().eq("application_id", upserted.id);
    const vers = (versionsByApp.get(app.id) ?? []).sort((a, b) => a.version - b.version);
    for (const v of vers) {
      await newDb.from("expense_application_versions").insert({
        application_id: upserted.id,
        org_id: orgId,
        version_no: Number(v.version),
        application_type: v.application_type === "advance" ? "advance" : "after",
        category_id: categoryIdByLegacy.get(v.category_id) ?? categoryId,
        amount_yen: yenFromNumeric(v.amount),
        expense_date: v.expense_date,
        description: String(v.description ?? ""),
        created_by_staff_id: person.staffId,
        created_at: v.submitted_at ?? app.created_at ?? new Date().toISOString(),
      });
    }

    for (const ev of payload.events) {
      const actor = ev.actor_id
        ? matchPerson({ id: ev.actor_id, auth_user_id: ev.actor_id })
        : { staffId: null };
      await newDb.from("expense_events").insert({
        org_id: orgId,
        action: `legacy_${ev.event_type}`,
        entity_type: "expense_application",
        entity_id: upserted.id,
        actor_staff_id: actor.staffId && !actor.collision ? actor.staffId : null,
        subject_staff_id: person.staffId,
        metadata: {
          legacy_event_id: ev.id,
          from_status: ev.from_status,
          to_status: ev.to_status,
          note: ev.note,
          actor_unresolved: !(actor.staffId && !actor.collision),
        },
        created_at: ev.created_at ?? new Date().toISOString(),
      });
    }

    await newDb.from("migration_source_records").upsert(
      {
        batch_id: batchId,
        external_record_id: externalId,
        external_user_id: String(app.applicant_id ?? ""),
        payload: { contentHash, status },
        content_hash: contentHash,
        status: "imported",
      },
      { onConflict: "batch_id,external_record_id" },
    );

    report.import.imported += 1;
    if (report.samples.imported.length < 5) {
      report.samples.imported.push({
        externalPrefix: prefix(externalId),
        staffPrefix: prefix(person.staffId),
        status,
        receiptPending: Boolean(app.receipt_path),
      });
    }
  }
} else if (entity === "sales") {
  const { data: members, error: mErr } = await legacy
    .from("members")
    .select("id, auth_user_id, is_active, role");
  if (mErr) throw mErr;
  const memberMap = new Map((members ?? []).map((m) => [m.id, m]));
  for (const m of members ?? []) {
    matchPerson({ id: m.id, auth_user_id: m.auth_user_id }, { count: true });
  }

  const { data: sales, error: sErr } = await legacy.from("sales_records").select("*");
  if (sErr) throw sErr;
  const { data: allocs, error: alErr } = await legacy.from("sales_allocations").select("*");
  if (alErr) throw alErr;
  const { data: axis, error: axErr } = await legacy
    .from("axis_records")
    .select("id, source_sync_id, is_active");
  if (axErr) throw axErr;

  const axisBySync = new Map(
    (axis ?? []).filter((a) => a.source_sync_id).map((a) => [a.source_sync_id, a]),
  );
  const allocsBySales = new Map();
  for (const a of allocs ?? []) {
    const list = allocsBySales.get(a.sales_record_id) ?? [];
    list.push(a);
    allocsBySales.set(a.sales_record_id, list);
  }

  report.import.sourceN = (sales ?? []).length;
  report.legacyCounts = {
    members: (members ?? []).length,
    salesRecords: (sales ?? []).length,
    activeSales: (sales ?? []).filter((s) => s.is_active && !s.deleted_at).length,
    allocations: (allocs ?? []).length,
    axisRecords: (axis ?? []).length,
    salesWithAxisSync: (sales ?? []).filter((s) => s.source_sync_id && axisBySync.has(s.source_sync_id))
      .length,
  };
  report.sourceOfTruth =
    "personal_sales_cases import from sales_records (+ allocation snapshots). axis_records are sync provenance only  Enot double-imported as cases.";

  for (const sr of sales ?? []) {
    if (sr.deleted_at || sr.is_active === false) {
      report.import.excludedInactive += 1;
    }
    const externalId = String(sr.id);
    const rowAllocs = allocsBySales.get(sr.id) ?? [];
    const matchedAllocs = [];
    let collision = false;
    for (const a of rowAllocs) {
      const member = memberMap.get(a.member_id);
      const person = matchPerson({
        id: a.member_id,
        auth_user_id: member?.auth_user_id ?? null,
      });
      if (person.collision) collision = true;
      if (person.staffId) {
        matchedAllocs.push({
          alloc: a,
          staffId: person.staffId,
          methods: person.methods,
        });
      }
    }

    const payload = {
      sales_record: {
        id: sr.id,
        source_sync_id: sr.source_sync_id,
        work_date: sr.work_date,
        is_active: sr.is_active,
        deleted_at: sr.deleted_at,
      },
      allocation_ids: rowAllocs.map((a) => a.id),
      axis: sr.source_sync_id ? { source_sync_id: sr.source_sync_id } : null,
    };
    const contentHash = hashPayload({
      ...payload,
      amounts: {
        invoice_incl: sr.invoice_amount_incl,
        profit: sr.case_profit_incl,
        allocs: rowAllocs.map((a) => ({
          id: a.id,
          rate: a.allocation_rate,
          sales: a.allocated_sales_incl,
          profit: a.allocated_profit_incl,
          type: a.allocation_type,
        })),
      },
    });

    if (matchedAllocs.length === 0 || collision) {
      if (!dryRun && batchId) {
        await quarantine(
          batchId,
          externalId,
          null,
          payload,
          collision ? "allocation_identity_collision" : "no_matched_allocation_person",
        );
      } else report.import.quarantined += 1;
      continue;
    }

    const primary =
      matchedAllocs.find((m) => m.alloc.allocation_type === "case_owner") ?? matchedAllocs[0];

    if (dryRun) {
      report.import.imported += 1;
      continue;
    }

    const { data: existing } = await newDb
      .from("personal_sales_cases")
      .select("id, migration_content_hash")
      .eq("org_id", orgId)
      .eq("migration_external_id", externalId)
      .maybeSingle();
    if (existing?.migration_content_hash === contentHash) {
      report.import.skippedHash += 1;
      continue;
    }

    const titleParts = [sr.client_name, sr.location, sr.work_role].filter(Boolean);
    const caseRow = {
      org_id: orgId,
      staff_id: primary.staffId,
      occurred_on: sr.work_date,
      title: titleParts.join(" / ") || `sales ${prefix(externalId)}`,
      total_amount_yen: yenFromNumeric(sr.invoice_amount_incl),
      case_profit_incl_yen: yenFromNumeric(sr.case_profit_incl),
      status: sr.deleted_at || sr.is_active === false ? "voided" : "active",
      note: null,
      source_ref: {
        legacy_sales_record_id: sr.id,
        source_sync_id: sr.source_sync_id,
        source_sheet: sr.source_sheet,
        source_row: sr.source_row,
        axis_present: Boolean(sr.source_sync_id && axisBySync.has(sr.source_sync_id)),
      },
      created_by_staff_id: systemStaffId,
      created_at: sr.created_at ?? new Date().toISOString(),
      updated_at: sr.updated_at ?? new Date().toISOString(),
      migration_import_batch_id: batchId,
      migration_external_id: externalId,
      migration_content_hash: contentHash,
    };

    const { data: upserted, error: upErr } = await newDb
      .from("personal_sales_cases")
      .upsert(caseRow, { onConflict: "org_id,migration_external_id" })
      .select("id")
      .single();
    if (upErr) throw upErr;

    await newDb.from("personal_sales_allocations").delete().eq("case_id", upserted.id);
    for (const m of matchedAllocs) {
      await newDb.from("personal_sales_allocations").insert({
        case_id: upserted.id,
        org_id: orgId,
        staff_id: m.staffId,
        allocation_type: m.alloc.allocation_type,
        share_rate_bps: rateToBps(m.alloc.allocation_rate),
        amount_yen: yenFromNumeric(m.alloc.allocated_sales_incl),
        allocated_profit_incl_yen: yenFromNumeric(m.alloc.allocated_profit_incl),
        allocation_rule_version_id: null,
        migration_external_id: String(m.alloc.id),
        created_at: m.alloc.created_at ?? new Date().toISOString(),
      });
    }

    await newDb.from("migration_source_records").upsert(
      {
        batch_id: batchId,
        external_record_id: externalId,
        payload: { contentHash, matchedAllocN: matchedAllocs.length },
        content_hash: contentHash,
        status: "imported",
      },
      { onConflict: "batch_id,external_record_id" },
    );

    report.import.imported += 1;
    if (report.samples.imported.length < 5) {
      report.samples.imported.push({
        externalPrefix: prefix(externalId),
        staffPrefix: prefix(primary.staffId),
        allocN: matchedAllocs.length,
      });
    }
  }
} else {
  console.log(JSON.stringify({ error: "entity must be expense|sales" }, null, 2));
  process.exit(1);
}

if (!dryRun && batchId) {
  await newDb
    .from("migration_import_batches")
    .update({
      status: "applied",
      dry_run: false,
      applied_at: new Date().toISOString(),
      total_records: report.import.sourceN,
      matched_records: report.import.imported,
      failed_records: report.import.quarantined,
      notes: JSON.stringify({
        skippedHash: report.import.skippedHash,
        identity: report.identity,
      }),
    })
    .eq("id", batchId);
}

console.log(JSON.stringify(report, null, 2));
