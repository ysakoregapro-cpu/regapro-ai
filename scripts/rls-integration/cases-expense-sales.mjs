/**
 * Phase 8 RLS/ACL probes for expense + personal sales (JWT + anon).
 */
import { createAnonClient } from "./lib.mjs";

async function roleIdByKey(admin, key) {
  const { data, error } = await admin
    .from("roles")
    .select("id")
    .is("org_id", null)
    .eq("key", key)
    .is("deleted_at", null)
    .maybeSingle();
  if (error || !data) throw new Error(`role ${key}: ${error?.message ?? "missing"}`);
  return data.id;
}

export async function expenseSalesTablesReady(admin) {
  const { error } = await admin.from("expense_applications").select("id").limit(1);
  if (error) return { ready: false, missing: "expense_applications" };
  const { error: sErr } = await admin.from("personal_sales_cases").select("id").limit(1);
  if (sErr) return { ready: false, missing: "personal_sales_cases" };
  return { ready: true };
}

export async function setupExpenseSalesFixtures(fx, platform) {
  const { admin, ctx, runId } = fx;
  const orgId = ctx.org.id;
  const roles = {
    expenseSubmit: await roleIdByKey(admin, "platform_expense_submitter"),
    expenseManage: await roleIdByKey(admin, "platform_expense_manager"),
    salesView: await roleIdByKey(admin, "platform_sales_viewer"),
    salesManage: await roleIdByKey(admin, "platform_sales_manager"),
  };

  // sales_company → expense submitter + sales viewer
  await admin.from("staff_role_assignments").insert({
    org_id: orgId,
    staff_id: platform.staffSales,
    role_id: roles.expenseSubmit,
    scope_type: "self",
  });
  await admin.from("staff_role_assignments").insert({
    org_id: orgId,
    staff_id: platform.staffSales,
    role_id: roles.salesView,
    scope_type: "self",
  });

  // admin_fixture already platform_admin; also grant expense/sales manage for explicit checks
  await admin.from("staff_role_assignments").insert({
    org_id: orgId,
    staff_id: platform.staffAdmin,
    role_id: roles.expenseManage,
  });
  await admin.from("staff_role_assignments").insert({
    org_id: orgId,
    staff_id: platform.staffAdmin,
    role_id: roles.salesManage,
  });

  return { orgId, runId, roles, ids: [] };
}

export async function cleanupExpenseSalesFixtures(admin, es) {
  if (!es?.ids?.length) return;
  for (const id of es.ids) {
    await admin.from("expense_application_versions").delete().eq("application_id", id);
    await admin.from("expense_events").delete().eq("entity_id", id);
    await admin.from("expense_applications").delete().eq("id", id);
  }
  if (es.salesCaseIds?.length) {
    for (const id of es.salesCaseIds) {
      await admin.from("personal_sales_allocations").delete().eq("case_id", id);
      await admin.from("personal_sales_cases").delete().eq("id", id);
    }
  }
}

export async function runExpenseSalesCases(reporter, fx, platform, es, env) {
  const submitter = fx.users.sales_company;
  const manager = fx.users.admin_fixture;
  const outsider = fx.users.no_membership;
  const anon = createAnonClient(env.url, env.anon);
  es.salesCaseIds = [];

  const cats = await submitter.client
    .from("expense_categories")
    .select("id, code")
    .eq("org_id", es.orgId)
    .limit(1);
  if (!cats.error && (cats.data ?? []).length > 0) {
    reporter.pass("expense categories readable by submitter", cats.data[0].code);
  } else {
    reporter.fail("expense categories readable by submitter", cats.error?.message ?? "empty");
    return;
  }

  const anonCats = await anon.from("expense_categories").select("id").limit(1);
  if (!anonCats.error && (anonCats.data ?? []).length === 0) {
    reporter.pass("anon denied expense_categories", "empty");
  } else if (anonCats.error) {
    reporter.pass("anon denied expense_categories", anonCats.error.message);
  } else {
    reporter.fail("anon denied expense_categories", "rows returned");
  }

  const draft = await submitter.client.rpc("upsert_expense_application_draft", {
    p_application_id: null,
    p_staff_id: null,
    p_application_type: "after",
    p_category_id: cats.data[0].id,
    p_amount_yen: 1500,
    p_expense_date: "2026-09-01",
    p_description: `[RLSFIX:${es.runId}] expense draft`,
  });
  if (draft.error || !draft.data?.id) {
    reporter.fail("expense draft create", draft.error?.message ?? "no id");
    return;
  }
  es.ids.push(draft.data.id);
  reporter.pass("expense draft create", draft.data.id.slice(0, 8));

  const submitted = await submitter.client.rpc("submit_expense_application", {
    p_application_id: draft.data.id,
  });
  if (!submitted.error && submitted.data?.status === "pending") {
    reporter.pass("expense submit", "pending");
  } else {
    reporter.fail("expense submit", submitted.error?.message ?? submitted.data?.status);
  }

  const cross = await outsider.client
    .from("expense_applications")
    .select("id")
    .eq("id", draft.data.id);
  if ((cross.data ?? []).length === 0) {
    reporter.pass("outsider denied expense application", "empty");
  } else {
    reporter.fail("outsider denied expense application", "row visible");
  }

  const approved = await manager.client.rpc("approve_expense_application", {
    p_application_id: draft.data.id,
  });
  if (!approved.error && approved.data?.status === "approved") {
    reporter.pass("expense approve by manager", "approved");
  } else {
    reporter.fail("expense approve by manager", approved.error?.message ?? "not approved");
  }

  const anonRpc = await anon.rpc("submit_expense_application", {
    p_application_id: draft.data.id,
  });
  if (anonRpc.error) {
    reporter.pass("anon denied expense RPC", anonRpc.error.message);
  } else {
    reporter.fail("anon denied expense RPC", "succeeded");
  }

  const salesCase = await manager.client.rpc("create_personal_sales_case", {
    p_occurred_on: "2026-09-15",
    p_title: `[RLSFIX:${es.runId}] sales case`,
    p_total_amount_yen: 10000,
    p_note: "probe",
    p_staff_id: platform.staffSales,
    p_allocations: [
      { staffId: platform.staffSales, shareRateBps: 10000, amountYen: 10000 },
    ],
    p_allocation_rule_version_id: null,
  });
  if (salesCase.error || !salesCase.data?.id) {
    reporter.fail("personal sales case create", salesCase.error?.message ?? "no id");
    return;
  }
  es.salesCaseIds.push(salesCase.data.id);
  reporter.pass("personal sales case create", salesCase.data.id.slice(0, 8));

  const own = await submitter.client
    .from("personal_sales_cases")
    .select("id, total_amount_yen, case_profit_incl_yen")
    .eq("id", salesCase.data.id);
  if ((own.data ?? []).length === 1) {
    reporter.pass("sales viewer reads own matched case", "ok");
  } else {
    reporter.fail("sales viewer reads own matched case", own.error?.message ?? "missing");
  }

  const other = await outsider.client
    .from("personal_sales_cases")
    .select("id")
    .eq("id", salesCase.data.id);
  if ((other.data ?? []).length === 0) {
    reporter.pass("outsider denied personal sales case", "empty");
  } else {
    reporter.fail("outsider denied personal sales case", "visible");
  }

  const anonSales = await anon.from("personal_sales_cases").select("id").limit(1);
  if (anonSales.error || (anonSales.data ?? []).length === 0) {
    reporter.pass("anon denied personal_sales_cases", anonSales.error?.message ?? "empty");
  } else {
    reporter.fail("anon denied personal_sales_cases", "rows returned");
  }
}
