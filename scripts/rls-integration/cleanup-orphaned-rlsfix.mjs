/**
 * Clean leftover RLSFIX / rlsfix-* fixture rows from the new app.
 * Never deletes staff_no RP-* or organizations that are not rlsfix-*.
 *
 * Usage:
 *   node scripts/rls-integration/cleanup-orphaned-rlsfix.mjs --dry-run
 *   node scripts/rls-integration/cleanup-orphaned-rlsfix.mjs --apply
 */
import { loadEnvFiles, requireEnv, createAdminClient, FIXTURE_TAG } from "./lib.mjs";

loadEnvFiles();
const apply = process.argv.includes("--apply");
const { url, secret } = requireEnv();
const admin = createAdminClient(url, secret);

const report = {
  mode: apply ? "apply" : "dry-run",
  fixtureTag: FIXTURE_TAG,
  found: {},
  deleted: {},
};

const { data: rlsOrgs, error: orgErr } = await admin
  .from("organizations")
  .select("id, slug")
  .like("slug", "rlsfix-%");
if (orgErr) throw orgErr;

const { data: fixStaff, error: stErr } = await admin
  .from("staff")
  .select("staff_id, staff_no, org_id")
  .like("staff_no", `${FIXTURE_TAG}%`);
if (stErr) throw stErr;

const orgIds = (rlsOrgs ?? []).map((o) => o.id);
const staffIds = (fixStaff ?? []).map((s) => s.staff_id);

report.found = {
  rlsfixOrgs: (rlsOrgs ?? []).length,
  rlsfixStaff: (fixStaff ?? []).length,
  protectedNote: "staff_no RP-* and non-rlsfix orgs are never deleted",
};

if (!apply) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

async function del(table, column, ids) {
  if (!ids.length) return 0;
  const { error, count } = await admin.from(table).delete({ count: "exact" }).in(column, ids);
  if (error) throw new Error(`${table}: ${error.message}`);
  return count ?? ids.length;
}

// Child rows referencing fixture staff (best-effort; ignore missing tables).
for (const [table, col] of [
  ["permission_audit_events", "subject_staff_id"],
  ["staff_permission_overrides", "staff_id"],
  ["staff_role_assignments", "staff_id"],
  ["staff_departments", "staff_id"],
  ["staff_identities", "staff_id"],
  ["expense_applications", "staff_id"],
  ["personal_sales_cases", "staff_id"],
  ["personal_sales_allocations", "staff_id"],
]) {
  try {
    report.deleted[table] = await del(table, col, staffIds);
  } catch (e) {
    report.deleted[table] = `skip: ${e.message}`;
  }
}

report.deleted.staff = await del("staff", "staff_id", staffIds);

// Fixture-only orgs: delete categories then org.
if (orgIds.length) {
  try {
    report.deleted.expense_categories = await del("expense_categories", "org_id", orgIds);
  } catch (e) {
    report.deleted.expense_categories = `skip: ${e.message}`;
  }
  report.deleted.organizations = await del("organizations", "id", orgIds);
}

const { count: remainStaff } = await admin
  .from("staff")
  .select("staff_id", { count: "exact", head: true })
  .like("staff_no", `${FIXTURE_TAG}%`);
const { count: remainOrgs } = await admin
  .from("organizations")
  .select("id", { count: "exact", head: true })
  .like("slug", "rlsfix-%");
report.remaining = { rlsfixStaff: remainStaff ?? 0, rlsfixOrgs: remainOrgs ?? 0 };

console.log(JSON.stringify(report, null, 2));
process.exit(report.remaining.rlsfixStaff || report.remaining.rlsfixOrgs ? 1 : 0);
