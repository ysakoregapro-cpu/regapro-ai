/**
 * Build Phase 8.1 6-person mapping review table into
 * tmp/legacy-import/_restricted/ (gitignored). Never prints emails or full names to stdout.
 *
 * Usage: node scripts/_phase81-person-review-table.mjs --org-id <uuid>
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { loadEnvFiles, requireEnv } from "./rls-integration/lib.mjs";

loadEnvFiles();

const args = process.argv.slice(2);
const argVal = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
};
const orgId = argVal("--org-id") ?? "d381bef7-768a-4325-a21e-f0b606e67ec2";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function prefix(id) {
  return typeof id === "string" ? id.slice(0, 8) : null;
}

function stripBom(s) {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

function readJsonSafe(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(stripBom(readFileSync(path, "utf8")));
}

const FOCUS = [
  { personKey: "P1", clueDisplayName: "加藤大樹", expectedExpense: 4, expectedAlloc: 55 },
  { personKey: "P2", clueDisplayName: "森藤雅騎", expectedExpense: 3, expectedAlloc: 51 },
  { personKey: "P3", clueDisplayName: "田中和希", expectedExpense: 3, expectedAlloc: 32 },
  { personKey: "P4", clueDisplayName: "三宅龍臣", expectedExpense: 1, expectedAlloc: 53 },
  { personKey: "P5", clueDisplayName: "大谷将士", expectedExpense: 1, expectedAlloc: 23 },
  { personKey: "P6", clueDisplayName: "高山恵哉", expectedExpense: 1, expectedAlloc: 15 },
];

function normName(s) {
  return String(s ?? "").replace(/\s+/g, "");
}

const expenseApps = readJson("tmp/legacy-import/expense/expense_applications.json");
const expenseProfiles = readJson("tmp/legacy-import/expense/profiles.json");
const expenseAuth = readJson("tmp/legacy-import/expense/auth_emails.json");
const expenseText =
  readJsonSafe("tmp/legacy-import/_restricted/expense_apps_text.json") ?? [];
const profileDisplay =
  readJsonSafe("tmp/legacy-import/_restricted/profile_display_names.json") ?? [];
const salesMembers = readJson("tmp/legacy-import/sales/members.json");
const salesAllocs = readJson("tmp/legacy-import/sales/sales_allocations.json");
const salesRecords = readJson("tmp/legacy-import/sales/sales_records.json");
const salesAuth = readJson("tmp/legacy-import/sales/auth_emails.json");
const memberDisplayRows =
  readJsonSafe("tmp/legacy-import/_restricted/member_display_names.json") ?? [];
const newAuth = readJsonSafe("tmp/legacy-import/auth_emails_new.json") ?? [];
const manifest = readJsonSafe("tmp/legacy-import/DUMP_MANIFEST.json") ?? {};

const textById = new Map(expenseText.map((t) => [t.id, t]));
const profileById = new Map(expenseProfiles.map((p) => [p.id, p]));
const profileDisplayById = new Map(profileDisplay.map((p) => [p.id, p]));
const expenseAuthById = new Map(expenseAuth.map((e) => [e.id, e]));
const salesAuthById = new Map(salesAuth.map((e) => [e.id, e]));
const memberDisplayById = new Map(memberDisplayRows.map((m) => [m.id, m]));

const allocsByMember = new Map();
for (const a of salesAllocs) {
  const list = allocsByMember.get(a.member_id) ?? [];
  list.push(a);
  allocsByMember.set(a.member_id, list);
}

const expenseByNormName = new Map();
for (const app of expenseApps) {
  const profileName = profileDisplayById.get(app.applicant_id)?.display_name;
  const snap = textById.get(app.id)?.applicant_name_snapshot;
  const name = profileName ?? snap;
  if (!name) continue;
  const key = normName(name);
  const list = expenseByNormName.get(key) ?? [];
  list.push(app);
  expenseByNormName.set(key, list);
}

const memberDisplay = (m) =>
  memberDisplayById.get(m.id)?.display_name ?? m.display_name ?? null;

const salesByNormName = new Map();
for (const m of salesMembers) {
  const name = memberDisplay(m);
  if (!name) continue;
  const key = normName(name);
  const list = salesByNormName.get(key) ?? [];
  list.push(m);
  salesByNormName.set(key, list);
}

const { url: newUrl, secret: newKey } = requireEnv();
const newDb = createClient(newUrl, newKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: staffRows, error: staffErr } = await newDb
  .from("staff")
  .select("staff_id, staff_no, name, status, employment_type")
  .eq("org_id", orgId);
if (staffErr) throw staffErr;

const { data: identityRows } = await newDb
  .from("staff_identities")
  .select("staff_id, identity_type, auth_user_id, source_system, external_user_id")
  .in(
    "staff_id",
    (staffRows ?? []).map((s) => s.staff_id),
  );

const staffById = new Map((staffRows ?? []).map((s) => [s.staff_id, s]));
const newEmailByStaff = new Map();
for (const row of newAuth) {
  if (row.staff_id && row.email_md5) newEmailByStaff.set(row.staff_id, row);
}

const crossMd5 = new Set(manifest.email_md5_cross_match?.all_three_projects ?? []);

function emailMatchStatus(legacyAuthRow) {
  if (!legacyAuthRow?.confirmed || !legacyAuthRow.email_md5) {
    return { hasConfirmedEmail: false, matchClass: "no_confirmed_email" };
  }
  const md5 = legacyAuthRow.email_md5;
  const hits = [...newEmailByStaff.entries()].filter(([, r]) => r.email_md5 === md5);
  if (crossMd5.has(md5)) {
    return {
      hasConfirmedEmail: true,
      matchClass: "cross_project_candidate",
      newStaffPrefixes: hits.map(([sid]) => prefix(sid)),
      newStaffNos: hits.map(([sid]) => staffById.get(sid)?.staff_no ?? null),
    };
  }
  if (hits.length === 1) {
    return {
      hasConfirmedEmail: true,
      matchClass: "email_md5_unique_candidate",
      newStaffPrefixes: [prefix(hits[0][0])],
      newStaffNos: [staffById.get(hits[0][0])?.staff_no ?? null],
    };
  }
  if (hits.length > 1) {
    return {
      hasConfirmedEmail: true,
      matchClass: "email_md5_collision",
      newStaffPrefixes: hits.map(([sid]) => prefix(sid)),
    };
  }
  return {
    hasConfirmedEmail: true,
    matchClass: "confirmed_email_no_new_match",
  };
}

function staffCandidatesByName(clueName) {
  const norm = normName(clueName);
  return (staffRows ?? [])
    .filter((s) => {
      const n = normName(s.name ?? "");
      return n === norm || n.includes(norm) || norm.includes(n);
    })
    .map((s) => ({
      staffIdPrefix: prefix(s.staff_id),
      staffNo: s.staff_no,
      status: s.status,
      recordKind: s.record_kind ?? null,
      affiliationKind: s.affiliation_kind ?? null,
      isLikelyFixture:
        /^RLSFIX/i.test(s.staff_no ?? "") || /rls|fixture|integration/i.test(s.name ?? ""),
      nameMatchesClue: true,
    }));
}

const rows = [];
const decisions = [];

for (const focus of FOCUS) {
  const clueKey = normName(focus.clueDisplayName);
  const expApps = expenseByNormName.get(clueKey) ?? [];
  const expApplicantIds = [...new Set(expApps.map((a) => a.applicant_id))];
  const expenseSides = expApplicantIds.map((pid) => {
    const profile = profileById.get(pid);
    const auth = expenseAuthById.get(pid);
    return {
      source: "legacy_expense",
      profileIdPrefix: prefix(pid),
      profileId: pid,
      authIdPrefix: prefix(pid), // expense profiles use profile id as auth
      authId: pid,
      loginId: profile?.login_id ?? profileDisplayById.get(pid)?.login_id ?? null,
      displayNameSnapshot:
        profileDisplayById.get(pid)?.display_name ?? focus.clueDisplayName,
      applicationCount: expApps.filter((a) => a.applicant_id === pid).length,
      email: emailMatchStatus(auth),
    };
  });

  const members = salesByNormName.get(clueKey) ?? [];

  const salesSides = members.map((m) => {
    const auth = salesAuthById.get(m.auth_user_id);
    const allocs = allocsByMember.get(m.id) ?? [];
    return {
      source: "legacy_sales",
      memberIdPrefix: prefix(m.id),
      memberId: m.id,
      authIdPrefix: prefix(m.auth_user_id),
      authId: m.auth_user_id,
      displayNameSnapshot: memberDisplay(m),
      allocationCount: allocs.length,
      email: emailMatchStatus(auth),
    };
  });

  // Cross-system email same-person hint (never auto-bind)
  let expenseSalesEmailSame = false;
  for (const e of expenseSides) {
    for (const s of salesSides) {
      const ea = expenseAuthById.get(e.profileId);
      const sa = salesAuthById.get(s.authId);
      if (ea?.confirmed && sa?.confirmed && ea.email_md5 && ea.email_md5 === sa.email_md5) {
        expenseSalesEmailSame = true;
      }
    }
  }

  const staffCandidates = staffCandidatesByName(focus.clueDisplayName).filter(
    (c) => !c.isLikelyFixture,
  );
  const fixtureHits = staffCandidatesByName(focus.clueDisplayName).filter(
    (c) => c.isLikelyFixture,
  );

  const row = {
    personKey: focus.personKey,
    clueDisplayName: focus.clueDisplayName,
    expected: {
      expenseApplications: focus.expectedExpense,
      salesAllocations: focus.expectedAlloc,
    },
    observed: {
      expenseApplications: expApps.length,
      salesAllocations: salesSides.reduce((n, s) => n + s.allocationCount, 0),
      expenseProfileDistinct: expenseSides.length,
      salesMemberDistinct: salesSides.length,
    },
    countMatch:
      expApps.length === focus.expectedExpense &&
      salesSides.reduce((n, s) => n + s.allocationCount, 0) === focus.expectedAlloc,
    expenseLegacy: expenseSides.map((e) => ({
      profileIdPrefix: e.profileIdPrefix,
      authIdPrefix: e.authIdPrefix,
      loginId: e.loginId,
      applicationCount: e.applicationCount,
      emailMatchClass: e.email.matchClass,
      newStaffCandidatePrefixes: e.email.newStaffPrefixes ?? [],
      newStaffCandidateNos: e.email.newStaffNos ?? [],
    })),
    salesLegacy: salesSides.map((s) => ({
      memberIdPrefix: s.memberIdPrefix,
      authIdPrefix: s.authIdPrefix,
      allocationCount: s.allocationCount,
      emailMatchClass: s.email.matchClass,
      newStaffCandidatePrefixes: s.email.newStaffPrefixes ?? [],
      newStaffCandidateNos: s.email.newStaffNos ?? [],
    })),
    // Full IDs only in restricted file for operator confirmation SQL
    _restrictedIds: {
      expenseProfiles: expenseSides.map((e) => ({
        profileId: e.profileId,
        authId: e.authId,
        applicationCount: e.applicationCount,
      })),
      salesMembers: salesSides.map((s) => ({
        memberId: s.memberId,
        authId: s.authId,
        allocationCount: s.allocationCount,
      })),
    },
    expenseSalesSameEmailMd5: expenseSalesEmailSame,
    sameNameMayBeDifferentPeople: !expenseSalesEmailSame && expenseSides.length + salesSides.length > 1,
    newAppStaffCandidates: staffCandidates,
    fixtureNameCollisionsDoNotBind: fixtureHits.map((f) => ({
      staffIdPrefix: f.staffIdPrefix,
      staffNo: f.staffNo,
    })),
    decisionsNeeded: [],
  };

  if (expenseSides.length === 0) {
    row.decisionsNeeded.push("expense_profile_not_found_for_clue_name");
  }
  if (salesSides.length === 0) {
    row.decisionsNeeded.push("sales_member_not_found_for_clue_name");
  }
  if (expenseSides.length > 1) {
    row.decisionsNeeded.push("multiple_expense_profiles_same_display_name");
  }
  if (salesSides.length > 1) {
    row.decisionsNeeded.push("multiple_sales_members_same_display_name");
  }
  if (row.sameNameMayBeDifferentPeople) {
    row.decisionsNeeded.push(
      "confirm_whether_expense_and_sales_same_named_rows_are_same_person",
    );
  }
  if (staffCandidates.length === 0) {
    row.decisionsNeeded.push(
      "create_operational_staff_shell_after_affiliation_confirm_do_not_bind_fixture",
    );
  } else if (staffCandidates.length > 1) {
    row.decisionsNeeded.push("choose_which_operational_staff_row");
  } else {
    row.decisionsNeeded.push(
      "confirm_affiliation_kind_and_approve_mapping_to_single_staff_candidate",
    );
  }
  row.decisionsNeeded.push(
    "do_not_invite_legacy_email_as_login_until_explicitly_approved",
  );
  row.decisionsNeeded.push(
    "do_not_assign_business_roles_until_person_and_affiliation_confirmed",
  );

  rows.push(row);
  decisions.push({
    personKey: focus.personKey,
    expenseApps: row.observed.expenseApplications,
    salesAllocs: row.observed.salesAllocations,
    expenseSalesEmailLinked: expenseSalesEmailSame,
    operationalStaffCandidateN: staffCandidates.length,
    decisionsNeeded: row.decisionsNeeded,
  });
}

// Reviewer row (not one of the 6, but needed for history)
const reviewerIds = expenseApps
  .map((a) => a.reviewed_by)
  .filter(Boolean);
const reviewerCounts = new Map();
for (const id of reviewerIds) {
  reviewerCounts.set(id, (reviewerCounts.get(id) ?? 0) + 1);
}
const reviewerRows = [...reviewerCounts.entries()].map(([id, n]) => {
  const profile = profileById.get(id);
  return {
    role: "expense_reviewer",
    profileIdPrefix: prefix(id),
    profileId: id,
    reviewedApplicationCount: n,
    displayName: profile?.display_name ?? textById.get(
      expenseApps.find((a) => a.reviewed_by === id)?.id,
    ) /* may be null */ ?? null,
    note: "Keep as legacy_id + name snapshot; staff mapping optional for history",
  };
});

