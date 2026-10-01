/**
 * Phase 4 Weekly Pay RLS / RPC cases.
 * Skip cleanly when 20261001024933_weekly_pay_application_foundation.sql is absent.
 */
import { createAnonClient, FIXTURE_TAG } from "./lib.mjs";

const TABLES = [
  "weekly_pay_policies",
  "weekly_applications",
  "weekly_application_items",
  "weekly_pay_audit_events",
  "bank_accounts",
  "worker_settings",
  "application_bank_snapshots",
];

function tokyoToday() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tokyo" });
}

function addDays(isoDate, days) {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

function weekStartMonday(isoDate) {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const js = dt.getUTCDay();
  const iso = js === 0 ? 7 : js;
  return addDays(isoDate, -(iso - 1));
}

export async function weeklyPayTablesReady(admin) {
  for (const table of TABLES) {
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
  if (error || !data) throw new Error(`weekly role ${key}: ${error?.message ?? "missing"}`);
  return data.id;
}

export async function setupWeeklyPayFixtures(fx, platform, workRecord) {
  const { admin, ctx, runId } = fx;
  const orgId = ctx.org.id;
  const today = tokyoToday();
  const ws = weekStartMonday(today);
  // Prefer mid-week dates still before Sunday cutoff.
  const d1 = addDays(ws, 0); // Monday
  const d2 = addDays(ws, 1); // Tuesday

  const w = {
    orgId,
    otherOrgId: platform.otherOrgId,
    staffWorker: platform.staffPartTime,
    staffReviewer: platform.staffAdmin,
    staffOtherOrg: platform.staffOtherOrg,
    locationId: workRecord.locationId,
    weekStart: ws,
    d1,
    d2,
    today,
    ids: [],
    termIds: [],
    appIds: [],
    policyIds: [],
    assignmentIds: [],
  };

  const reviewerRole = await roleIdByKey(admin, "platform_weekly_pay_reviewer");
  const policyRole = await roleIdByKey(admin, "platform_weekly_pay_policy_manager");
  const payerRole = await roleIdByKey(admin, "platform_weekly_pay_payer");
  for (const [staffId, roleId] of [
    [w.staffReviewer, reviewerRole],
    [w.staffReviewer, policyRole],
    [w.staffReviewer, payerRole],
  ]) {
    const { data, error } = await admin
      .from("staff_role_assignments")
      .insert({
        org_id: orgId,
        staff_id: staffId,
        role_id: roleId,
        scope_type: "organization",
      })
      .select("id")
      .single();
    if (error) throw new Error(`assign weekly role: ${error.message}`);
    w.assignmentIds.push(data.id);
  }

  // Work-record cases may close/succeed the initial part-time term; resolve the
  // term that is actually active for the fixture week (never invent overlapping terms).
  const { data: activeTerm, error: termLookupErr } = await admin
    .from("employment_terms")
    .select("id, hourly_wage_yen, effective_from, effective_to")
    .eq("org_id", orgId)
    .eq("staff_id", w.staffWorker)
    .is("revoked_at", null)
    .lte("effective_from", d1)
    .or(`effective_to.is.null,effective_to.gte.${d1}`)
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (termLookupErr) throw new Error(`lookup weekly term: ${termLookupErr.message}`);
  if (!activeTerm) {
    throw new Error(`no active employment term for weekly worker covering ${d1}`);
  }
  w.termId = activeTerm.id;
  w.wageYen = activeTerm.hourly_wage_yen;

  const { data: existingPolicies } = await admin
    .from("weekly_pay_policies")
    .select("version")
    .eq("org_id", orgId)
    .order("version", { ascending: false })
    .limit(1);
  const nextVersion = (existingPolicies?.[0]?.version ?? 0) + 1;

  const { data: policy, error: polErr } = await admin
    .from("weekly_pay_policies")
    .insert({
      org_id: orgId,
      version: nextVersion,
      advance_rate_bps: 7000,
      daily_cap_minutes: 480,
      daily_cap_scope: "per_calendar_day",
      rounding_unit_yen: 500,
      include_transport_fee: false,
      week_start_iso_dow: 1,
      payment_offset_days: 11,
      effective_from: "2020-01-01",
      created_by_staff_id: w.staffReviewer,
    })
    .select("*")
    .single();
  if (polErr) throw new Error(`seed weekly policy: ${polErr.message}`);
  w.policyIds.push(policy.id);
  w.policy = policy;

  const seedWr = async (workDate, start, end, breakMinutes = 60) => {
    const { data, error } = await admin
      .from("work_records")
      .insert({
        org_id: orgId,
        staff_id: w.staffWorker,
        work_date: workDate,
        start_time: start,
        end_time: end,
        end_day_offset: 0,
        break_minutes: breakMinutes,
        transport_fee_yen: 500,
        work_location_id: w.locationId,
        status: "confirmed",
        employment_term_id: w.termId,
        hourly_wage_snapshot_yen: w.wageYen,
        confirmed_at: new Date().toISOString(),
        confirmed_by_staff_id: w.staffWorker,
        created_by_staff_id: w.staffWorker,
      })
      .select("*")
      .single();
    if (error) throw new Error(`seed weekly wr: ${error.message}`);
    w.ids.push(data.id);
    return data.id;
  };

  w.wr1 = await seedWr(d1, "10:00:00", "19:00:00", 60); // 480 min
  w.wr2 = await seedWr(d2, "10:00:00", "15:00:00", 0); // 300 min

  w.bankAccountNumber = "1234567";
  w.bankIds = [];
  return w;
}

export async function cleanupWeeklyPayFixtures(admin, w) {
  if (!w) return;
  if (w.appIds?.length) {
    await admin.from("application_bank_snapshots").delete().in("application_id", w.appIds);
    await admin.from("weekly_application_items").delete().in("application_id", w.appIds);
    await admin.from("weekly_applications").delete().in("id", w.appIds);
  }
  await admin
    .from("weekly_applications")
    .delete()
    .eq("org_id", w.orgId)
    .eq("staff_id", w.staffWorker);
  if (w.ids?.length) {
    await admin.from("work_record_revisions").delete().in("work_record_id", w.ids);
    await admin.from("work_records").delete().in("id", w.ids);
  }
  if (w.staffWorker) {
    await admin.from("worker_settings").delete().eq("staff_id", w.staffWorker);
    await admin.from("bank_accounts").delete().eq("staff_id", w.staffWorker);
  }
  if (w.policyIds?.length) {
    await admin.from("weekly_pay_policies").delete().in("id", w.policyIds);
  }
  if (w.assignmentIds?.length) {
    await admin.from("staff_role_assignments").delete().in("id", w.assignmentIds);
  }
  if (w.orgId) {
    await admin.from("weekly_pay_audit_events").delete().eq("org_id", w.orgId);
  }
}

function denied(error) {
  if (!error) return false;
  const text = `${error.code ?? ""} ${error.message ?? ""}`.toLowerCase();
  return (
    error.code === "42501" ||
    /permission denied|forbidden|self_review|duplicate|already applied|cutoff|invalid_transition/i.test(
      text,
    )
  );
}

export async function runWeeklyPayCases(reporter, fx, weekly, env) {
  const worker = fx.users.hr_people; // part_time + weekly_pay.submit
  const reviewer = fx.users.admin_fixture;
  const outsider = fx.users.no_membership;
  const sales = fx.users.sales_company;
  const anon = createAnonClient(env.url, env.anon);

  const noBankDraft = await worker.client.rpc("create_or_replace_weekly_application_draft", {
    p_work_record_ids: [weekly.wr1, weekly.wr2],
    p_for_staff_id: null,
  });
  if (/NO_BANK/i.test(noBankDraft.error?.message ?? "")) {
    reporter.pass("weekly pay draft without bank denied", noBankDraft.error.message);
  } else {
    reporter.fail(
      "weekly pay draft without bank denied",
      noBankDraft.error?.message ?? "succeeded without bank",
    );
  }

  const legacyUpsert = await worker.client.rpc("upsert_bank_account", {
    p_bank_name: "テスト銀行",
    p_bank_code: "0001",
    p_branch_name: "本店",
    p_branch_code: "001",
    p_account_type: "ordinary",
    p_account_number: weekly.bankAccountNumber,
    p_account_holder_kana: "ヤマダ タロウ",
    p_for_staff_id: null,
  });
  if (denied(legacyUpsert.error)) {
    reporter.pass(
      "weekly pay legacy upsert_bank_account EXECUTE denied",
      legacyUpsert.error.message,
    );
  } else {
    reporter.fail(
      "weekly pay legacy upsert_bank_account EXECUTE denied",
      legacyUpsert.error?.message ?? "legacy upsert succeeded",
    );
  }

  const bank = await worker.client.rpc("upsert_bank_account_masked", {
    p_bank_name: "テスト銀行",
    p_bank_code: "0001",
    p_branch_name: "本店",
    p_branch_code: "001",
    p_account_type: "ordinary",
    p_account_number: weekly.bankAccountNumber,
    p_account_holder_kana: "ヤマダ タロウ",
    p_for_staff_id: null,
  });
  if (bank.error) {
    reporter.fail("weekly pay bank upsert", bank.error.message);
    return;
  }
  weekly.bankIds.push(bank.data.id);
  const upsertKeys = Object.keys(bank.data ?? {});
  if (
    bank.data.account_number_last4 === "4567" &&
    !upsertKeys.includes("account_number") &&
    !upsertKeys.includes("account_number_ciphertext")
  ) {
    reporter.pass("weekly pay bank upsert", `last4=${bank.data.account_number_last4}`);
  } else {
    reporter.fail(
      "weekly pay bank upsert",
      `unexpected keys/last4 keys=${upsertKeys.join(",")}`,
    );
  }

  const plaintextProbe = await worker.client
    .from("bank_accounts")
    .select("id, account_number_ciphertext")
    .eq("id", bank.data.id)
    .maybeSingle();
  if (plaintextProbe.error || plaintextProbe.data?.account_number_ciphertext == null) {
    reporter.pass(
      "weekly pay ciphertext column denied to authenticated",
      plaintextProbe.error?.message ?? "column not returned",
    );
  } else {
    reporter.fail(
      "weekly pay ciphertext column denied to authenticated",
      "ciphertext visible via SELECT",
    );
  }

  const otherBank = await sales.client
    .from("bank_accounts")
    .select("id")
    .eq("id", bank.data.id)
    .maybeSingle();
  if (!otherBank.data) {
    reporter.pass("weekly pay other staff bank SELECT denied", "0 rows");
  } else {
    reporter.fail("weekly pay other staff bank SELECT denied", "row visible");
  }

  const draft = await worker.client.rpc("create_or_replace_weekly_application_draft", {
    p_work_record_ids: [weekly.wr1, weekly.wr2],
    p_for_staff_id: null,
  });
  if (draft.error) {
    reporter.fail("weekly pay draft create", draft.error.message);
    return;
  }
  weekly.appIds.push(draft.data.id);
  // floor(wage*mins*70/6000 / 500)*500 per item; current fixture wage is successor term 1600.
  const expectedItem1 = Math.floor((weekly.wageYen * 480 * 70) / 6000 / 500) * 500;
  const expectedItem2 = Math.floor((weekly.wageYen * 300 * 70) / 6000 / 500) * 500;
  const expectedTotal = expectedItem1 + expectedItem2;
  if (draft.data.total_amount_yen === expectedTotal && draft.data.status === "draft") {
    reporter.pass("weekly pay draft create", `total=${draft.data.total_amount_yen}`);
  } else {
    reporter.fail(
      "weekly pay draft create",
      `status=${draft.data.status} total=${draft.data.total_amount_yen} expected=${expectedTotal}`,
    );
  }

  const snap = await worker.client
    .from("application_bank_snapshots")
    .select(
      "application_id, account_number_last4, bank_code, branch_code, source_bank_account_id",
    )
    .eq("application_id", draft.data.id)
    .maybeSingle();
  if (
    snap.data?.account_number_last4 === "4567" &&
    snap.data.source_bank_account_id === bank.data.id
  ) {
    reporter.pass("weekly pay bank snapshot on draft", `last4=${snap.data.account_number_last4}`);
  } else {
    reporter.fail(
      "weekly pay bank snapshot on draft",
      snap.error?.message ?? JSON.stringify(snap.data),
    );
  }
  weekly.originalSnapshotLast4 = snap.data?.account_number_last4;
  weekly.originalSourceBankId = snap.data?.source_bank_account_id;

  const bank2 = await worker.client.rpc("upsert_bank_account_masked", {
    p_bank_name: "テスト銀行",
    p_bank_code: "0001",
    p_branch_name: "本店",
    p_branch_code: "001",
    p_account_type: "ordinary",
    p_account_number: "9999888",
    p_account_holder_kana: "ヤマダ タロウ",
    p_for_staff_id: null,
  });
  if (bank2.error) {
    reporter.fail("weekly pay bank replace", bank2.error.message);
  } else {
    weekly.bankIds.push(bank2.data.id);
    const replaceKeys = Object.keys(bank2.data ?? {});
    if (replaceKeys.includes("account_number_ciphertext")) {
      reporter.fail("weekly pay bank replace", "ciphertext present in masked RPC");
    } else {
      reporter.pass("weekly pay bank replace", `last4=${bank2.data.account_number_last4}`);
    }
  }

  const snapAfterBankChange = await worker.client
    .from("application_bank_snapshots")
    .select("account_number_last4, source_bank_account_id")
    .eq("application_id", draft.data.id)
    .maybeSingle();
  if (
    snapAfterBankChange.data?.account_number_last4 === weekly.originalSnapshotLast4 &&
    snapAfterBankChange.data?.source_bank_account_id === weekly.originalSourceBankId
  ) {
    reporter.pass(
      "weekly pay snapshot immutable after bank change",
      `last4=${snapAfterBankChange.data.account_number_last4}`,
    );
  } else {
    reporter.fail(
      "weekly pay snapshot immutable after bank change",
      JSON.stringify(snapAfterBankChange.data),
    );
  }

  const submit = await worker.client.rpc("submit_weekly_application", {
    p_application_id: draft.data.id,
  });
  if (submit.error) {
    reporter.fail("weekly pay submit", submit.error.message);
  } else if (submit.data.status === "submitted") {
    reporter.pass("weekly pay submit", submit.data.status);
  } else {
    reporter.fail("weekly pay submit", `status=${submit.data.status}`);
  }

  const selfApprove = await worker.client.rpc("approve_weekly_application", {
    p_application_id: draft.data.id,
  });
  if (denied(selfApprove.error)) {
    reporter.pass("weekly pay self-approve denied", selfApprove.error.message);
  } else {
    reporter.fail(
      "weekly pay self-approve denied",
      selfApprove.error?.message ?? "call succeeded",
    );
  }

  const returned = await reviewer.client.rpc("return_weekly_application", {
    p_application_id: draft.data.id,
    p_reason: "please fix hours",
  });
  if (returned.error) {
    reporter.fail("weekly pay reviewer return", returned.error.message);
  } else if (returned.data.status === "returned") {
    reporter.pass("weekly pay reviewer return", returned.data.status);
  } else {
    reporter.fail("weekly pay reviewer return", `status=${returned.data.status}`);
  }

  const redraft = await worker.client.rpc("create_or_replace_weekly_application_draft", {
    p_work_record_ids: [weekly.wr1, weekly.wr2],
    p_for_staff_id: null,
  });
  if (redraft.error) {
    reporter.fail("weekly pay resubmit draft", redraft.error.message);
  } else {
    reporter.pass("weekly pay resubmit draft", redraft.data.status);
    const snapRedraft = await worker.client
      .from("application_bank_snapshots")
      .select("account_number_last4, source_bank_account_id")
      .eq("application_id", redraft.data.id)
      .maybeSingle();
    // Returned→draft replace refreshes snapshot from current active bank (9999888).
    if (snapRedraft.data?.account_number_last4 === "9888") {
      reporter.pass(
        "weekly pay redraft refreshes bank snapshot",
        `last4=${snapRedraft.data.account_number_last4}`,
      );
    } else {
      reporter.fail(
        "weekly pay redraft refreshes bank snapshot",
        JSON.stringify(snapRedraft.data),
      );
    }
    const resubmit = await worker.client.rpc("submit_weekly_application", {
      p_application_id: redraft.data.id,
    });
    if (resubmit.error) {
      reporter.fail("weekly pay resubmit", resubmit.error.message);
    } else {
      reporter.pass("weekly pay resubmit", resubmit.data.status);
    }
  }

  const otherRead = await outsider.client
    .from("weekly_applications")
    .select("id")
    .eq("id", draft.data.id)
    .maybeSingle();
  if (!otherRead.data) {
    reporter.pass("weekly pay outsider SELECT denied", "0 rows");
  } else {
    reporter.fail("weekly pay outsider SELECT denied", "row visible");
  }

  const approve = await reviewer.client.rpc("approve_weekly_application", {
    p_application_id: draft.data.id,
  });
  if (approve.error) {
    reporter.fail("weekly pay reviewer approve", approve.error.message);
  } else if (approve.data.status === "approved") {
    reporter.pass("weekly pay reviewer approve", approve.data.status);
  } else {
    reporter.fail("weekly pay reviewer approve", `status=${approve.data.status}`);
  }

  const dup = await worker.client.rpc("create_or_replace_weekly_application_draft", {
    p_work_record_ids: [weekly.wr1],
    p_for_staff_id: null,
  });
  if (denied(dup.error) || /duplicate|already/i.test(dup.error?.message ?? "")) {
    reporter.pass("weekly pay duplicate week denied", dup.error?.message ?? "ok");
  } else {
    reporter.fail("weekly pay duplicate week denied", dup.error?.message ?? "succeeded");
  }

  const anonDraft = await anon.rpc("create_or_replace_weekly_application_draft", {
    p_work_record_ids: [weekly.wr1],
    p_for_staff_id: null,
  });
  if (denied(anonDraft.error)) {
    reporter.pass("weekly pay anon draft denied", anonDraft.error.message);
  } else {
    reporter.fail("weekly pay anon draft denied", anonDraft.error?.message ?? "ok");
  }

  const acl = await fx.admin.rpc("regapro_weekly_pay_acl_privileges");
  if (acl.error) {
    reporter.fail("weekly pay ACL probe", acl.error.message);
  } else {
    const bad = (acl.data ?? []).filter((row) => {
      if (row.kind === "business" || row.kind === "rls_helper") {
        if (row.grantee === "anon" && row.can_execute) return true;
        if (row.grantee !== "anon" && !row.can_execute) return true;
      }
      if (row.kind === "internal" && row.can_execute) return true;
      return false;
    });
    if (bad.length === 0) {
      reporter.pass("weekly pay ACL matrix", `n=${acl.data.length}`);
    } else {
      reporter.fail(
        "weekly pay ACL matrix",
        bad.map((b) => `${b.grantee} ${b.function_identity}=${b.can_execute}`).join("; "),
      );
    }
  }

  const probeAnon = await anon.rpc("regapro_weekly_pay_acl_privileges");
  if (denied(probeAnon.error)) {
    reporter.pass("weekly pay anon ACL probe denied", probeAnon.error.message);
  } else {
    reporter.fail("weekly pay anon ACL probe denied", probeAnon.error?.message ?? "ok");
  }

  const { data: item } = await fx.admin
    .from("weekly_application_items")
    .select("eligible_amount_yen, hourly_wage_yen, calculation_trace, transport_fee_yen")
    .eq("application_id", draft.data.id)
    .eq("work_record_id", weekly.wr1)
    .maybeSingle();
  if (
    item &&
    item.hourly_wage_yen === weekly.wageYen &&
    item.eligible_amount_yen === expectedItem1 &&
    item.calculation_trace?.eligibleAmountYen === expectedItem1
  ) {
    reporter.pass("weekly pay item calculation snapshot", "ok");
  } else {
    reporter.fail("weekly pay item calculation snapshot", JSON.stringify(item));
  }

  const workerDecrypt = await worker.client.rpc("decrypt_application_bank_account_number", {
    p_application_id: draft.data.id,
  });
  if (denied(workerDecrypt.error)) {
    reporter.pass("weekly pay worker decrypt denied", workerDecrypt.error.message);
  } else {
    reporter.fail(
      "weekly pay worker decrypt denied",
      workerDecrypt.error?.message ?? "decrypt succeeded",
    );
  }

  // Phase 5.1: decrypt EXECUTE revoked for API roles until Phase 6.
  const payerDecrypt = await reviewer.client.rpc("decrypt_application_bank_account_number", {
    p_application_id: draft.data.id,
  });
  if (denied(payerDecrypt.error)) {
    reporter.pass(
      "weekly pay payer decrypt EXECUTE denied until Phase 6",
      payerDecrypt.error.message,
    );
  } else {
    reporter.fail(
      "weekly pay payer decrypt EXECUTE denied until Phase 6",
      payerDecrypt.error?.message ?? String(payerDecrypt.data),
    );
  }

  const deactivate = await worker.client.rpc("deactivate_bank_account_masked", {
    p_bank_account_id: bank2.data?.id ?? bank.data.id,
  });
  if (deactivate.error) {
    reporter.fail("weekly pay bank deactivate masked", deactivate.error.message);
  } else {
    const deKeys = Object.keys(deactivate.data ?? {});
    if (
      deKeys.includes("account_number_ciphertext") ||
      deKeys.includes("account_number")
    ) {
      reporter.fail("weekly pay bank deactivate masked", "sensitive keys in response");
    } else if (deactivate.data.status === "inactive") {
      reporter.pass("weekly pay bank deactivate masked", "inactive + masked");
    } else {
      reporter.fail("weekly pay bank deactivate masked", `status=${deactivate.data.status}`);
    }
  }

  const legacyDeactivate = await worker.client.rpc("deactivate_bank_account", {
    p_bank_account_id: bank.data.id,
  });
  if (denied(legacyDeactivate.error)) {
    reporter.pass(
      "weekly pay legacy deactivate_bank_account EXECUTE denied",
      legacyDeactivate.error.message,
    );
  } else {
    reporter.fail(
      "weekly pay legacy deactivate_bank_account EXECUTE denied",
      legacyDeactivate.error?.message ?? "legacy deactivate succeeded",
    );
  }

  const outsiderSnap = await outsider.client
    .from("application_bank_snapshots")
    .select("application_id")
    .eq("application_id", draft.data.id)
    .maybeSingle();
  if (!outsiderSnap.data) {
    reporter.pass("weekly pay outsider snapshot denied", "0 rows");
  } else {
    reporter.fail("weekly pay outsider snapshot denied", "row visible");
  }

  const directSnapUpdate = await fx.admin
    .from("application_bank_snapshots")
    .update({ account_number_last4: "0000" })
    .eq("application_id", draft.data.id)
    .select("application_id");
  if (
    directSnapUpdate.error ||
    (Array.isArray(directSnapUpdate.data) && directSnapUpdate.data.length === 0)
  ) {
    reporter.pass(
      "weekly pay snapshot update blocked",
      directSnapUpdate.error?.message ?? "0 rows",
    );
  } else {
    reporter.fail("weekly pay snapshot update blocked", "update succeeded");
  }

  void FIXTURE_TAG;
}
