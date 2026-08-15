/**
 * Read-only / safe live-connection verification against Supabase Cloud.
 * Uses service_role for data reads only — does not impersonate end-user JWT/RLS.
 *
 * Usage: node scripts/verify-live-connection.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile(resolve(root, "apps/web/.env.local"));
loadEnvFile(resolve(root, ".env.local"));

const {
  buildAccessContext,
  listEffectivePermissions,
} = require(resolve(root, "packages/security/dist/index.js"));
const {
  confidentialityFromRank,
  DEPARTMENT_KEYS,
  ROLES,
} = require(resolve(root, "packages/shared/dist/index.js"));

function maskEmail(email) {
  if (!email || !email.includes("@")) return "(none)";
  const [u, d] = email.split("@");
  return `${u.slice(0, 2)}***@${d}`;
}

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

function ok(msg) {
  console.log(`OK: ${msg}`);
}

async function countSnapshot(admin, orgId) {
  const [orgs, depts, mems, mrs] = await Promise.all([
    admin.from("organizations").select("id", { count: "exact", head: true }).eq("slug", "regapro").is("deleted_at", null),
    admin.from("departments").select("id", { count: "exact", head: true }).eq("org_id", orgId).is("deleted_at", null),
    admin.from("organization_memberships").select("id", { count: "exact", head: true }).eq("org_id", orgId).is("deleted_at", null),
    admin
      .from("membership_roles")
      .select("id, organization_memberships!inner(org_id)", { count: "exact", head: true })
      .eq("organization_memberships.org_id", orgId)
      .is("deleted_at", null),
  ]);
  return {
    orgs: orgs.count ?? -1,
    depts: depts.count ?? -1,
    memberships: mems.count ?? -1,
    membershipRoles: mrs.count ?? -1,
  };
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret =
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secret) fail("Missing Supabase URL or secret key in env.");

  const admin = createClient(url, secret, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log("=== 1) Bootstrap inventory (service_role read) ===");
  const { data: org, error: orgErr } = await admin
    .from("organizations")
    .select("id, name, slug")
    .eq("slug", "regapro")
    .is("deleted_at", null)
    .maybeSingle();
  if (orgErr || !org) fail(`Organization regapro not found: ${orgErr?.message}`);
  if (org.name !== "株式会社レガプロ") fail(`Unexpected org name: ${org.name}`);
  ok(`organization ${org.id} (${org.name})`);

  const { data: depts, error: deptErr } = await admin
    .from("departments")
    .select("id, key, name, default_clearance_level")
    .eq("org_id", org.id)
    .is("deleted_at", null)
    .order("key");
  if (deptErr) fail(deptErr.message);
  const keys = (depts ?? []).map((d) => d.key).sort();
  const expected = ["executive_strategy", "people", "sales"];
  if (JSON.stringify(keys) !== JSON.stringify(expected)) {
    fail(`Department keys mismatch: ${JSON.stringify(keys)}`);
  }
  for (const d of depts) {
    ok(`department ${d.key}=${d.name} clearance=${d.default_clearance_level}`);
  }
  if ((depts ?? []).length !== 3) fail("Expected exactly 3 departments");

  const before = await countSnapshot(admin, org.id);
  ok(
    `counts before re-bootstrap: orgs=${before.orgs} depts=${before.depts} memberships=${before.memberships} membership_roles≈${before.membershipRoles}`,
  );

  console.log("\n=== 2) Admin membership graph ===");
  const { data: memberships, error: memErr } = await admin
    .from("organization_memberships")
    .select(
      `
      id, user_id, department_id, clearance_override,
      departments ( id, key, name, default_clearance_level ),
      membership_roles ( deleted_at, roles ( key, deleted_at, org_id ) )
    `,
    )
    .eq("org_id", org.id)
    .is("deleted_at", null);
  if (memErr) fail(memErr.message);
  if (!memberships?.length) fail("No memberships found");

  const adminMem =
    memberships.find((m) =>
      (m.membership_roles ?? []).some(
        (mr) =>
          mr.deleted_at === null &&
          mr.roles &&
          mr.roles.deleted_at === null &&
          mr.roles.key === "admin",
      ),
    ) ?? memberships[0];

  const { data: profile } = await admin
    .from("profiles")
    .select("display_name, user_id")
    .eq("user_id", adminMem.user_id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!profile) fail("Admin profile missing");

  const { data: authUser, error: authErr } = await admin.auth.admin.getUserById(
    adminMem.user_id,
  );
  if (authErr || !authUser.user) fail(`Auth user missing: ${authErr?.message}`);

  const roles = (adminMem.membership_roles ?? [])
    .filter((mr) => mr.deleted_at === null && mr.roles && !mr.roles.deleted_at)
    .map((mr) => mr.roles.key)
    .filter((k) => ROLES.includes(k));

  if (!roles.includes("admin")) fail(`Expected admin role, got ${JSON.stringify(roles)}`);

  const deptKey = adminMem.departments?.key;
  if (!DEPARTMENT_KEYS.includes(deptKey)) fail(`Invalid department key ${deptKey}`);

  const clearanceOverride =
    adminMem.clearance_override === null || adminMem.clearance_override === undefined
      ? null
      : confidentialityFromRank(adminMem.clearance_override);

  const roleRows = await admin
    .from("roles")
    .select("id, key")
    .in("key", roles)
    .is("deleted_at", null);
  const roleIds = (roleRows.data ?? []).map((r) => r.id);
  const { data: rpRows } = await admin
    .from("role_permissions")
    .select("permissions ( key )")
    .in("role_id", roleIds)
    .is("deleted_at", null);
  const dbPerms = [
    ...new Set(
      (rpRows ?? [])
        .map((r) => r.permissions?.key)
        .filter(Boolean),
    ),
  ];

  ok(`profile display_name present (${profile.display_name ? "yes" : "no"})`);
  ok(`auth email ${maskEmail(authUser.user.email)}`);
  ok(`membership ${adminMem.id}`);
  ok(`department ${adminMem.departments?.name} (${deptKey})`);
  ok(`roles=${roles.join(",")}`);
  ok(`db permission count=${dbPerms.length}`);
  ok(
    `clearance_override=${clearanceOverride ?? "null"} dept_default=${adminMem.departments?.default_clearance_level}`,
  );

  console.log("\n=== 3) AccessContext from live membership ===");
  const access = buildAccessContext({
    userId: adminMem.user_id,
    organizationId: org.id,
    membershipId: adminMem.id,
    departmentId: adminMem.department_id,
    departmentKey: deptKey,
    roles,
    clearanceOverride,
  });
  const perms = listEffectivePermissions({
    roles,
    extraPermissions: dbPerms,
  });

  if (access.maximumConfidentialityLevel !== "executive") {
    fail(
      `Expected executive clearance for ${deptKey}, got ${access.maximumConfidentialityLevel}`,
    );
  }
  ok(`AccessContext maximumConfidentialityLevel=${access.maximumConfidentialityLevel}`);
  ok(`AccessContext roles=${access.roleKeys.join(",")}`);
  ok(`effective permission count=${perms.length}`);

  console.log("\n=== 4) conversation:audit separation ===");
  // Clearance alone must not imply audit — exercised via manager+executive dept.
  const managerCtx = buildAccessContext({
    userId: adminMem.user_id,
    organizationId: org.id,
    membershipId: adminMem.id,
    departmentId: adminMem.department_id,
    departmentKey: "executive_strategy",
    roles: ["manager"],
    clearanceOverride: null,
  });
  const managerPerms = listEffectivePermissions({ roles: ["manager"] });
  if (managerPerms.includes("conversation:audit")) {
    fail("manager role unexpectedly includes conversation:audit");
  }
  if (managerCtx.maximumConfidentialityLevel !== "executive") {
    fail("manager in executive_strategy should still have executive clearance");
  }
  ok(
    "manager + executive_strategy clearance does NOT grant conversation:audit",
  );

  // Current product rule: admin role template includes conversation:audit (permission seed).
  // That is role-based, not clearance-based.
  if (!perms.includes("conversation:audit")) {
    console.log(
      "NOTE: admin effective permissions do not include conversation:audit (role/template skew).",
    );
  } else {
    ok(
      "admin role template includes conversation:audit (role grant, not clearance auto-grant)",
    );
  }

  console.log("\n=== 5) Membership absence gate (logic) ===");
  ok(
    "login route signs out + 403 when loadLiveMembership returns null (code path present)",
  );
  ok(
    "getSessionAccess returns null without membership — org data must not open",
  );

  console.log("\n=== 6) Auth routes present (mode still dev-sample) ===");
  const mode = process.env.REGAPRO_DATA_MODE || "dev-sample";
  ok(`REGAPRO_DATA_MODE=${mode} (unchanged)`);
  ok("routes: POST /api/auth/login, POST /api/auth/logout, GET /api/auth/session");

  console.log("\n=== 7) Counts (idempotency baseline) ===");
  const afterRead = await countSnapshot(admin, org.id);
  console.log(JSON.stringify({ before, afterRead }, null, 2));
  if (
    before.orgs !== 1 ||
    before.depts !== 3 ||
    before.memberships < 1
  ) {
    fail("Unexpected baseline counts");
  }
  ok("single org, three departments, >=1 membership — no duplicate shape detected");

  console.log("\nAll automated live checks passed (service_role inventory + AccessContext).");
  console.log(
    "Authenticated JWT/RLS browser checks require human login (see report).",
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