// Try get reviewer names from events overlay
const eventsText =
  readJsonSafe("tmp/legacy-import/_restricted/expense_events_text.json") ?? [];

const noAllocSales = salesRecords.filter((sr) => {
  const n = salesAllocs.filter((a) => a.sales_record_id === sr.id).length;
  return n === 0;
});

const out = {
  generated_at: new Date().toISOString(),
  orgIdPrefix: prefix(orgId),
  policy: [
    "Display names are review clues only — never auto-join key",
    "Email match is candidate only — never writes migration_approved_identities",
    "Expense and sales same display name may be different people",
    "Do not bind to fixture staff",
    "Do not auto-invite legacy emails",
    "3-PJ common email (テスト申請者 / 酒匂) is out of scope for these 6",
  ],
  focusPeople: rows,
  reviewerLegacy: reviewerRows.map((r) => ({
    profileIdPrefix: r.profileIdPrefix,
    reviewedApplicationCount: r.reviewedApplicationCount,
    profileId: r.profileId,
  })),
  noAllocationSales: {
    count: noAllocSales.length,
    allInactive: noAllocSales.every((s) => !s.is_active || s.deleted_at),
    idPrefixes: noAllocSales.map((s) => prefix(s.id)),
    ids: noAllocSales.map((s) => s.id),
    holdReason: "no_allocations",
    personalPublish: false,
  },
  crossProjectEmailNote: {
    inScopeForSix: false,
    doNotAutoBindExpenseTestApplicantToSakawa: true,
  },
  publicSummary: {
    focusPersonN: 6,
    expenseApplicationsCovered: rows.reduce((n, r) => n + r.observed.expenseApplications, 0),
    salesAllocationsCovered: rows.reduce((n, r) => n + r.observed.salesAllocations, 0),
    peopleWithZeroOperationalStaff: rows.filter((r) => r.newAppStaffCandidates.length === 0)
      .length,
    peopleNeedingExpenseSalesSamePersonDecision: rows.filter((r) => r.sameNameMayBeDifferentPeople)
      .length,
    decisions,
  },
};

mkdirSync("tmp/legacy-import/_restricted", { recursive: true });
const outPath = "tmp/legacy-import/_restricted/person_mapping_review.json";
writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`, "utf8");

// Sanitized console: keys + counts only
console.log(
  JSON.stringify(
    {
      wrote: outPath,
      publicSummary: out.publicSummary,
      countChecks: rows.map((r) => ({
        personKey: r.personKey,
        countMatch: r.countMatch,
        expense: r.observed.expenseApplications,
        alloc: r.observed.salesAllocations,
        expenseProfiles: r.expenseLegacy.length,
        salesMembers: r.salesLegacy.length,
        emailExpense: r.expenseLegacy.map((e) => e.emailMatchClass),
        emailSales: r.salesLegacy.map((s) => s.emailMatchClass),
        expenseSalesSameEmail: r.expenseSalesSameEmailMd5,
        staffCandidates: r.newAppStaffCandidates.length,
      })),
      noAllocSales: out.noAllocationSales.count,
      reviewerDistinct: reviewerRows.length,
    },
    null,
    2,
  ),
);
