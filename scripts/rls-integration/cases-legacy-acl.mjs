/**
 * Phase 3.6 legacy database ACL cases.
 *
 * Skip until 20260928093819_legacy_rpc_acl_hardening.sql is applied.
 * Privilege matrix uses service_role-only regapro_legacy_acl_privileges().
 */
import { createAnonClient } from "./lib.mjs";

const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

const EXPECTED = {
  service_only: { anon: false, authenticated: false, service_role: true },
  rls_helper: { anon: false, authenticated: true, service_role: true },
  owner_only: { anon: false, authenticated: false, service_role: false },
  knowledge_authenticated: { anon: false, authenticated: true, service_role: true },
};

function errorText(error) {
  if (!error) return "";
  return `${error.code ?? ""} ${error.message ?? ""} ${error.details ?? ""}`;
}

function isExecuteDenied(error) {
  if (!error) return false;
  const text = errorText(error).toLowerCase();
  return (
    error.code === "42501" ||
    error.code === "PGRST202" ||
    error.code === "PGRST301" ||
    /permission denied/.test(text) ||
    /could not find the function/.test(text) ||
    /not find the function/.test(text)
  );
}

export async function legacyAclReady(admin) {
  const { data, error } = await admin.rpc("regapro_legacy_acl_privileges");
  if (error) {
    return { ready: false, reason: error.message };
  }
  if (!Array.isArray(data) || data.length === 0) {
    return { ready: false, reason: "empty privilege snapshot" };
  }
  return { ready: true, rows: data };
}

