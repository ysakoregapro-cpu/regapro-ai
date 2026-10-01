/**
 * Phase 7 read-only legacy identity dry-run.
 * Never writes to legacy projects. Never auto-links by display name alone.
 *
 * Usage (from repo root, with env for NEW app service role):
 *   node scripts/legacy-identity-dry-run.mjs
 *
 * Optional legacy RO keys (if absent, legacy sections report skipped):
 *   LEGACY_WEEKLY_PAY_URL / LEGACY_WEEKLY_PAY_SERVICE_ROLE_KEY  (iizsiaggtcbinmblpfqw)
 *   LEGACY_EXPENSE_URL / LEGACY_EXPENSE_SERVICE_ROLE_KEY        (wqlpojgpxcbkrtfjtgad)
 */
import { createClient } from "@supabase/supabase-js";
import { loadEnvFiles, requireEnv } from "./rls-integration/lib.mjs";

loadEnvFiles();

function requireNewEnv() {
  const env = requireEnv();
  return { url: env.url, key: env.secret };
}

function client(url, key) {
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function normalizeCode(v) {
  if (typeof v !== "string") return "";
  return v.trim().toLowerCase();
}

function classifyMatches(legacyRows, newByStaffNo, newByAuth, newByEmail) {
  const unique = [];
  const duplicates = [];
  const unmatched = [];
  const nameOnlyHints = [];

  for (const row of legacyRows) {
    const candidates = new Map();
    const methods = [];
    if (row.employeeCode) {
      const hit = newByStaffNo.get(normalizeCode(row.employeeCode));
      if (hit) {
        candidates.set(hit.staffId, hit);
        methods.push("staff_no");
      }
    }
    if (row.authUserId) {
      const hit = newByAuth.get(row.authUserId);
      if (hit) {
        candidates.set(hit.staffId, hit);
        methods.push("auth_user_id");
      }
    }
    if (row.email) {
      const hit = newByEmail.get(normalizeCode(row.email));
      if (hit) {
        candidates.set(hit.staffId, hit);
        methods.push("email");
      }
    }
    const list = [...candidates.values()];
    if (list.length === 1) {
      unique.push({
        externalUserId: row.externalUserId,
        staffId: list[0].staffId,
        methods: [...new Set(methods)],
      });
    } else if (list.length > 1) {
      duplicates.push({
        externalUserId: row.externalUserId,
        staffIds: list.map((s) => s.staffId),
        methods: [...new Set(methods)],
      });
    } else {
      unmatched.push({
        externalUserId: row.externalUserId,
        employeeCode: row.employeeCode ?? null,
        hasEmail: Boolean(row.email),
        hasAuth: Boolean(row.authUserId),
      });
      if (row.displayName) {
        nameOnlyHints.push({
          externalUserId: row.externalUserId,
          displayNamePresent: true,
          note: "name-only never auto-linked",
        });
      }
    }
  }

  return {
    sourceCount: legacyRows.length,
    uniqueCandidateCount: unique.length,
    duplicateCandidateCount: duplicates.length,
    unmatchedCount: unmatched.length,
    nameOnlyHintCount: nameOnlyHints.length,
    samples: {
      unique: unique.slice(0, 5),
      duplicates: duplicates.slice(0, 5),
      unmatched: unmatched.slice(0, 5),
    },
  };
}

const newEnv = requireNewEnv();
const newDb = client(newEnv.url, newEnv.key);

const { data: staffRows, error: staffErr } = await newDb
  .from("staff")
  .select("staff_id, staff_no, name, status");
if (staffErr) throw staffErr;

const { data: identityRows, error: idErr } = await newDb
  .from("staff_identities")
  .select("staff_id, identity_type, source_system, external_user_id, auth_user_id, metadata");
if (idErr) throw idErr;

const newByStaffNo = new Map();
const newByAuth = new Map();
const newByEmail = new Map();
for (const s of staffRows ?? []) {
  const row = {
    staffId: s.staff_id,
    staffNo: s.staff_no,
    name: s.name,
  };
  if (s.staff_no) newByStaffNo.set(normalizeCode(s.staff_no), row);
}
for (const id of identityRows ?? []) {
  const staff = (staffRows ?? []).find((s) => s.staff_id === id.staff_id);
  if (!staff) continue;
  const row = { staffId: staff.staff_id, staffNo: staff.staff_no, name: staff.name };
  if (id.auth_user_id) newByAuth.set(id.auth_user_id, row);
  const metaEmail =
    id.metadata && typeof id.metadata === "object" ? id.metadata.email : null;
  if (typeof metaEmail === "string" && metaEmail) {
    newByEmail.set(normalizeCode(metaEmail), row);
  }
}

const report = {
  newApp: {
    project: "hymadulmvnbnxfqaqccp",
    staffActive: (staffRows ?? []).filter((s) => s.status === "active").length,
    staffWithStaffNo: (staffRows ?? []).filter((s) => s.staff_no).length,
    staffWithoutStaffNo: (staffRows ?? []).filter((s) => !s.staff_no).length,
    identities: (identityRows ?? []).length,
    identitySources: Object.fromEntries(
      Object.entries(
        (identityRows ?? []).reduce((acc, r) => {
          const k = `${r.source_system}:${r.identity_type}`;
          acc[k] = (acc[k] ?? 0) + 1;
          return acc;
        }, {}),
      ),
    ),
    migrationBatches: null,
    migrationMatches: null,
  },
  legacy: {},
  writes: "none — dry-run only; legacy projects untouched",
};

const { count: batchCount } = await newDb
  .from("migration_import_batches")
  .select("*", { count: "exact", head: true });
const { count: matchCount } = await newDb
  .from("migration_identity_matches")
  .select("*", { count: "exact", head: true });
report.newApp.migrationBatches = batchCount ?? 0;
report.newApp.migrationMatches = matchCount ?? 0;

const wpUrl = process.env.LEGACY_WEEKLY_PAY_URL;
const wpKey = process.env.LEGACY_WEEKLY_PAY_SERVICE_ROLE_KEY;
if (wpUrl && wpKey) {
  const wp = client(wpUrl, wpKey);
  const { data: profiles, error } = await wp
    .from("profiles")
    .select("user_id, display_name, employee_code, is_active");
  if (error) {
    report.legacy.weekly_pay = { error: error.message, project: "iizsiaggtcbinmblpfqw" };
  } else {
    const rows = (profiles ?? []).map((p) => ({
      externalUserId: p.user_id,
      authUserId: p.user_id,
      employeeCode: p.employee_code ?? null,
      email: null,
      displayName: p.display_name ?? null,
    }));
    report.legacy.weekly_pay = {
      project: "iizsiaggtcbinmblpfqw",
      ...classifyMatches(rows, newByStaffNo, newByAuth, newByEmail),
      note: "auth user_id ≠ staff_id; employee_code→staff_no candidate only",
    };
  }
} else {
  report.legacy.weekly_pay = {
    project: "iizsiaggtcbinmblpfqw",
    skipped: true,
    reason: "LEGACY_WEEKLY_PAY_* env not set; MCP earlier count was 0 profiles / 0 work_records",
    knownCountsFromRemoteRead: {
      profiles: 0,
      work_records: 0,
      employment_terms: 0,
      weekly_applications: 0,
      bank_accounts: 0,
    },
  };
}

const exUrl = process.env.LEGACY_EXPENSE_URL;
const exKey = process.env.LEGACY_EXPENSE_SERVICE_ROLE_KEY;
if (exUrl && exKey) {
  const ex = client(exUrl, exKey);
  const { data: profiles, error } = await ex
    .from("profiles")
    .select("id, login_id, display_name, role, is_active");
  if (error) {
    report.legacy.expense = { error: error.message, project: "wqlpojgpxcbkrtfjtgad" };
  } else {
    const rows = (profiles ?? []).map((p) => ({
      externalUserId: String(p.id),
      authUserId: null,
      employeeCode: null,
      email: typeof p.login_id === "string" && p.login_id.includes("@") ? p.login_id : null,
      displayName: p.display_name ?? null,
      loginId: p.login_id ?? null,
    }));
    // login_id may be staff_no-like; try as staff_no candidate when not email
    for (const r of rows) {
      if (!r.email && r.loginId) r.employeeCode = r.loginId;
    }
    report.legacy.expense = {
      project: "wqlpojgpxcbkrtfjtgad",
      ...classifyMatches(rows, newByStaffNo, newByAuth, newByEmail),
      note: "login_id tried as email or staff_no; display_name never auto-links",
    };
  }
} else {
  report.legacy.expense = {
    project: "wqlpojgpxcbkrtfjtgad",
    skipped: true,
    reason: "LEGACY_EXPENSE_* env not set; MCP earlier count was 9 profiles",
    knownCountsFromRemoteRead: { profiles: 9 },
    columns: ["id", "login_id", "display_name", "role", "is_active"],
  };
}

report.legacy.sales = {
  project: "bmkyfrimfeeqfjwgkfdu",
  note: "no staff/work/shift tables found in public schema (read-only inspect)",
};
report.legacy.company_os = {
  project: "pnprigtiwbrnpeueuzdp",
  note: "no staff/work/shift tables found in public schema (read-only inspect)",
};

console.log(JSON.stringify(report, null, 2));
