/**
 * RLS cases for Work Record / Employment Terms.
 *
 * Skip cleanly when 20260925180000_work_record_employment_terms_foundation.sql
 * is not applied. Assertions use user JWTs only. service_role is fixture setup/cleanup.
 */
import { FIXTURE_TAG } from "./lib.mjs";

const WORK_TABLES = ["employment_terms", "work_records", "work_record_revisions"];

export async function workRecordTablesReady(admin) {
  for (const table of WORK_TABLES) {
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
  if (error || !data) {
    throw new Error(`work role ${key} missing: ${error?.message ?? "not found"}`);
  }
  return data.id;
}

export async function setupWorkRecordFixtures(fx, platform) {
  const { admin, ctx, runId } = fx;
  const orgId = ctx.org.id;
  const w = {
    orgId,
    otherOrgId: platform.otherOrgId,
    staffSales: platform.staffSales,
    staffPartTime: platform.staffPartTime,
    staffAdmin: platform.staffAdmin,
    staffExec: platform.staffExecNoRoles,
    staffOtherOrg: platform.staffOtherOrg,
    ids: [],
    termIds: [],
    shiftIds: [],
    locationIds: [],
    assignmentIds: [],
  };

  w.workUserRole = await roleIdByKey(admin, "platform_work_record_user");
  const { data: assignment, error: roleErr } = await admin
    .from("staff_role_assignments")
    .insert({
      org_id: orgId,
      staff_id: w.staffSales,
      role_id: w.workUserRole,
      scope_type: "organization",
    })
    .select("id")
    .single();
  if (roleErr) throw new Error(`assign work record user: ${roleErr.message}`);
  w.assignmentIds.push(assignment.id);

  const seedLocation = async (row) => {
    const { data, error } = await admin.from("work_locations").insert(row).select("id").single();
    if (error) throw new Error(`seed wr location: ${error.message}`);
    w.locationIds.push(data.id);
    return data.id;
  };
  w.locationId = await seedLocation({
    org_id: orgId,
    code: `wr-${runId}`,
    name: `[${FIXTURE_TAG}:${runId}] wr store`,
    is_active: true,
  });
  w.otherLocationId = await seedLocation({
    org_id: w.otherOrgId,
    code: `wr-o-${runId}`,
    name: `[${FIXTURE_TAG}:${runId}] wr other`,
    is_active: true,
  });

  const seedShift = async (row) => {
    const { data, error } = await admin.from("shifts").insert(row).select("id").single();
    if (error) throw new Error(`seed wr shift: ${error.message}`);
    w.shiftIds.push(data.id);
    return data.id;
  };
  w.sourceShift = await seedShift({
    org_id: orgId,
    staff_id: w.staffSales,
    work_date: "2026-08-10",
    start_time: "10:00",
    end_time: "19:00",
    status: "published",
    source: "internal",
    work_location_id: w.locationId,
    published_at: new Date().toISOString(),
    published_by_staff_id: w.staffSales,
  });

  const seedTerm = async (row) => {
    const { data, error } = await admin.from("employment_terms").insert(row).select("id").single();
    if (error) throw new Error(`seed term: ${error.message}`);
    w.termIds.push(data.id);
    return data.id;
  };
  w.ownTerm = await seedTerm({
    org_id: orgId,
    staff_id: w.staffSales,
    hourly_wage_yen: 1300,
    effective_from: "2026-08-01",
    effective_to: "2026-08-31",
    created_by_staff_id: w.staffAdmin,
  });
  w.otherTerm = await seedTerm({
    org_id: orgId,
    staff_id: w.staffPartTime,
    hourly_wage_yen: 1400,
    effective_from: "2026-08-01",
    effective_to: null,
    created_by_staff_id: w.staffAdmin,
  });
  w.otherOrgTerm = await seedTerm({
    org_id: w.otherOrgId,
    staff_id: w.staffOtherOrg,
    hourly_wage_yen: 1500,
    effective_from: "2026-08-01",
    created_by_staff_id: w.staffOtherOrg,
  });
  w.revokedJulyTerm = await seedTerm({
    org_id: orgId,
    staff_id: w.staffSales,
    hourly_wage_yen: 1100,
    effective_from: "2026-07-01",
    effective_to: "2026-07-31",
    created_by_staff_id: w.staffAdmin,
    revoked_at: "2026-07-20T00:00:00.000Z",
    revoked_by_staff_id: w.staffAdmin,
    revoke_reason: "誤登録",
  });
  w.legacyManagerTerm = await seedTerm({
    org_id: orgId,
    staff_id: w.staffSales,
    hourly_wage_yen: 1700,
    effective_from: "2026-11-01",
    effective_to: null,
    created_by_staff_id: w.staffExec,
  });

  const confirmedAt = new Date().toISOString();
  const seedRecord = async (row) => {
    const { data, error } = await admin.from("work_records").insert(row).select("id").single();
    if (error) throw new Error(`seed work record: ${error.message}`);
    w.ids.push(data.id);
    return data.id;
  };
  w.ownDraft = await seedRecord({
    org_id: orgId,
    staff_id: w.staffSales,
    work_date: "2026-08-01",
    start_time: "10:00",
    end_time: "14:00",
    status: "draft",
    created_by_staff_id: w.staffSales,
  });
  w.ownConfirmed = await seedRecord({
    org_id: orgId,
    staff_id: w.staffSales,
    work_date: "2026-08-01",
    start_time: "14:00",
    end_time: "18:00",
    status: "confirmed",
    confirmed_at: confirmedAt,
    confirmed_by_staff_id: w.staffSales,
    employment_term_id: w.ownTerm,
    hourly_wage_snapshot_yen: 1300,
    created_by_staff_id: w.staffSales,
  });
  w.ownLocked = await seedRecord({
    org_id: orgId,
    staff_id: w.staffSales,
    work_date: "2026-08-02",
    start_time: "10:00",
    end_time: "18:00",
    status: "locked",
    confirmed_at: confirmedAt,
    confirmed_by_staff_id: w.staffAdmin,
    created_by_staff_id: w.staffSales,
  });
  w.otherDraft = await seedRecord({
    org_id: orgId,
    staff_id: w.staffPartTime,
    work_date: "2026-08-03",
    start_time: "10:00",
    end_time: "18:00",
    status: "draft",
    created_by_staff_id: w.staffPartTime,
  });
  w.crossOrgRecord = await seedRecord({
    org_id: w.otherOrgId,
    staff_id: w.staffOtherOrg,
    work_date: "2026-08-04",
    start_time: "10:00",
    end_time: "18:00",
    status: "draft",
    created_by_staff_id: w.staffOtherOrg,
  });
  w.historicalOwner = await seedRecord({
    org_id: orgId,
    staff_id: w.staffSales,
    work_date: "2026-08-06",
    start_time: "10:00",
    end_time: "18:00",
    status: "confirmed",
    confirmed_at: "2026-08-06T12:00:00.000Z",
    confirmed_by_staff_id: w.staffSales,
    employment_term_id: w.ownTerm,
    hourly_wage_snapshot_yen: 1300,
    created_by_staff_id: w.staffSales,
  });
  w.historicalTermRecord = await seedRecord({
    org_id: orgId,
    staff_id: w.staffSales,
    work_date: "2026-08-07",
    start_time: "10:00",
    end_time: "18:00",
    status: "confirmed",
    confirmed_at: "2026-08-07T12:00:00.000Z",
    confirmed_by_staff_id: w.staffSales,
    employment_term_id: w.ownTerm,
    hourly_wage_snapshot_yen: 1300,
    created_by_staff_id: w.staffSales,
  });
  w.historicalJuly = await seedRecord({
    org_id: orgId,
    staff_id: w.staffSales,
    work_date: "2026-07-15",
    start_time: "10:00",
    end_time: "18:00",
    status: "confirmed",
    confirmed_at: "2026-07-15T12:00:00.000Z",
    confirmed_by_staff_id: w.staffSales,
    employment_term_id: w.revokedJulyTerm,
    hourly_wage_snapshot_yen: 1100,
    created_by_staff_id: w.staffSales,
  });

  return w;
}

export async function runWorkRecordCases(reporter, fx, w) {
  const sales = fx.users.sales_company;
  const partTime = fx.users.hr_people;
  const adminUser = fx.users.admin_fixture;
  const outsider = fx.users.no_membership;

  const expectConstraintDenied = (name, result) => {
    if (result.error) {
      reporter.pass(name, result.error.message);
      return;
    }
    reporter.fail(name, "expected constraint or trigger denial");
  };

  reporter.expectRows(
    "work record: own Work Record SELECT",
    await sales.client.from("work_records").select("id").eq("id", w.ownDraft),
  );
  reporter.expectDenied(
    "work record: other staff Work Record denied",
    await sales.client.from("work_records").select("id").eq("id", w.otherDraft),
    w.otherDraft,
  );
  reporter.expectRows(
    "work record: manager org Work Record SELECT",
    await adminUser.client.from("work_records").select("id").eq("id", w.otherDraft),
  );
  reporter.expectDenied(
    "work record: cross-org denied",
    await adminUser.client.from("work_records").select("id").eq("id", w.crossOrgRecord),
    w.crossOrgRecord,
  );

  reporter.expectWriteDenied(
    "work record: direct Work Record write denied",
    await sales.client
      .from("work_records")
      .insert({
        org_id: w.orgId,
        staff_id: w.staffSales,
        work_date: "2026-08-20",
        start_time: "10:00",
        end_time: "18:00",
        status: "draft",
        created_by_staff_id: w.staffSales,
      })
      .select("id"),
  );

  const ownDraft = await sales.client.rpc("create_or_update_work_record_draft", {
    p_work_date: "2026-08-05",
    p_start_time: "09:00",
    p_end_time: "12:00",
    p_end_day_offset: 0,
    p_break_minutes: 0,
  });
  if (!ownDraft.error && ownDraft.data?.id) {
    w.rpcDraft = ownDraft.data.id;
    w.ids.push(w.rpcDraft);
    reporter.pass("work record: own draft RPC succeeds", w.rpcDraft);
  } else {
    reporter.fail("work record: own draft RPC succeeds", ownDraft.error?.message ?? "no id");
  }

  if (w.rpcDraft) {
    const confirmOwn = await sales.client.rpc("confirm_work_record", {
      p_work_record_id: w.rpcDraft,
    });
    if (!confirmOwn.error && confirmOwn.data?.id) {
      reporter.pass("work record: own confirm succeeds", confirmOwn.data.id);
    } else {
      reporter.fail("work record: own confirm succeeds", confirmOwn.error?.message ?? "denied");
    }
  }

  const otherConfirm = await sales.client.rpc("confirm_work_record", {
    p_work_record_id: w.otherDraft,
  });
  if (otherConfirm.error || otherConfirm.data == null) {
    reporter.pass(
      "work record: another staff confirm denied",
      otherConfirm.error?.message ?? "denied",
    );
  } else {
    reporter.fail("work record: another staff confirm denied", "confirmed another staff draft");
  }

  const managerConfirm = await adminUser.client.rpc("confirm_work_record", {
    p_work_record_id: w.otherDraft,
  });
  if (!managerConfirm.error && managerConfirm.data?.status === "confirmed") {
    reporter.pass("work record: manager confirm succeeds", w.otherDraft);
  } else {
    reporter.fail(
      "work record: manager confirm succeeds",
      managerConfirm.error?.message ?? JSON.stringify(managerConfirm.data),
    );
  }

  const managerReopen = await adminUser.client.rpc("reopen_work_record", {
    p_work_record_id: w.ownConfirmed,
    p_reason: "訂正",
  });
  if (!managerReopen.error && managerReopen.data?.status === "draft") {
    reporter.pass("work record: manager reopen succeeds", w.ownConfirmed);
  } else {
    reporter.fail(
      "work record: manager reopen succeeds",
      managerReopen.error?.message ?? JSON.stringify(managerReopen.data),
    );
  }

  const userReopen = await sales.client.rpc("reopen_work_record", {
    p_work_record_id: w.rpcDraft ?? w.ownConfirmed,
    p_reason: "訂正",
  });
  if (userReopen.error || userReopen.data == null) {
    reporter.pass("work record: ordinary user reopen denied", userReopen.error?.message ?? "denied");
  } else {
    reporter.fail("work record: ordinary user reopen denied", "ordinary user reopened");
  }

  const lockedConfirm = await adminUser.client.rpc("confirm_work_record", {
    p_work_record_id: w.ownLocked,
  });
  const lockedVoid = await adminUser.client.rpc("void_work_record", {
    p_work_record_id: w.ownLocked,
    p_reason: "不可",
  });
  const lockedReopen = await adminUser.client.rpc("reopen_work_record", {
    p_work_record_id: w.ownLocked,
    p_reason: "不可",
  });
  if (lockedConfirm.error && lockedVoid.error && lockedReopen.error) {
    reporter.pass("work record: locked mutation denied", lockedConfirm.error.message);
  } else {
    reporter.fail("work record: locked mutation denied", "a locked RPC succeeded");
  }

  if (w.rpcDraft) {
    reporter.expectRows(
      "work record: revision visible to owner",
      await sales.client
        .from("work_record_revisions")
        .select("id")
        .eq("work_record_id", w.rpcDraft),
    );
    reporter.expectDenied(
      "work record: other revision denied",
      await partTime.client
        .from("work_record_revisions")
        .select("id")
        .eq("work_record_id", w.rpcDraft),
    );
  }

  reporter.expectRows(
    "employment terms: own employment term SELECT",
    await sales.client.from("employment_terms").select("id").eq("id", w.ownTerm),
  );
  reporter.expectDenied(
    "employment terms: other staff wage denied",
    await sales.client.from("employment_terms").select("id").eq("id", w.otherTerm),
    w.otherTerm,
  );

  const manageTerm = await adminUser.client.rpc("create_employment_term", {
    p_staff_id: w.staffPartTime,
    p_hourly_wage_yen: 1600,
    p_effective_from: "2026-09-01",
    p_close_open_ended: true,
  });
  if (!manageTerm.error && manageTerm.data?.id) {
    w.termIds.push(manageTerm.data.id);
    reporter.pass("employment terms: employment_terms.manage can manage", manageTerm.data.id);
  } else {
    reporter.fail(
      "employment terms: employment_terms.manage can manage",
      manageTerm.error?.message ?? "no id",
    );
  }

  const nonManagerTerm = await sales.client.rpc("create_employment_term", {
    p_staff_id: w.staffSales,
    p_hourly_wage_yen: 2000,
    p_effective_from: "2026-10-01",
  });
  if (nonManagerTerm.error || nonManagerTerm.data == null) {
    reporter.pass(
      "employment terms: non-manager cannot create term",
      nonManagerTerm.error?.message ?? "denied",
    );
  } else {
    reporter.fail("employment terms: non-manager cannot create term", "created");
  }

  expectConstraintDenied(
    "employment terms: overlapping term DB reject",
    await fx.admin.from("employment_terms").insert({
      org_id: w.orgId,
      staff_id: w.staffSales,
      hourly_wage_yen: 1800,
      effective_from: "2026-08-15",
      effective_to: "2026-08-20",
      created_by_staff_id: w.staffAdmin,
    }),
  );

  expectConstraintDenied(
    "work record integrity: cross-org staff rejected",
    await fx.admin.from("work_records").insert({
      org_id: w.orgId,
      staff_id: w.staffOtherOrg,
      work_date: "2026-08-21",
      start_time: "10:00",
      end_time: "18:00",
      status: "draft",
      created_by_staff_id: w.staffSales,
    }),
  );
  expectConstraintDenied(
    "work record integrity: cross-org location rejected",
    await fx.admin.from("work_records").insert({
      org_id: w.orgId,
      staff_id: w.staffSales,
      work_date: "2026-08-22",
      start_time: "10:00",
      end_time: "18:00",
      status: "draft",
      work_location_id: w.otherLocationId,
      created_by_staff_id: w.staffSales,
    }),
  );
  expectConstraintDenied(
    "work record integrity: mismatched source shift rejected",
    await fx.admin.from("work_records").insert({
      org_id: w.orgId,
      staff_id: w.staffSales,
      work_date: "2026-08-23",
      start_time: "10:00",
      end_time: "18:00",
      status: "draft",
      source_shift_id: w.sourceShift,
      created_by_staff_id: w.staffSales,
    }),
  );
  expectConstraintDenied(
    "work record integrity: cross-org term rejected",
    await fx.admin.from("work_records").insert({
      org_id: w.orgId,
      staff_id: w.staffSales,
      work_date: "2026-08-24",
      start_time: "10:00",
      end_time: "18:00",
      status: "confirmed",
      confirmed_at: new Date().toISOString(),
      confirmed_by_staff_id: w.staffSales,
      employment_term_id: w.otherOrgTerm,
      hourly_wage_snapshot_yen: 1500,
      created_by_staff_id: w.staffSales,
    }),
  );
  expectConstraintDenied(
    "work record integrity: wrong-date employment_term_id reject",
    await fx.admin.from("work_records").insert({
      org_id: w.orgId,
      staff_id: w.staffSales,
      work_date: "2026-09-15",
      start_time: "10:00",
      end_time: "18:00",
      status: "confirmed",
      confirmed_at: "2026-09-15T12:00:00.000Z",
      confirmed_by_staff_id: w.staffSales,
      employment_term_id: w.ownTerm,
      hourly_wage_snapshot_yen: 1300,
      created_by_staff_id: w.staffSales,
    }),
  );
  expectConstraintDenied(
    "work record integrity: snapshot value mismatch reject",
    await fx.admin.from("work_records").insert({
      org_id: w.orgId,
      staff_id: w.staffSales,
      work_date: "2026-08-09",
      start_time: "10:00",
      end_time: "12:00",
      status: "confirmed",
      confirmed_at: "2026-08-09T12:00:00.000Z",
      confirmed_by_staff_id: w.staffSales,
      employment_term_id: w.ownTerm,
      hourly_wage_snapshot_yen: 9999,
      created_by_staff_id: w.staffSales,
    }),
  );
  expectConstraintDenied(
    "work record integrity: same staff/org different period term reject",
    await fx.admin.from("work_records").insert({
      org_id: w.orgId,
      staff_id: w.staffSales,
      work_date: "2026-10-01",
      start_time: "10:00",
      end_time: "18:00",
      status: "confirmed",
      confirmed_at: "2026-10-01T12:00:00.000Z",
      confirmed_by_staff_id: w.staffSales,
      employment_term_id: w.ownTerm,
      hourly_wage_snapshot_yen: 1300,
      created_by_staff_id: w.staffSales,
    }),
  );
  expectConstraintDenied(
    "work record integrity: revoked term new snapshot reject",
    await fx.admin.from("work_records").insert({
      org_id: w.orgId,
      staff_id: w.staffSales,
      work_date: "2026-07-10",
      start_time: "10:00",
      end_time: "12:00",
      status: "confirmed",
      confirmed_at: new Date().toISOString(),
      confirmed_by_staff_id: w.staffSales,
      employment_term_id: w.revokedJulyTerm,
      hourly_wage_snapshot_yen: 1100,
      created_by_staff_id: w.staffSales,
    }),
  );

  reporter.expectRows(
    "work record: historical confirmed still readable after term already revoked",
    await adminUser.client.from("work_records").select("id").eq("id", w.historicalJuly),
  );

  const revokeOwn = await adminUser.client.rpc("revoke_employment_term", {
    p_term_id: w.ownTerm,
    p_reason: "改定",
  });
  if (!revokeOwn.error) {
    reporter.expectRows(
      "work record: historical record survives later term revoke",
      await adminUser.client.from("work_records").select("id").eq("id", w.historicalTermRecord),
    );
    const voidAfterRevoke = await adminUser.client.rpc("void_work_record", {
      p_work_record_id: w.historicalTermRecord,
      p_reason: "履歴取消",
    });
    if (!voidAfterRevoke.error && voidAfterRevoke.data?.status === "voided") {
      reporter.pass(
        "work record: historical record voidable after term revoke",
        w.historicalTermRecord,
      );
    } else {
      reporter.fail(
        "work record: historical record voidable after term revoke",
        voidAfterRevoke.error?.message ?? JSON.stringify(voidAfterRevoke.data),
      );
    }
  } else {
    reporter.fail("work record: revoke ownTerm for historical test", revokeOwn.error.message);
  }

  if (manageTerm.data?.id) {
    const lateDraft = await adminUser.client.rpc("create_or_update_work_record_draft", {
      p_staff_id: w.staffPartTime,
      p_work_date: "2026-09-02",
      p_start_time: "10:00",
      p_end_time: "18:00",
      p_end_day_offset: 0,
      p_break_minutes: 0,
    });
    if (!lateDraft.error && lateDraft.data?.id) {
      w.ids.push(lateDraft.data.id);
      const lateConfirm = await adminUser.client.rpc("confirm_work_record", {
        p_work_record_id: lateDraft.data.id,
      });
      if (
        !lateConfirm.error &&
        lateConfirm.data?.employment_term_id === manageTerm.data.id &&
        lateConfirm.data?.hourly_wage_snapshot_yen === 1600
      ) {
        reporter.pass(
          "work record: confirm does not snapshot an inapplicable closed term",
          lateDraft.data.id,
        );
      } else {
        reporter.fail(
          "work record: confirm does not snapshot an inapplicable closed term",
          lateConfirm.error?.message ?? JSON.stringify(lateConfirm.data),
        );
      }
    } else {
      reporter.fail(
        "work record: confirm does not snapshot an inapplicable closed term",
        lateDraft.error?.message ?? "no late draft",
      );
    }
  }

  const { error: statusErr } = await fx.admin
    .from("staff")
    .update({ status: "suspended" })
    .eq("staff_id", w.staffSales);
  if (statusErr) {
    reporter.fail("work record: inactive staff deny (setup)", statusErr.message);
  } else {
    reporter.expectDenied(
      "work record: inactive staff deny",
      await sales.client.from("work_records").select("id").eq("id", w.ownDraft),
      w.ownDraft,
    );
    const inactiveRpc = await sales.client.rpc("create_or_update_work_record_draft", {
      p_work_date: "2026-08-11",
      p_start_time: "10:00",
      p_end_time: "18:00",
    });
    if (inactiveRpc.error || inactiveRpc.data == null) {
      reporter.pass(
        "work record: inactive caller RPC denied",
        inactiveRpc.error?.message ?? "denied",
      );
    } else {
      reporter.fail("work record: inactive caller RPC denied", "inactive caller created a draft");
    }
    reporter.expectRows(
      "work record: manager reads record after owner left",
      await adminUser.client.from("work_records").select("id").eq("id", w.historicalOwner),
    );
    const voidLeft = await adminUser.client.rpc("void_work_record", {
      p_work_record_id: w.historicalOwner,
      p_reason: "退職後の履歴訂正",
    });
    if (!voidLeft.error && voidLeft.data?.status === "voided") {
      reporter.pass(
        "work record: manager voids historical record after owner/created_by inactive",
        w.historicalOwner,
      );
    } else {
      reporter.fail(
        "work record: manager voids historical record after owner/created_by inactive",
        voidLeft.error?.message ?? JSON.stringify(voidLeft.data),
      );
    }
    await fx.admin.from("staff").update({ status: "active" }).eq("staff_id", w.staffSales);
  }

  const { error: execErr } = await fx.admin
    .from("staff")
    .update({ status: "left" })
    .eq("staff_id", w.staffExec);
  if (execErr) {
    reporter.fail("employment terms: successor manager (setup)", execErr.message);
  } else {
    const successor = await adminUser.client.rpc("revoke_employment_term", {
      p_term_id: w.legacyManagerTerm,
      p_reason: "後任による取消",
    });
    if (!successor.error && successor.data?.revoked_at) {
      reporter.pass(
        "employment terms: successor manager operates after original creator left",
        w.legacyManagerTerm,
      );
    } else {
      reporter.fail(
        "employment terms: successor manager operates after original creator left",
        successor.error?.message ?? JSON.stringify(successor.data),
      );
    }
    await fx.admin.from("staff").update({ status: "active" }).eq("staff_id", w.staffExec);
  }

  reporter.expectDenied(
    "work record: outsider denied",
    await outsider.client.from("work_records").select("id").eq("id", w.ownDraft),
    w.ownDraft,
  );

  const audit = await fx.admin
    .from("audit_logs")
    .select("actor_staff_id, subject_staff_id, action, metadata")
    .in("action", ["work_record_created", "employment_term_created"]);
  const ok = (audit.data ?? []).some(
    (row) =>
      row.actor_staff_id &&
      row.subject_staff_id &&
      !JSON.stringify(row.metadata ?? {}).includes("hourly_wage"),
  );
  if (!audit.error && ok) {
    reporter.pass("work record audit: actor/subject staff saved");
  } else {
    reporter.fail(
      "work record audit: actor/subject staff saved",
      audit.error?.message ?? JSON.stringify(audit.data),
    );
  }
}

export async function cleanupWorkRecordFixtures(fx, w) {
  if (!w) return;
  const admin = fx.admin;
  const resourceIds = [...(w.ids ?? []), ...(w.termIds ?? [])].filter(Boolean);
  if (resourceIds.length) {
    await admin.from("audit_logs").delete().in("resource_id", resourceIds);
  }
  if (w.ids?.length) {
    // Revisions RESTRICT parent deletes; service_role must drop history first.
    await admin.from("work_record_revisions").delete().in("work_record_id", w.ids);
    await admin.from("work_records").delete().in("id", w.ids);
  }
  if (w.termIds?.length) {
    await admin.from("employment_terms").delete().in("id", w.termIds);
  }
  if (w.shiftIds?.length) {
    await admin.from("shifts").delete().in("id", w.shiftIds);
  }
  if (w.locationIds?.length) {
    await admin.from("work_locations").delete().in("id", w.locationIds);
  }
  if (w.assignmentIds?.length) {
    await admin.from("staff_role_assignments").delete().in("id", w.assignmentIds);
  }
}
