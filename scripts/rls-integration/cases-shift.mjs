/**
 * RLS cases for the Shift Domain.
 *
 * Skip cleanly when 20260925120000_shift_domain_foundation.sql is not applied.
 * Assertions use user JWTs only. service_role is fixture setup/cleanup.
 */
import { FIXTURE_TAG } from "./lib.mjs";

const SHIFT_TABLES = [
  "work_locations",
  "shift_requests",
  "shift_request_dates",
  "shifts",
];

export async function shiftTablesReady(admin) {
  for (const table of SHIFT_TABLES) {
    const { error } = await admin.from(table).select("*").limit(1);
    if (error) return { ready: false, missing: table, reason: error.message };
  }
  return { ready: true };
}

async function roleIdByKey(admin, key) {
  const { data, error } = await admin
    .from("roles")
    .select("id")
    .is("org_id", null)
    .eq("key", key)
    .is("deleted_at", null)
    .maybeSingle();
  if (error || !data) throw new Error(`shift role ${key} missing: ${error?.message ?? "not found"}`);
  return data.id;
}

export async function setupShiftFixtures(fx, platform) {
  const { admin, ctx, runId } = fx;
  const orgId = ctx.org.id;
  const s = {
    orgId,
    otherOrgId: platform.otherOrgId,
    staffSales: platform.staffSales,
    staffPartTime: platform.staffPartTime,
    staffExec: platform.staffExecNoRoles,
    staffAdmin: platform.staffAdmin,
    staffOtherOrg: platform.staffOtherOrg,
  };

  s.shiftUserRole = await roleIdByKey(admin, "platform_shift_user");
  const { error: roleErr } = await admin.from("staff_role_assignments").insert({
    org_id: orgId,
    staff_id: s.staffSales,
    role_id: s.shiftUserRole,
    scope_type: "organization",
  });
  if (roleErr) throw new Error(`assign shift user: ${roleErr.message}`);

  const { data: location, error: locErr } = await admin
    .from("work_locations")
    .insert({
      org_id: orgId,
      code: `store-${runId}`,
      name: `[${FIXTURE_TAG}:${runId}] store`,
      is_active: true,
    })
    .select("id")
    .single();
  if (locErr) throw new Error(`seed location: ${locErr.message}`);
  s.locationId = location.id;

  const { data: otherLoc, error: otherLocErr } = await admin
    .from("work_locations")
    .insert({
      org_id: s.otherOrgId,
      code: `other-${runId}`,
      name: `[${FIXTURE_TAG}:${runId}] other store`,
      is_active: true,
    })
    .select("id")
    .single();
  if (otherLocErr) throw new Error(`seed other location: ${otherLocErr.message}`);
  s.otherLocationId = otherLoc.id;

  const seedShift = async (row) => {
    const { data, error } = await admin.from("shifts").insert(row).select("id").single();
    if (error) throw new Error(`seed shift: ${error.message}`);
    return data.id;
  };

  const publishedAt = new Date().toISOString();
  s.ownPublished = await seedShift({
    org_id: orgId,
    staff_id: s.staffSales,
    work_date: "2026-10-10",
    start_time: "10:00",
    end_time: "18:00",
    status: "published",
    source: "internal",
    work_location_id: s.locationId,
    published_at: publishedAt,
    published_by_staff_id: s.staffSales,
  });
  s.ownDraft = await seedShift({
    org_id: orgId,
    staff_id: s.staffSales,
    work_date: "2026-10-11",
    status: "draft",
    source: "internal",
  });
  s.ownCancelled = await seedShift({
    org_id: orgId,
    staff_id: s.staffSales,
    work_date: "2026-10-12",
    status: "cancelled",
    source: "internal",
    cancelled_at: publishedAt,
    cancelled_by_staff_id: s.staffSales,
  });
  s.otherPublished = await seedShift({
    org_id: orgId,
    staff_id: s.staffAdmin,
    work_date: "2026-10-10",
    start_time: "09:00",
    end_time: "17:00",
    status: "published",
    source: "internal",
    published_at: publishedAt,
    published_by_staff_id: s.staffAdmin,
  });
  s.crossOrgShift = await seedShift({
    org_id: s.otherOrgId,
    staff_id: s.staffOtherOrg,
    work_date: "2026-10-10",
    status: "published",
    source: "internal",
    work_location_id: s.otherLocationId,
    published_at: publishedAt,
    published_by_staff_id: s.staffOtherOrg,
  });

  const seedDraftRequest = async (staffId, opts = {}) => {
    const periodStart = opts.periodStart ?? "2026-10-01";
    const periodEnd = opts.periodEnd ?? "2026-10-31";
    const workDate = opts.workDate ?? "2026-10-08";
    const { data, error } = await admin
      .from("shift_requests")
      .insert({
        org_id: orgId,
        staff_id: staffId,
        period_start: periodStart,
        period_end: periodEnd,
        version: opts.version ?? 1,
        status: "draft",
        requested_by_staff_id: staffId,
      })
      .select("id")
      .single();
    if (error) throw new Error(`seed request: ${error.message}`);
    const { error: dateErr } = await admin.from("shift_request_dates").insert({
      shift_request_id: data.id,
      org_id: orgId,
      work_date: workDate,
      preference_type: "hope_work",
    });
    if (dateErr) throw new Error(`seed request date: ${dateErr.message}`);
    return data.id;
  };

  s.ownSubmittedRequest = await seedDraftRequest(s.staffSales);
  s.otherSubmittedRequest = await seedDraftRequest(s.staffAdmin);
  // Own draft for weekly-pay-only staff. No shift.request / platform_shift_user.
  s.partTimeDraftRequest = await seedDraftRequest(s.staffPartTime, {
    periodStart: "2026-11-01",
    periodEnd: "2026-11-30",
    workDate: "2026-11-08",
  });

  // Triggers block status changes unless the lifecycle RPC sets regapro.shift_rpc.
  const ownSubmit = await fx.users.sales_company.client.rpc("submit_shift_request", {
    p_request_id: s.ownSubmittedRequest,
  });
  if (ownSubmit.error) throw new Error(`submit own request: ${ownSubmit.error.message}`);
  const otherSubmit = await fx.users.admin_fixture.client.rpc("submit_shift_request", {
    p_request_id: s.otherSubmittedRequest,
  });
  if (otherSubmit.error) throw new Error(`submit other request: ${otherSubmit.error.message}`);

  const { data: ownDate, error: ownDateErr } = await admin
    .from("shift_request_dates")
    .select("id")
    .eq("shift_request_id", s.ownSubmittedRequest)
    .maybeSingle();
  if (ownDateErr || !ownDate) {
    throw new Error(`load own request date: ${ownDateErr?.message ?? "missing"}`);
  }
  s.ownRequestDateId = ownDate.id;

  return s;
}

