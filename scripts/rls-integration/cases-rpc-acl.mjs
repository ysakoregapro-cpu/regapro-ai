/**
 * Phase 2 / Phase 3 SECURITY DEFINER ACL cases.
 *
 * Skip until 20260928091245_shift_work_rpc_acl_hardening.sql is applied.
 * Privilege matrix uses service_role-only regapro_shift_work_acl_privileges().
 * Anon client calls must be rejected by EXECUTE privilege, not WORK_/SHIFT_ body errors.
 */
import { createAnonClient } from "./lib.mjs";

const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

const EXPECTED = {
  business: { anon: false, authenticated: true, service_role: true },
  rls_helper: { anon: false, authenticated: true, service_role: true },
  internal: { anon: false, authenticated: false, service_role: false },
};

function errorText(error) {
  if (!error) return "";
  return `${error.code ?? ""} ${error.message ?? ""} ${error.details ?? ""}`;
}

function reachedDomainBody(error) {
  return /\b(WORK_|SHIFT_)/.test(errorText(error));
}

function isExecuteDenied(error) {
  if (!error) return false;
  if (reachedDomainBody(error)) return false;
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

export async function shiftWorkAclReady(admin) {
  const { data, error } = await admin.rpc("regapro_shift_work_acl_privileges");
  if (error) {
    return { ready: false, reason: error.message };
  }
  if (!Array.isArray(data) || data.length === 0) {
    return { ready: false, reason: "empty privilege snapshot" };
  }
  return { ready: true, rows: data };
}

export async function runShiftWorkAclCases(reporter, fx, env) {
  const readiness = await shiftWorkAclReady(fx.admin);
  if (!readiness.ready) {
    reporter.skip(
      "shift/work RPC ACL cases",
      `apply supabase/migrations/20260928091245_shift_work_rpc_acl_hardening.sql first (${readiness.reason})`,
    );
    return;
  }

  const byKind = { business: [], rls_helper: [], internal: [] };
  for (const row of readiness.rows) {
    if (byKind[row.kind]) byKind[row.kind].push(row);
  }

  for (const [kind, expected] of Object.entries(EXPECTED)) {
    for (const role of Object.keys(expected)) {
      const rows = byKind[kind] ?? [];
      const mismatch = rows.filter((row) => row.grantee === role && row.can_execute !== expected[role]);
      if (rows.length === 0) {
        reporter.fail(`acl ${kind} ${role} EXECUTE`, "no snapshot rows");
        continue;
      }
      if (mismatch.length > 0) {
        reporter.fail(
          `acl ${kind} ${role} EXECUTE=${expected[role]}`,
          mismatch.map((r) => `${r.function_identity}=${r.can_execute}`).join(", "),
        );
      } else {
        reporter.pass(
          `acl ${kind} ${role} EXECUTE=${expected[role]}`,
          `n=${rows.filter((r) => r.grantee === role).length}`,
        );
      }
    }
  }

  const sales = fx.users.sales_company;
  const anonClient = createAnonClient(env.url, env.anon);

  const anonConfirm = await anonClient.rpc("confirm_work_record", {
    p_work_record_id: ZERO_UUID,
  });
  if (!anonConfirm.error) {
    reporter.fail("acl anon confirm_work_record denied", "call succeeded");
  } else if (reachedDomainBody(anonConfirm.error)) {
    reporter.fail(
      "acl anon confirm_work_record denied by EXECUTE",
      `reached function body: ${anonConfirm.error.message}`,
    );
  } else if (isExecuteDenied(anonConfirm.error)) {
    reporter.pass(
      "acl anon confirm_work_record denied by EXECUTE",
      anonConfirm.error.message,
    );
  } else {
    reporter.fail(
      "acl anon confirm_work_record denied by EXECUTE",
      `unexpected error: ${anonConfirm.error.message}`,
    );
  }

  const anonSubmit = await anonClient.rpc("submit_shift_request", {
    p_request_id: ZERO_UUID,
  });
  if (!anonSubmit.error) {
    reporter.fail("acl anon submit_shift_request denied", "call succeeded");
  } else if (reachedDomainBody(anonSubmit.error)) {
    reporter.fail(
      "acl anon submit_shift_request denied by EXECUTE",
      `reached function body: ${anonSubmit.error.message}`,
    );
  } else if (isExecuteDenied(anonSubmit.error)) {
    reporter.pass(
      "acl anon submit_shift_request denied by EXECUTE",
      anonSubmit.error.message,
    );
  } else {
    reporter.fail(
      "acl anon submit_shift_request denied by EXECUTE",
      `unexpected error: ${anonSubmit.error.message}`,
    );
  }

  const anonHelper = await anonClient.rpc("regapro_has_any_work_record_permission", {
    p_org_id: fx.ctx.org.id,
  });
  if (!anonHelper.error) {
    reporter.fail("acl anon RLS helper denied", "call succeeded");
  } else if (isExecuteDenied(anonHelper.error) && !reachedDomainBody(anonHelper.error)) {
    reporter.pass("acl anon RLS helper denied by EXECUTE", anonHelper.error.message);
  } else {
    reporter.fail("acl anon RLS helper denied by EXECUTE", anonHelper.error.message);
  }

  const authHelper = await sales.client.rpc("regapro_has_any_work_record_permission", {
    p_org_id: fx.ctx.org.id,
  });
  if (authHelper.error) {
    reporter.fail(
      "acl authenticated RLS helper EXECUTE",
      authHelper.error.message,
    );
  } else {
    reporter.pass(
      "acl authenticated RLS helper EXECUTE",
      `value=${String(authHelper.data)}`,
    );
  }

  const authShiftHelper = await sales.client.rpc("regapro_has_any_shift_permission", {
    p_org_id: fx.ctx.org.id,
  });
  if (authShiftHelper.error) {
    reporter.fail(
      "acl authenticated shift RLS helper EXECUTE",
      authShiftHelper.error.message,
    );
  } else {
    reporter.pass("acl authenticated shift RLS helper EXECUTE", "ok");
  }

  const authConfirm = await sales.client.rpc("confirm_work_record", {
    p_work_record_id: ZERO_UUID,
  });
  if (!authConfirm.error) {
    reporter.fail("acl authenticated business RPC EXECUTE", "unexpected success on missing id");
  } else if (reachedDomainBody(authConfirm.error)) {
    reporter.pass(
      "acl authenticated business RPC EXECUTE",
      authConfirm.error.message,
    );
  } else {
    reporter.fail(
      "acl authenticated business RPC EXECUTE",
      `did not reach function body: ${authConfirm.error.message}`,
    );
  }

  const serviceConfirm = await fx.admin.rpc("confirm_work_record", {
    p_work_record_id: ZERO_UUID,
  });
  if (!serviceConfirm.error) {
    reporter.fail("acl service_role business RPC EXECUTE", "unexpected success on missing id");
  } else if (reachedDomainBody(serviceConfirm.error)) {
    reporter.pass(
      "acl service_role business RPC EXECUTE",
      serviceConfirm.error.message,
    );
  } else {
    reporter.fail(
      "acl service_role business RPC EXECUTE",
      `did not reach function body: ${serviceConfirm.error.message}`,
    );
  }

  const anonInternal = await anonClient.rpc("regapro_lock_employment_term_scope", {
    p_org_id: ZERO_UUID,
    p_staff_id: ZERO_UUID,
  });
  if (isExecuteDenied(anonInternal.error) && !reachedDomainBody(anonInternal.error)) {
    reporter.pass("acl anon internal helper denied", anonInternal.error.message);
  } else {
    reporter.fail(
      "acl anon internal helper denied",
      anonInternal.error?.message ?? "call succeeded",
    );
  }

  const authInternal = await sales.client.rpc("regapro_lock_employment_term_scope", {
    p_org_id: ZERO_UUID,
    p_staff_id: ZERO_UUID,
  });
  if (isExecuteDenied(authInternal.error) && !reachedDomainBody(authInternal.error)) {
    reporter.pass("acl authenticated internal helper denied", authInternal.error.message);
  } else {
    reporter.fail(
      "acl authenticated internal helper denied",
      authInternal.error?.message ?? "call succeeded",
    );
  }

  const serviceInternal = await fx.admin.rpc("regapro_lock_employment_term_scope", {
    p_org_id: ZERO_UUID,
    p_staff_id: ZERO_UUID,
  });
  if (isExecuteDenied(serviceInternal.error) && !reachedDomainBody(serviceInternal.error)) {
    reporter.pass("acl service_role internal helper denied", serviceInternal.error.message);
  } else {
    reporter.fail(
      "acl service_role internal helper denied",
      serviceInternal.error?.message ?? "call succeeded",
    );
  }

  const anonProbe = await anonClient.rpc("regapro_shift_work_acl_privileges");
  if (isExecuteDenied(anonProbe.error) && !reachedDomainBody(anonProbe.error)) {
    reporter.pass("acl anon privilege probe denied", anonProbe.error.message);
  } else {
    reporter.fail(
      "acl anon privilege probe denied",
      anonProbe.error?.message ?? "call succeeded",
    );
  }
}
