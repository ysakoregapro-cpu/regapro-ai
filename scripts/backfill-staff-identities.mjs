/**
 * Staff identity backfill — dry-run audit (default) and atomic apply via Postgres RPC.
 *
 * Default: READ ONLY. No writes without --apply.
 *
 * Usage:
 *   npm run db:backfill-staff
 *   npm run db:backfill-staff -- --json
 *   npm run db:backfill-staff -- --live-target
 *   npm run db:backfill-staff -- --apply --auth-user <UUID> --employment-type executive --confirm <token>
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SECRET_KEY (service_role for reads;
 * apply calls regapro_backfill_staff_from_auth which is service_role only).
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
  LEGACY_PERMISSION_BRIDGE,
  withLegacyCompatibilityGrants,
} = require(resolve(root, "packages/platform/dist/index.js"));
const { listPlatformPermissions } = require(resolve(root, "packages/platform/dist/rbac.js"));
const {
  classifyUserCategory,
  isBackfillTarget,
  isFixtureEmail,
  validateEmploymentType,
  derivePlatformRolesFromAiPermissions,
  deriveExpectedPlatformPermissions,
  comparePermissionSnapshots,
  buildApplyConfirmToken,
  formatStaffNo,
  SOURCE_SYSTEM_REGAPRO_APP,
} = require(resolve(root, "packages/platform/dist/staff-backfill.js"));
const {
  confidentialityFromRank,
  ROLES,
  DEPARTMENT_KEYS,
} = require(resolve(root, "packages/shared/dist/index.js"));

function argValue(flag) {
  const idx = process.argv.indexOf(flag);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  const prefix = `${flag}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

const argv = process.argv.slice(2);
const applyMode = argv.includes("--apply");
const jsonOut = argv.includes("--json");
const liveTargetOnly = argv.includes("--live-target");
const authUserArg = argValue("--auth-user");
const employmentTypeArg = argValue("--employment-type");
const confirmArg = argValue("--confirm");

function fail(msg, code = 1) {
  console.error(`FAIL: ${msg}`);
  process.exit(code);
}

function shortId(id) {
  if (!id) return "(none)";
  return `${id.slice(0, 8)}…`;
}

function maskEmail(email) {
  if (!email || !email.includes("@")) return "(none)";
  const [u, d] = email.split("@");
  const visible = u.length <= 2 ? u[0] ?? "*" : u.slice(0, 2);
  return `${visible}***@${d}`;
}

function parseDepartmentKey(raw) {
  if (!raw) return null;
  return DEPARTMENT_KEYS.includes(raw) ? raw : null;
}

function parseRoles(membershipRoles) {
  return (membershipRoles ?? [])
    .filter((mr) => mr.deleted_at === null && mr.roles && !mr.roles.deleted_at)
    .map((mr) => mr.roles.key)
    .filter((k) => ROLES.includes(k));
}

async function listAllAuthUsers(admin) {
  const users = [];
  let page = 1;
  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) fail(`auth.users list failed: ${error.message}`);
    users.push(...(data.users ?? []));
    if ((data.users ?? []).length < 200) break;
    page += 1;
  }
  return users;
}

async function loadAiPermissionKeys(admin, membership, roles) {
  const roleIds = [];
  if (roles.length) {
    const { data: roleRows } = await admin
      .from("roles")
      .select("id, key")
      .in("key", roles)
      .is("deleted_at", null);
    roleIds.push(...(roleRows ?? []).map((r) => r.id));
  }
  const aiPermissionKeys = listEffectivePermissions({ roles });
  if (roleIds.length) {
    const { data: rpRows } = await admin
      .from("role_permissions")
      .select("permissions ( key, deleted_at )")
      .in("role_id", roleIds)
      .is("deleted_at", null);
    for (const rp of rpRows ?? []) {
      const p = rp.permissions;
      if (!p || p.deleted_at) continue;
      if (!aiPermissionKeys.includes(p.key)) aiPermissionKeys.push(p.key);
    }
  }
  return aiPermissionKeys.sort();
}

function buildBeforeSnapshot(membership, roles, aiPermissionKeys) {
  const deptKey = parseDepartmentKey(membership.departments?.key) ?? "sales";
  const clearanceOverride =
    membership.clearance_override == null
      ? null
      : confidentialityFromRank(membership.clearance_override);

  const ctx = withLegacyCompatibilityGrants(
    buildAccessContext({
      userId: membership.user_id,
      organizationId: membership.org_id,
      membershipId: membership.id,
      departmentId: membership.department_id,
      departmentKey: deptKey,
      roles,
      clearanceOverride,
    }),
  );

  return {
    aiAccess: (ctx.permissionKeys ?? []).length > 0,
    aiPermissionKeys: [...(ctx.permissionKeys ?? [])].sort(),
    clearance: ctx.maximumConfidentialityLevel,
    platformPermissions: listPlatformPermissions(ctx).sort(),
    legacyBridgeActive: true,
  };
}

function buildExpectedAfterSnapshot(membership, roles, aiPermissionKeys, employmentType) {
  const deptKey = parseDepartmentKey(membership.departments?.key) ?? "sales";
  const clearanceOverride =
    membership.clearance_override == null
      ? null
      : confidentialityFromRank(membership.clearance_override);
  const platformPerms = deriveExpectedPlatformPermissions(aiPermissionKeys);
  const grants = platformPerms.map((permission) => ({
    permission,
    scope: { type: "organization", id: null },
    effect: "allow",
    source: "role",
    roleId: null,
  }));

  const ctx = buildAccessContext({
    userId: membership.user_id,
    organizationId: membership.org_id,
    membershipId: membership.id,
    departmentId: membership.department_id,
    departmentKey: deptKey,
    roles,
    clearanceOverride,
    staff: {
      staffId: "00000000-0000-0000-0000-000000000001",
      staffNo: "RP-000001",
      name: "placeholder",
      employmentType,
      status: "active",
    },
    permissions: grants,
  });

  return {
    aiAccess: (ctx.permissionKeys ?? []).length > 0,
    aiPermissionKeys: [...(ctx.permissionKeys ?? [])].sort(),
    clearance: ctx.maximumConfidentialityLevel,
    platformPermissions: listPlatformPermissions(ctx).sort(),
    legacyBridgeActive: false,
    proposedPlatformRoles: derivePlatformRolesFromAiPermissions(aiPermissionKeys),
  };
}

async function rpcReady(admin) {
  const { error } = await admin.rpc("regapro_derive_platform_roles_from_ai_permissions", {
    p_ai_permission_keys: ["chat:use"],
  });
  if (!error) return true;
  const msg = error.message ?? "";
  return !msg.includes("Could not find the function") && !msg.includes("42883");
}

async function nextStaffNoPreview(admin, orgId) {
  const { data, error } = await admin
    .from("staff_no_counters")
    .select("last_value")
    .eq("org_id", orgId)
    .maybeSingle();
  if (error && !error.message.includes("does not exist")) return "(sequence migration not applied)";
  const next = (data?.last_value ?? 0) + 1;
  try {
    return formatStaffNo(next);
  } catch {
    return "(sequence migration not applied)";
  }
}

async function collectCandidates(admin, authUsers, memberships, profiles, existingIdentities) {
  const profileByUser = new Map((profiles ?? []).map((p) => [p.user_id, p]));
  const existingStaffByAuth = new Map();
  for (const ident of existingIdentities ?? []) {
    if (ident.auth_user_id && ident.identity_type === "app_auth") {
      existingStaffByAuth.set(ident.auth_user_id, ident);
    }
  }
  const membershipByUser = new Map();
  for (const m of memberships ?? []) {
    const list = membershipByUser.get(m.user_id) ?? [];
    list.push(m);
    membershipByUser.set(m.user_id, list);
  }

  const candidates = [];
  for (const authUser of authUsers) {
    const mems = membershipByUser.get(authUser.id) ?? [];
    for (const membership of mems) {
      const profile = profileByUser.get(authUser.id);
      const roles = parseRoles(membership.membership_roles);
      const aiPermissionKeys = await loadAiPermissionKeys(admin, membership, roles);
      const existingMatch = existingStaffByAuth.has(authUser.id)
        ? "exact"
        : "none";
      const isInactive =
        authUser.email_confirmed_at === null ||
        (authUser.banned_until && new Date(authUser.banned_until) > new Date());

      const userCategory = classifyUserCategory({
        hasMembership: true,
        hasRoles: roles.length > 0,
        aiPermissionKeys,
        existingMatch,
        isInactive,
      });

      const displayName =
        profile?.display_name || authUser.email?.split("@")[0] || "利用者";

      const before = buildBeforeSnapshot(membership, roles, aiPermissionKeys);
      const proposedPlatformRoles = derivePlatformRolesFromAiPermissions(aiPermissionKeys);
      const proposedStaffNo = await nextStaffNoPreview(admin, membership.org_id);

      candidates.push({
        auth_user_id: authUser.id,
        auth_user_id_short: shortId(authUser.id),
        email: maskEmail(authUser.email),
        email_raw_is_fixture: isFixtureEmail(authUser.email),
        user_category: userCategory,
        backfill_target: isBackfillTarget(userCategory),
        current_display_name: displayName,
        organization: membership.organizations?.name ?? membership.org_id,
        org_id: membership.org_id,
        membership_id: membership.id,
        department_id: membership.department_id,
        clearance_override: membership.clearance_override,
        current_department: membership.departments?.name ?? null,
        current_department_key: parseDepartmentKey(membership.departments?.key),
        current_roles: roles,
        current_ai_permission_keys: aiPermissionKeys,
        proposed_staff_no: proposedStaffNo,
        proposed_name: displayName,
        proposed_identity_type: "app_auth",
        source_system: SOURCE_SYSTEM_REGAPRO_APP,
        external_user_id: authUser.id,
        existing_staff_match: existingMatch,
        before,
        expected_after_preview: buildExpectedAfterSnapshot(
          membership,
          roles,
          aiPermissionKeys,
          "executive",
        ),
        permission_preservation_preview: comparePermissionSnapshots(
          before,
          buildExpectedAfterSnapshot(membership, roles, aiPermissionKeys, "executive"),
        ),
        proposed_transaction: {
          rpc: "regapro_backfill_staff_from_auth",
          params: {
            p_auth_user_id: authUser.id,
            p_employment_type: "<REQUIRED --employment-type>",
            p_actor_auth_user_id: null,
          },
          steps: [
            "regapro_next_staff_no(org_id) → staff_no",
            "INSERT staff",
            "INSERT staff_identities (app_auth, regapro_app)",
            "INSERT staff_role_assignments (permission-derived platform roles)",
            "permission preservation gate inside RPC",
            "INSERT permission_audit_events × 3",
          ],
          proposed_platform_roles: proposedPlatformRoles,
        },
      });
    }
  }
  return candidates;
}

function printLiveTargetReport(target, employmentTypeForPreview) {
  const expectedAfter =
    employmentTypeForPreview === "executive" && target.expected_after_preview
      ? target.expected_after_preview
      : buildExpectedAfterSnapshot(
          {
            user_id: target.auth_user_id,
            org_id: target.org_id,
            id: target.membership_id,
            department_id: target.department_id,
            clearance_override: target.clearance_override,
            departments: { key: target.current_department_key },
          },
          target.current_roles,
          target.current_ai_permission_keys,
          employmentTypeForPreview ?? "executive",
        );
  const comparison = comparePermissionSnapshots(target.before, expectedAfter);

  console.log("=== LIVE DRY RUN — Single AI User Target ===\n");
  console.log(`Target: ${target.current_display_name} (${target.email})`);
  console.log(`auth_user_id: ${target.auth_user_id}`);
  console.log(`category: ${target.user_category}`);
  console.log(`org: ${target.organization}\n`);

  console.log("--- BEFORE ---");
  console.log(`  AI access: ${target.before.aiAccess}`);
  console.log(`  AI permission keys (${target.before.aiPermissionKeys.length}):`);
  console.log(`    ${target.before.aiPermissionKeys.join(", ")}`);
  console.log(`  Knowledge clearance: ${target.before.clearance}`);
  console.log(`  Platform permissions (legacy bridge): ${target.before.platformPermissions.join(", ")}`);

  console.log("\n--- PROPOSED TRANSACTION ---");
  console.log(`  RPC: ${target.proposed_transaction.rpc}`);
  console.log(`  staff_no: ${target.proposed_staff_no} (DB sequence — preview only)`);
  console.log(`  employment_type: <REQUIRED — pass --employment-type on apply>`);
  console.log(`  platform roles (from permission set): ${target.proposed_transaction.proposed_platform_roles.join(", ")}`);
  for (const step of target.proposed_transaction.steps) {
    console.log(`    • ${step}`);
  }

  console.log("\n--- EXPECTED AFTER (with --employment-type on apply) ---");
  console.log(`  AI access: ${expectedAfter.aiAccess}`);
  console.log(`  AI permission keys: unchanged (${expectedAfter.aiPermissionKeys.length})`);
  console.log(`  Knowledge clearance: ${expectedAfter.clearance}`);
  console.log(`  Platform permissions: ${expectedAfter.platformPermissions.join(", ")}`);
  console.log(`  legacy bridge: inactive (staff linked)`);

  console.log("\n--- PERMISSION PRESERVATION CHECK ---");
  console.log(`  OK: ${comparison.ok}`);
  if (comparison.violations.length) {
    for (const v of comparison.violations) console.log(`  ⚠ ${v}`);
  } else {
    console.log("  No regressions expected if RPC migration is applied and atomic.");
  }

  const previewToken = buildApplyConfirmToken(
    target.auth_user_id,
    employmentTypeForPreview ?? "executive",
  );
  console.log("\n--- APPLY COMMAND (NOT EXECUTED) ---");
  console.log(
    `  npm run db:backfill-staff -- --apply --auth-user ${target.auth_user_id} --employment-type ${employmentTypeForPreview ?? "executive"} --confirm ${previewToken}`,
  );
  console.log("\n  Prerequisites:");
  console.log("    1. Apply migrations 20260831120000 + 20260831121000 to target DB");
  console.log("    2. Confirm employment_type with HR (not inferred)");
  console.log("    3. Re-run this dry-run after migration apply");
}

async function runApply(admin, authUserId, employmentType, confirmToken) {
  const expectedToken = buildApplyConfirmToken(authUserId, employmentType);
  if (confirmToken !== expectedToken) {
    fail(
      `Confirm token mismatch. Expected ${expectedToken} for auth-user + employment-type pair.`,
      2,
    );
  }

  const ready = await rpcReady(admin);
  if (!ready) {
    fail(
      "Backfill RPC not available. Apply migrations 20260831120000_staff_no_sequence.sql and 20260831121000_staff_backfill_rpc.sql first.",
      2,
    );
  }

  console.log("=== APPLY MODE — PRE-FLIGHT ===");
  console.log(`  auth_user_id: ${authUserId}`);
  console.log(`  employment_type: ${employmentType}`);
  console.log(`  confirm token: ${confirmToken}`);
  console.log("  RPC: regapro_backfill_staff_from_auth");
  console.log("\nExecuting atomic backfill transaction…\n");

  const { data, error } = await admin.rpc("regapro_backfill_staff_from_auth", {
    p_auth_user_id: authUserId,
    p_employment_type: employmentType,
    p_actor_auth_user_id: null,
  });

  if (error) {
    fail(`Backfill RPC failed (transaction rolled back): ${error.message}`);
  }

  console.log("RESULT:");
  console.log(JSON.stringify(data, null, 2));

  if (data?.status === "already_backfilled") {
    console.log("\nOK: already_backfilled — no duplicate created.");
    return;
  }

  if (data?.status === "created") {
    console.log("\nOK: atomic backfill committed.");
    console.log(`  staff_id: ${data.staff_id}`);
    console.log(`  staff_no: ${data.staff_no}`);
  }
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret =
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secret) fail("Missing Supabase URL or secret key in env.");

  const admin = createClient(url, secret, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  if (applyMode) {
    if (!authUserArg) fail("--apply requires --auth-user <UUID>");
    const emp = validateEmploymentType(employmentTypeArg);
    if (!emp.ok) fail(emp.reason);
    if (!confirmArg) fail("--apply requires --confirm <token> (see dry-run output)");
    await runApply(admin, authUserArg, emp.employmentType, confirmArg);
    return;
  }

  const [authUsers, membershipsRes, profilesRes, identitiesRes, staffCount, rpcAvailable] =
    await Promise.all([
      listAllAuthUsers(admin),
      admin
        .from("organization_memberships")
        .select(
          `id, org_id, user_id, department_id, clearance_override,
          organizations ( id, name, slug ),
          departments ( id, key, name ),
          membership_roles ( deleted_at, roles ( key, deleted_at ) )`,
        )
        .is("deleted_at", null),
      admin.from("profiles").select("user_id, display_name").is("deleted_at", null),
      admin.from("staff_identities").select("auth_user_id, staff_id, identity_type"),
      admin.from("staff").select("staff_id", { count: "exact", head: true }),
      rpcReady(admin),
    ]);

  if (membershipsRes.error) fail(membershipsRes.error.message);

  const candidates = await collectCandidates(
    admin,
    authUsers,
    membershipsRes.data,
    profilesRes.data,
    identitiesRes.data,
  );

  const aiTargets = candidates.filter((c) => c.backfill_target);
  const excluded = candidates.filter((c) => !c.backfill_target);

  const report = {
    mode: "dry-run",
    timestamp: new Date().toISOString(),
    rpc_migration_applied: rpcAvailable,
    counts: {
      auth_users: authUsers.length,
      membership_users: new Set((membershipsRes.data ?? []).map((m) => m.user_id)).size,
      existing_staff: staffCount.count ?? 0,
      backfill_targets: aiTargets.length,
      excluded_candidates: excluded.length,
      auth_without_membership: authUsers.filter(
        (u) => !(membershipsRes.data ?? []).some((m) => m.user_id === u.id),
      ).length,
    },
    backfill_targets: aiTargets,
    excluded,
  };

  if (jsonOut) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log("=== Staff Identity Backfill — DRY RUN ===\n");
  console.log(`Mode: dry-run (no writes)`);
  console.log(`RPC migration applied: ${rpcAvailable ? "yes" : "no — apply 20260831120000 + 20260831121000 before --apply"}`);
  console.log(`Timestamp: ${report.timestamp}\n`);

  console.log("--- Summary ---");
  for (const [k, v] of Object.entries(report.counts)) {
    console.log(`  ${k}: ${v}`);
  }

  console.log("\n--- Backfill Targets (ai_user only) ---");
  if (!aiTargets.length) {
    console.log("  (none)");
  }
  for (const t of aiTargets) {
    console.log(`  • ${t.current_display_name} (${t.email}) ${t.auth_user_id_short}`);
    console.log(`    roles: ${t.current_roles.join(", ")}`);
    console.log(`    proposed staff_no: ${t.proposed_staff_no}`);
    console.log(`    platform roles: ${t.proposed_transaction.proposed_platform_roles.join(", ")}`);
  }

  console.log("\n--- Excluded ---");
  for (const e of excluded) {
    console.log(`  • ${e.current_display_name ?? e.email} — ${e.user_category}`);
  }
  console.log(
    `  • ${report.counts.auth_without_membership} auth users without membership (E2E/RLS fixtures)`,
  );

  if (liveTargetOnly || aiTargets.length === 1) {
    const target = aiTargets[0];
    if (target) {
      console.log("");
      printLiveTargetReport(target, "executive");
    }
  } else if (aiTargets.length > 1) {
    console.log("\n  Run with --live-target to see BEFORE → PROPOSED → EXPECTED AFTER for each target.");
  }

  console.log("\n=== END DRY RUN — no writes performed ===");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