export async function runShiftCases(reporter, fx, s) {
  const sales = fx.users.sales_company;
  const partTime = fx.users.hr_people;
  const adminUser = fx.users.admin_fixture;
  const outsider = fx.users.no_membership;

  reporter.expectRows(
    "shift: user can read own published shift",
    await sales.client.from("shifts").select("id").eq("id", s.ownPublished),
  );
  reporter.expectDenied(
    "shift: user cannot read another staff shift",
    await sales.client.from("shifts").select("id").eq("id", s.otherPublished),
    s.otherPublished,
  );
  reporter.expectDenied(
    "shift: draft shift not visible to ordinary user",
    await sales.client.from("shifts").select("id").eq("id", s.ownDraft),
    s.ownDraft,
  );
  reporter.expectDenied(
    "shift: cancelled shift not visible to ordinary user",
    await sales.client.from("shifts").select("id").eq("id", s.ownCancelled),
    s.ownCancelled,
  );
  reporter.expectRows(
    "shift: shift manager can read org shifts",
    await adminUser.client.from("shifts").select("id").eq("id", s.ownDraft),
  );
  reporter.expectDenied(
    "shift: cross-org denied",
    await adminUser.client.from("shifts").select("id").eq("id", s.crossOrgShift),
    s.crossOrgShift,
  );

  reporter.expectRows(
    "shift request: user can read own submitted request",
    await sales.client.from("shift_requests").select("id").eq("id", s.ownSubmittedRequest),
  );
  reporter.expectDenied(
    "shift request: user cannot read other request",
    await sales.client.from("shift_requests").select("id").eq("id", s.otherSubmittedRequest),
    s.otherSubmittedRequest,
  );
  reporter.expectRows(
    "shift request: shift manager can read requests",
    await adminUser.client.from("shift_requests").select("id").eq("id", s.ownSubmittedRequest),
  );

  const partTimeSubmit = await partTime.client.rpc("submit_shift_request", {
    p_request_id: s.partTimeDraftRequest,
  });
  if (partTimeSubmit.error || partTimeSubmit.data == null) {
    reporter.pass(
      "shift.request required for submission",
      partTimeSubmit.error?.message ?? "denied own draft without shift.request",
    );
  } else {
    reporter.fail(
      "shift.request required for submission",
      "weekly-pay-only staff submitted their own request without shift.request",
    );
  }

  const salesPublish = await sales.client.rpc("publish_shift", { p_shift_id: s.ownDraft });
  if (salesPublish.error || salesPublish.data == null) {
    reporter.pass("shift.manage required for publish", salesPublish.error?.message ?? "denied");
  } else {
    reporter.fail("shift.manage required for publish", "ordinary shift user published a draft");
  }

  const dateUpdate = await sales.client
    .from("shift_request_dates")
    .update({ note: "should fail" })
    .eq("shift_request_id", s.ownSubmittedRequest)
    .select("id");
  reporter.expectWriteDenied("shift request: submitted dates are immutable", dateUpdate);

  const { error: statusErr } = await fx.admin
    .from("staff")
    .update({ status: "suspended" })
    .eq("staff_id", s.staffSales);
  if (statusErr) {
    reporter.fail("shift: inactive staff denied (setup)", statusErr.message);
  } else {
    reporter.expectDenied(
      "shift: inactive staff denied",
      await sales.client.from("shifts").select("id").eq("id", s.ownPublished),
      s.ownPublished,
    );
    await fx.admin.from("staff").update({ status: "active" }).eq("staff_id", s.staffSales);
  }

  reporter.expectDenied(
    "shift: outsider denied",
    await outsider.client.from("shifts").select("id").eq("id", s.ownPublished),
    s.ownPublished,
  );

  const expectConstraintDenied = (name, result) => {
    if (result.error) {
      reporter.pass(name, result.error.message);
      return;
    }
    reporter.fail(name, "expected constraint or trigger denial");
  };

  expectConstraintDenied(
    "shift integrity: cross-org staff request insert不可",
    await fx.admin
      .from("shift_requests")
      .insert({
        org_id: s.orgId,
        staff_id: s.staffOtherOrg,
        period_start: "2026-12-01",
        period_end: "2026-12-31",
        version: 1,
        status: "draft",
        requested_by_staff_id: s.staffSales,
      })
      .select("id"),
  );
  expectConstraintDenied(
    "shift integrity: cross-org location request date不可",
    await fx.admin
      .from("shift_request_dates")
      .insert({
        shift_request_id: s.partTimeDraftRequest,
        org_id: s.orgId,
        work_date: "2026-11-09",
        preference_type: "hope_work",
        work_location_id: s.otherLocationId,
      })
      .select("id"),
  );
  expectConstraintDenied(
    "shift integrity: cross-org shift staff不可",
    await fx.admin
      .from("shifts")
      .insert({
        org_id: s.orgId,
        staff_id: s.staffOtherOrg,
        work_date: "2026-12-01",
        status: "draft",
        source: "internal",
      })
      .select("id"),
  );
  expectConstraintDenied(
    "shift integrity: cross-org shift location不可",
    await fx.admin
      .from("shifts")
      .insert({
        org_id: s.orgId,
        staff_id: s.staffSales,
        work_date: "2026-12-02",
        status: "draft",
        source: "internal",
        work_location_id: s.otherLocationId,
      })
      .select("id"),
  );
  expectConstraintDenied(
    "shift integrity: mismatched source_request_date不可",
    await fx.admin
      .from("shifts")
      .insert({
        org_id: s.orgId,
        staff_id: s.staffAdmin,
        work_date: "2026-10-08",
        status: "draft",
        source: "internal",
        source_request_date_id: s.ownRequestDateId,
      })
      .select("id"),
  );
  expectConstraintDenied(
    "shift integrity: fake published_at on draft不可",
    await fx.admin
      .from("shifts")
      .insert({
        org_id: s.orgId,
        staff_id: s.staffSales,
        work_date: "2026-12-03",
        status: "draft",
        source: "internal",
        published_at: new Date().toISOString(),
        published_by_staff_id: s.staffSales,
      })
      .select("id"),
  );
  expectConstraintDenied(
    "shift integrity: fake submitted_at on draft request不可",
    await fx.admin
      .from("shift_requests")
      .insert({
        org_id: s.orgId,
        staff_id: s.staffSales,
        period_start: "2026-12-01",
        period_end: "2026-12-07",
        version: 9,
        status: "draft",
        requested_by_staff_id: s.staffSales,
        submitted_at: new Date().toISOString(),
      })
      .select("id"),
  );

  reporter.expectWriteDenied(
    "shift request: Request table direct write denied",
    await sales.client
      .from("shift_requests")
      .insert({
        org_id: s.orgId,
        staff_id: s.staffSales,
        period_start: "2026-12-01",
        period_end: "2026-12-31",
        version: 8,
        status: "draft",
        requested_by_staff_id: s.staffSales,
      })
      .select("id"),
  );

  const rpcDraft = await sales.client.rpc("create_or_replace_shift_request_draft", {
    p_period_start: "2026-12-01",
    p_period_end: "2026-12-31",
    p_dates: [{ work_date: "2026-12-10", preference_type: "hope_work" }],
  });
  if (!rpcDraft.error && rpcDraft.data?.id) {
    s.rpcDraftRequest = rpcDraft.data.id;
    reporter.pass("shift request: RPC draft creation succeeds", s.rpcDraftRequest);
    const rpcAgain = await sales.client.rpc("create_or_replace_shift_request_draft", {
      p_period_start: "2026-12-01",
      p_period_end: "2026-12-31",
      p_dates: [{ work_date: "2026-12-11", preference_type: "hope_off" }],
    });
    if (!rpcAgain.error && rpcAgain.data?.id === s.rpcDraftRequest) {
      reporter.pass(
        "shift request: concurrent draft version creationが衝突しない",
        "same-scope replace reused the locked draft",
      );
    } else {
      reporter.fail(
        "shift request: concurrent draft version creationが衝突しない",
        rpcAgain.error?.message ?? `id=${rpcAgain.data?.id}`,
      );
    }
  } else {
    reporter.fail("shift request: RPC draft creation succeeds", rpcDraft.error?.message ?? "no id");
  }

  const audit = await fx.admin
    .from("audit_logs")
    .select("actor_staff_id, subject_staff_id, action")
    .eq("resource_id", s.ownSubmittedRequest)
    .eq("action", "shift_request_submitted");
  if (
    !audit.error
    && (audit.data ?? []).some(
      (row) =>
        row.actor_staff_id === s.staffSales && row.subject_staff_id === s.staffSales,
    )
  ) {
    reporter.pass("shift audit: actor_staff_id / subject_staff_id saved");
  } else {
    reporter.fail(
      "shift audit: actor_staff_id / subject_staff_id saved",
      audit.error?.message ?? JSON.stringify(audit.data),
    );
  }

  expectConstraintDenied(
    "shift time: same-day invalid time rejected",
    await fx.admin
      .from("shifts")
      .insert({
        org_id: s.orgId,
        staff_id: s.staffSales,
        work_date: "2026-12-04",
        start_time: "10:00",
        end_time: "09:00",
        end_day_offset: 0,
        status: "draft",
        source: "internal",
      })
      .select("id"),
  );

  const overnight = await fx.admin
    .from("shifts")
    .insert({
      org_id: s.orgId,
      staff_id: s.staffSales,
      work_date: "2026-12-05",
      start_time: "22:00",
      end_time: "06:00",
      end_day_offset: 1,
      status: "draft",
      source: "internal",
    })
    .select("id")
    .single();
  if (!overnight.error && overnight.data?.id) {
    s.overnightShift = overnight.data.id;
    reporter.pass("shift time: overnight valid", s.overnightShift);
  } else {
    reporter.fail("shift time: overnight valid", overnight.error?.message ?? "no id");
  }

  expectConstraintDenied(
    "shift time: time-unspecified + end_day_offset=1 rejected",
    await fx.admin
      .from("shifts")
      .insert({
        org_id: s.orgId,
        staff_id: s.staffSales,
        work_date: "2026-12-06",
        end_day_offset: 1,
        status: "draft",
        source: "internal",
      })
      .select("id"),
  );
}

export async function cleanupShiftFixtures(fx, s) {
  if (!s) return;
  const admin = fx.admin;
  const requestIds = [
    s.ownSubmittedRequest,
    s.otherSubmittedRequest,
    s.partTimeDraftRequest,
    s.rpcDraftRequest,
  ].filter(Boolean);
  const shiftIds = [
    s.ownPublished,
    s.ownDraft,
    s.ownCancelled,
    s.otherPublished,
    s.crossOrgShift,
    s.overnightShift,
  ].filter(Boolean);

  const resourceIds = [...requestIds, ...shiftIds];
  if (resourceIds.length) {
    await admin.from("audit_logs").delete().in("resource_id", resourceIds);
  }
  if (requestIds.length) {
    await admin.from("shift_request_dates").delete().in("shift_request_id", requestIds);
    await admin.from("shift_requests").delete().in("id", requestIds);
  }
  if (shiftIds.length) {
    await admin.from("shifts").delete().in("id", shiftIds);
  }
  if (s.locationId) {
    await admin.from("work_locations").delete().eq("id", s.locationId);
  }
  if (s.otherLocationId) {
    await admin.from("work_locations").delete().eq("id", s.otherLocationId);
  }
}