export async function runLegacyAclCases(reporter, fx, env) {
  const readiness = await legacyAclReady(fx.admin);
  if (!readiness.ready) {
    reporter.skip(
      "legacy database ACL cases",
      `apply supabase/migrations/20260928093819_legacy_rpc_acl_hardening.sql first (${readiness.reason})`,
    );
    return;
  }

  const byKind = {
    service_only: [],
    rls_helper: [],
    owner_only: [],
    knowledge_authenticated: [],
  };
  for (const row of readiness.rows) {
    if (byKind[row.kind]) byKind[row.kind].push(row);
  }

  for (const [kind, expected] of Object.entries(EXPECTED)) {
    for (const role of Object.keys(expected)) {
      const rows = byKind[kind] ?? [];
      const mismatch = rows.filter(
        (row) => row.grantee === role && row.can_execute !== expected[role],
      );
      if (rows.length === 0) {
        reporter.fail(`legacy acl ${kind} ${role} EXECUTE`, "no snapshot rows");
        continue;
      }
      if (mismatch.length > 0) {
        reporter.fail(
          `legacy acl ${kind} ${role} EXECUTE=${expected[role]}`,
          mismatch.map((r) => `${r.function_identity}=${r.can_execute}`).join(", "),
        );
      } else {
        reporter.pass(
          `legacy acl ${kind} ${role} EXECUTE=${expected[role]}`,
          `n=${rows.filter((r) => r.grantee === role).length}`,
        );
      }
    }
  }

  const sales = fx.users.sales_company;
  const anonClient = createAnonClient(env.url, env.anon);

  const anonBackfill = await anonClient.rpc("regapro_backfill_staff_from_auth", {
    p_auth_user_id: ZERO_UUID,
    p_employment_type: "full_time",
    p_actor_auth_user_id: ZERO_UUID,
  });
  if (isExecuteDenied(anonBackfill.error)) {
    reporter.pass("legacy acl anon backfill denied", anonBackfill.error.message);
  } else {
    reporter.fail(
      "legacy acl anon backfill denied",
      anonBackfill.error?.message ?? "call succeeded",
    );
  }

  const anonNext = await anonClient.rpc("regapro_next_staff_no", {
    p_org_id: ZERO_UUID,
  });
  if (isExecuteDenied(anonNext.error)) {
    reporter.pass("legacy acl anon next_staff_no denied", anonNext.error.message);
  } else {
    reporter.fail(
      "legacy acl anon next_staff_no denied",
      anonNext.error?.message ?? "call succeeded",
    );
  }

  const anonHelper = await anonClient.rpc("regapro_is_org_member", {
    p_org_id: fx.ctx.org.id,
  });
  if (isExecuteDenied(anonHelper.error)) {
    reporter.pass("legacy acl anon RLS helper denied", anonHelper.error.message);
  } else {
    reporter.fail(
      "legacy acl anon RLS helper denied",
      anonHelper.error?.message ?? "call succeeded",
    );
  }

  const anonSearch = await anonClient.rpc("regapro_knowledge_lexical_search", {
    p_query: "acl-probe",
    p_limit: 1,
  });
  if (isExecuteDenied(anonSearch.error)) {
    reporter.pass("legacy acl anon knowledge search denied", anonSearch.error.message);
  } else {
    reporter.fail(
      "legacy acl anon knowledge search denied",
      anonSearch.error?.message ?? "call succeeded",
    );
  }

  const authHelper = await sales.client.rpc("regapro_is_org_member", {
    p_org_id: fx.ctx.org.id,
  });
  if (authHelper.error) {
    reporter.fail("legacy acl authenticated RLS helper EXECUTE", authHelper.error.message);
  } else {
    reporter.pass(
      "legacy acl authenticated RLS helper EXECUTE",
      `value=${String(authHelper.data)}`,
    );
  }

  const authSearch = await sales.client.rpc("regapro_knowledge_lexical_search", {
    p_query: "acl-probe",
    p_limit: 1,
  });
  if (authSearch.error) {
    reporter.fail(
      "legacy acl authenticated knowledge search EXECUTE",
      authSearch.error.message,
    );
  } else {
    reporter.pass(
      "legacy acl authenticated knowledge search EXECUTE",
      `hits=${Array.isArray(authSearch.data) ? authSearch.data.length : 0}`,
    );
  }

  const authOrg = await sales.client
    .from("organizations")
    .select("id")
    .eq("id", fx.ctx.org.id)
    .maybeSingle();
  if (authOrg.error) {
    reporter.fail("legacy acl authenticated org RLS", authOrg.error.message);
  } else if (authOrg.data?.id !== fx.ctx.org.id) {
    reporter.fail("legacy acl authenticated org RLS", "missing org row");
  } else {
    reporter.pass("legacy acl authenticated org RLS", "ok");
  }

  const serviceDerive = await fx.admin.rpc(
    "regapro_derive_platform_roles_from_ai_permissions",
    { p_ai_permission_keys: ["chat:use"] },
  );
  if (serviceDerive.error) {
    reporter.fail(
      "legacy acl service_role maintenance EXECUTE",
      serviceDerive.error.message,
    );
  } else {
    reporter.pass(
      "legacy acl service_role maintenance EXECUTE",
      `roles=${JSON.stringify(serviceDerive.data)}`,
    );
  }

  const anonOwner = await anonClient.rpc("regapro_can_access_resource", {
    p_org_id: ZERO_UUID,
    p_confidentiality_level: 1,
    p_visibility: "organization",
    p_owner_user_id: ZERO_UUID,
    p_department_id: ZERO_UUID,
    p_project_id: ZERO_UUID,
  });
  if (isExecuteDenied(anonOwner.error)) {
    reporter.pass("legacy acl anon owner-only denied", anonOwner.error.message);
  } else {
    reporter.fail(
      "legacy acl anon owner-only denied",
      anonOwner.error?.message ?? "call succeeded",
    );
  }

  const authOwner = await sales.client.rpc("regapro_can_access_resource", {
    p_org_id: ZERO_UUID,
    p_confidentiality_level: 1,
    p_visibility: "organization",
    p_owner_user_id: ZERO_UUID,
    p_department_id: ZERO_UUID,
    p_project_id: ZERO_UUID,
  });
  if (isExecuteDenied(authOwner.error)) {
    reporter.pass("legacy acl authenticated owner-only denied", authOwner.error.message);
  } else {
    reporter.fail(
      "legacy acl authenticated owner-only denied",
      authOwner.error?.message ?? "call succeeded",
    );
  }

  const serviceOwner = await fx.admin.rpc("regapro_can_access_resource", {
    p_org_id: ZERO_UUID,
    p_confidentiality_level: 1,
    p_visibility: "organization",
    p_owner_user_id: ZERO_UUID,
    p_department_id: ZERO_UUID,
    p_project_id: ZERO_UUID,
  });
  if (isExecuteDenied(serviceOwner.error)) {
    reporter.pass("legacy acl service_role owner-only denied", serviceOwner.error.message);
  } else {
    reporter.fail(
      "legacy acl service_role owner-only denied",
      serviceOwner.error?.message ?? "call succeeded",
    );
  }

  const anonCounters = await anonClient.from("staff_no_counters").select("org_id").limit(1);
  if (anonCounters.error && /permission denied|42501/i.test(errorText(anonCounters.error))) {
    reporter.pass("legacy acl anon staff_no_counters denied", anonCounters.error.message);
  } else if (Array.isArray(anonCounters.data) && anonCounters.data.length === 0 && !anonCounters.error) {
    reporter.fail(
      "legacy acl anon staff_no_counters denied",
      "empty result without privilege error (RLS hide, grants still present)",
    );
  } else {
    reporter.fail(
      "legacy acl anon staff_no_counters denied",
      anonCounters.error?.message ?? "call succeeded",
    );
  }

  const anonProbe = await anonClient.rpc("regapro_legacy_acl_privileges");
  if (isExecuteDenied(anonProbe.error)) {
    reporter.pass("legacy acl anon privilege probe denied", anonProbe.error.message);
  } else {
    reporter.fail(
      "legacy acl anon privilege probe denied",
      anonProbe.error?.message ?? "call succeeded",
    );
  }
}
