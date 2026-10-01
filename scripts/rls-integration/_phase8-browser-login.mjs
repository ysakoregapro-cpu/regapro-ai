/**
 * Phase 8 logged-in browser checks (PC + mobile) against local Next.
 * Creates a tagged fixture user, grants shift/work/weekly/expense/sales roles,
 * exercises login + key work screens, then cleans up.
 */
import { chromium, devices } from "playwright";
import {
  createAdminClient,
  createUserClient,
  fixtureEmail,
  fixturePassword,
  loadEnvFiles,
  newRunId,
  requireEnv,
  FIXTURE_TAG,
} from "./lib.mjs";

loadEnvFiles();
const env = requireEnv();
const base = (process.env.REGAPRO_WEB_URL || "http://127.0.0.1:3010").replace(/\/$/, "");
const runId = newRunId();
const password = fixturePassword();
const email = fixtureEmail(runId, "p8browser");
const admin = createAdminClient(env.url, env.secret);

const { data: org } = await admin.from("organizations").select("id").eq("slug", "regapro").maybeSingle();
if (!org?.id) throw new Error("org regapro missing");

const { data: authUser, error: authErr } = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  user_metadata: { display_name: `[${FIXTURE_TAG}:${runId}] p8 browser` },
});
if (authErr) throw authErr;
const userId = authUser.user.id;

const { data: staff, error: staffErr } = await admin
  .from("staff")
  .insert({
    org_id: org.id,
    staff_no: `P8${runId.slice(0, 6)}`.toUpperCase(),
    name: `[${FIXTURE_TAG}:${runId}] p8 browser`,
    employment_type: "employee",
    status: "active",
  })
  .select("staff_id")
  .single();
if (staffErr) throw staffErr;

await admin.from("staff_identities").insert({
  staff_id: staff.staff_id,
  identity_type: "app_auth",
  source_system: "app",
  external_user_id: userId,
  auth_user_id: userId,
});

await admin.from("profiles").upsert({
  user_id: userId,
  display_name: `[${FIXTURE_TAG}:${runId}] p8 browser`,
});

const { data: dept } = await admin
  .from("departments")
  .select("id")
  .eq("org_id", org.id)
  .limit(1)
  .maybeSingle();

const { data: membership, error: memErr } = await admin
  .from("organization_memberships")
  .insert({ org_id: org.id, user_id: userId, department_id: dept?.id ?? null })
  .select("id")
  .single();
if (memErr) throw memErr;

const { data: editorRole } = await admin
  .from("roles")
  .select("id")
  .eq("org_id", org.id)
  .eq("key", "editor")
  .maybeSingle();
if (editorRole?.id) {
  await admin.from("membership_roles").insert({
    membership_id: membership.id,
    role_id: editorRole.id,
  });
}

const roleKeys = [
  "platform_shift_user",
  "platform_shift_manager",
  "platform_work_record_user",
  "platform_work_record_manager",
  "platform_employment_terms_manager",
  "platform_weekly_pay_submitter",
  "platform_weekly_pay_reviewer",
  "platform_weekly_pay_payer",
  "platform_expense_submitter",
  "platform_expense_manager",
  "platform_sales_viewer",
  "platform_sales_manager",
];
for (const key of roleKeys) {
  const { data: role } = await admin
    .from("roles")
    .select("id")
    .is("org_id", null)
    .eq("key", key)
    .is("deleted_at", null)
    .maybeSingle();
  if (!role) continue;
  await admin.from("staff_role_assignments").insert({
    org_id: org.id,
    staff_id: staff.staff_id,
    role_id: role.id,
    scope_type: "organization",
  });
}

async function probe(label, contextOptions) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  const out = [];
  try {
    await page.goto(`${base}/login`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.fill('input[type="email"], input[name="email"]', email);
    await page.fill('input[type="password"], input[name="password"]', password);
    await page.click('button[type="submit"]');
    await page.waitForTimeout(2500);

    for (const path of [
      "/work/shift",
      "/work/records",
      "/work/weekly-pay",
      "/work/expense",
      "/work/sales",
    ]) {
      const res = await page.goto(`${base}${path}`, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      const status = res?.status() ?? 0;
      const body = await page.locator("body").innerText().catch(() => "");
      const hasFocus =
        /今やること|対象と状態|次の操作/.test(body) ||
        /経費|売上|シフト|勤務|週払/.test(body);
      const notLogin = !page.url().includes("/login");
      const ok = status < 500 && notLogin && hasFocus && !/内部エラー|Application error/i.test(body);
      const overflow = await page.evaluate(() => {
        const doc = document.documentElement;
        return doc.scrollWidth > doc.clientWidth + 2;
      });
      out.push({ path, status, ok, overflow, url: page.url().replace(base, "") });
      console.log(
        `${ok ? "PASS" : "FAIL"} [${label}] ${path} status=${status} overflow=${overflow} → ${page.url().replace(base, "")}`,
      );
    }

    // Wage empty default check on records
    await page.goto(`${base}/work/records`, { waitUntil: "domcontentloaded" });
    const wage = await page.locator('input[type="number"]').first().inputValue().catch(() => "n/a");
    const wageOk = wage === "" || wage === "n/a" || Number(wage) === 0;
    console.log(`${wageOk ? "PASS" : "FAIL"} [${label}] hourly wage not prefilled with 1200 (value=${wage})`);
    out.push({ path: "wage-default", ok: wageOk, wage });
  } finally {
    await context.close();
    await browser.close();
  }
  return out;
}

let failed = 0;
try {
  const desktop = await probe("desktop", { viewport: { width: 1280, height: 800 } });
  const mobile = await probe("mobile", { ...devices["iPhone 13"] });
  failed = [...desktop, ...mobile].filter((r) => !r.ok).length;
  console.log(`\nLogged-in browser: failed=${failed}`);
} finally {
  await admin.from("staff_role_assignments").delete().eq("staff_id", staff.staff_id);
  await admin.from("staff_identities").delete().eq("staff_id", staff.staff_id);
  if (membership?.id) {
    await admin.from("organization_memberships").delete().eq("id", membership.id);
  }
  await admin.from("staff").delete().eq("staff_id", staff.staff_id);
  await admin.auth.admin.deleteUser(userId);
}

if (failed) process.exitCode = 1;
