/**
 * RLS cases for the integrated app foundation: staff identity, RBAC, and the
 * legacy migration scaffolding.
 *
 * These skip cleanly when the Phase 1 migrations have not been applied to the
 * target project, so the existing suite keeps running unchanged.
 *
 * Fixtures are created with service_role; every assertion runs under a user JWT.
 */
import { FIXTURE_TAG } from "./lib.mjs";

const PLATFORM_TABLES = [
  "staff",
  "staff_identities",
  "staff_departments",
  "staff_role_assignments",
  "staff_permission_overrides",
  "permission_audit_events",
  "migration_import_batches",
];

/** True once every Phase 1 table exists on the target project. */
export async function platformTablesReady(admin) {
  for (const table of PLATFORM_TABLES) {
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
  if (error || !data) throw new Error(`platform role ${key} missing: ${error?.message ?? "not found"}`);
  return data.id;
}

async function permissionIdByKey(admin, key) {
  const { data, error } = await admin
    .from("permissions")
    .select("id")
    .eq("key", key)
    .maybeSingle();
  if (error || !data) throw new Error(`permission ${key} missing`);
  return data.id;
}

async function createStaff(admin, { orgId, runId, seq, name, employmentType, status }) {
  const { data, error } = await admin
    .from("staff")
    .insert({
      org_id: orgId,
      staff_no: `${FIXTURE_TAG}-${runId}-${seq}`,
      name: `[${FIXTURE_TAG}:${runId}] ${name}`,
      employment_type: employmentType,
      status: status ?? "active",
    })
    .select("staff_id")
    .single();
  if (error) throw new Error(`seed staff: ${error.message}`);
  return data.staff_id;
}

async function linkIdentity(admin, { staffId, authUserId, runId, key }) {
  const { error } = await admin.from("staff_identities").insert({
    staff_id: staffId,
    identity_type: "app_auth",
    source_system: "regapro_app",
    external_user_id: `${FIXTURE_TAG}-${runId}-${key}`,
    auth_user_id: authUserId,
  });
  if (error) throw new Error(`seed identity: ${error.message}`);
}

async function assignRole(admin, { orgId, staffId, roleId, scopeType, scopeId }) {
  const { error } = await admin.from("staff_role_assignments").insert({
    org_id: orgId,
    staff_id: staffId,
    role_id: roleId,
    scope_type: scopeType ?? "organization",
    scope_id: scopeId ?? null,
  });
  if (error) throw new Error(`seed role assignment: ${error.message}`);
}

/**
 * Staff layout under test:
 *   sales_company  employee   platform_base + platform_ai_user
 *   hr_people      part_time  platform_weekly_pay_submitter only
 *   executive      executive  no platform roles at all
 *   admin_fixture  executive  platform_admin
 * plus one staff member in a second organization for isolation checks.
 */
export async function setupPlatformFixtures({ admin, ctx, users, runId }) {
  const orgId = ctx.org.id;
  const p = {};

  p.roles = {
    base: await roleIdByKey(admin, "platform_base"),
    ai: await roleIdByKey(admin, "platform_ai_user"),
    weeklySubmit: await roleIdByKey(admin, "platform_weekly_pay_submitter"),
    admin: await roleIdByKey(admin, "platform_admin"),
  };
  p.permissions = {
    expenseManage: await permissionIdByKey(admin, "expense.manage"),
    weeklySubmit: await permissionIdByKey(admin, "weekly_pay.submit"),
  };

  p.staffSales = await createStaff(admin, {
    orgId, runId, seq: "01", name: "sales employee", employmentType: "employee",
  });
  await linkIdentity(admin, {
    staffId: p.staffSales, authUserId: users.sales_company.userId, runId, key: "sales",
  });
  await assignRole(admin, { orgId, staffId: p.staffSales, roleId: p.roles.base });
  await assignRole(admin, { orgId, staffId: p.staffSales, roleId: p.roles.ai });

  p.staffPartTime = await createStaff(admin, {
    orgId, runId, seq: "02", name: "part time weekly pay", employmentType: "part_time",
  });
  await linkIdentity(admin, {
    staffId: p.staffPartTime, authUserId: users.hr_people.userId, runId, key: "parttime",
  });
  await assignRole(admin, {
    orgId, staffId: p.staffPartTime, roleId: p.roles.weeklySubmit, scopeType: "self",
  });

  // Executive employment type, zero platform roles: proves employment_type
  // alone grants nothing.
  p.staffExecNoRoles = await createStaff(admin, {
    orgId, runId, seq: "03", name: "executive no roles", employmentType: "executive",
  });
  await linkIdentity(admin, {
    staffId: p.staffExecNoRoles, authUserId: users.executive.userId, runId, key: "exec",
  });

  p.staffAdmin = await createStaff(admin, {
    orgId, runId, seq: "04", name: "platform admin", employmentType: "executive",
  });
  await linkIdentity(admin, {
    staffId: p.staffAdmin, authUserId: users.admin_fixture.userId, runId, key: "admin",
  });
  await assignRole(admin, { orgId, staffId: p.staffAdmin, roleId: p.roles.admin });

  // Second organization — no fixture user belongs to it.
  const { data: otherOrg, error: orgErr } = await admin
    .from("organizations")
    .insert({
      name: `[${FIXTURE_TAG}:${runId}] other org`,
      slug: `rlsfix-${runId}-other`,
    })
    .select("id")
    .single();
  if (orgErr) throw new Error(`seed other org: ${orgErr.message}`);
  p.otherOrgId = otherOrg.id;

  p.staffOtherOrg = await createStaff(admin, {
    orgId: p.otherOrgId, runId, seq: "05", name: "other org staff", employmentType: "employee",
  });

  const { data: batch, error: batchErr } = await admin
    .from("migration_import_batches")
    .insert({
      org_id: orgId,
      source_system: "legacy_weekly_pay",
      entity_kind: "staff",
      label: `[${FIXTURE_TAG}:${runId}] dry run`,
    })
    .select("id")
    .single();
  if (batchErr) throw new Error(`seed migration batch: ${batchErr.message}`);
  p.batchId = batch.id;

  return p;
}

const selectStaff = (client, staffId) =>
  client.from("staff").select("staff_id").eq("staff_id", staffId);

export async function runPlatformCases(reporter, fx, p) {
  const { users, ctx } = fx;
  const orgId = ctx.org.id;
  const sales = users.sales_company;
  const partTime = users.hr_people;
  const execNoRoles = users.executive;
  const adminUser = users.admin_fixture;
  const outsider = users.no_membership;

  // ---- Identity resolution -------------------------------------------------
  const myStaff = await sales.client.rpc("regapro_current_staff_id");
  if (!myStaff.error && myStaff.data === p.staffSales) {
    reporter.pass("staff: auth user resolves to own staff_id");
  } else {
    reporter.fail(
      "staff: auth user resolves to own staff_id",
      `got ${JSON.stringify(myStaff.data)} err=${myStaff.error?.message ?? "-"}`,
    );
  }

  reporter.expectRows(
    "staff: member reads own-org staff directory",
    await selectStaff(sales.client, p.staffSales),
  );

  // ---- Cross-organization isolation ---------------------------------------
  reporter.expectDenied(
    "staff: DENIED staff row from another organization",
    await selectStaff(sales.client, p.staffOtherOrg),
    p.staffOtherOrg,
  );
  reporter.expectDenied(
    "staff: DENIED directory to user without membership or staff",
    await selectStaff(outsider.client, p.staffSales),
    p.staffSales,
  );
  reporter.expectWriteDenied(
    "staff: DENIED insert into another organization",
    await adminUser.client
      .from("staff")
      .insert({
        org_id: p.otherOrgId,
        staff_no: `${FIXTURE_TAG}-cross-${fx.runId}`,
        name: "cross org attempt",
        employment_type: "employee",
      })
      .select("staff_id"),
  );

  // ---- Identity mapping is not a directory --------------------------------
  reporter.expectRows(
    "staff_identities: reads own identity mapping",
    await sales.client
      .from("staff_identities")
      .select("id, staff_id")
      .eq("staff_id", p.staffSales),
  );
  reporter.expectDenied(
    "staff_identities: DENIED another staff member's mapping",
    await partTime.client
      .from("staff_identities")
      .select("id, staff_id")
      .eq("staff_id", p.staffSales),
  );

  // ---- Permission evaluation in the database ------------------------------
  const rpc = async (client, permission) =>
    client.rpc("regapro_staff_has_permission", {
      p_org_id: orgId,
      p_permission: permission,
    });

  const partTimeWeekly = await rpc(partTime.client, "weekly_pay.submit");
  if (!partTimeWeekly.error && partTimeWeekly.data === true) {
    reporter.pass("rbac: part_time holds weekly_pay.submit");
  } else {
    reporter.fail(
      "rbac: part_time holds weekly_pay.submit",
      `got ${JSON.stringify(partTimeWeekly.data)} err=${partTimeWeekly.error?.message ?? "-"}`,
    );
  }

  for (const permission of ["expense.manage", "sales.manage", "admin.access"]) {
    const res = await rpc(partTime.client, permission);
    if (!res.error && res.data === false) {
      reporter.pass(`rbac: part_time DENIED ${permission}`);
    } else {
      reporter.fail(
        `rbac: part_time DENIED ${permission}`,
        `got ${JSON.stringify(res.data)} err=${res.error?.message ?? "-"}`,
      );
    }
  }

  for (const permission of ["admin.access", "expense.manage", "ai.use"]) {
    const res = await rpc(execNoRoles.client, permission);
    if (!res.error && res.data === false) {
      reporter.pass(`rbac: executive employment_type alone DENIED ${permission}`);
    } else {
      reporter.fail(
        `rbac: executive employment_type alone DENIED ${permission}`,
        `got ${JSON.stringify(res.data)} err=${res.error?.message ?? "-"}`,
      );
    }
  }

  const adminRoleManage = await rpc(adminUser.client, "admin.role_manage");
  if (!adminRoleManage.error && adminRoleManage.data === true) {
    reporter.pass("rbac: platform_admin holds admin.role_manage");
  } else {
    reporter.fail(
      "rbac: platform_admin holds admin.role_manage",
      `got ${JSON.stringify(adminRoleManage.data)}`,
    );
  }

  // ---- Suspended staff loses every platform permission --------------------
  await fx.admin
    .from("staff")
    .update({ status: "suspended" })
    .eq("staff_id", p.staffPartTime);
  const suspended = await rpc(partTime.client, "weekly_pay.submit");
  if (!suspended.error && suspended.data === false) {
    reporter.pass("rbac: suspended staff DENIED previously held permission");
  } else {
    reporter.fail(
      "rbac: suspended staff DENIED previously held permission",
      `got ${JSON.stringify(suspended.data)}`,
    );
  }
  await fx.admin
    .from("staff")
    .update({ status: "active" })
    .eq("staff_id", p.staffPartTime);

  // ---- Role and permission management is privileged -----------------------
  reporter.expectRows(
    "staff_role_assignments: reads own assignments",
    await sales.client
      .from("staff_role_assignments")
      .select("id, staff_id")
      .eq("staff_id", p.staffSales),
  );
  reporter.expectDenied(
    "staff_role_assignments: DENIED another staff member's assignments",
    await sales.client
      .from("staff_role_assignments")
      .select("id, staff_id")
      .eq("staff_id", p.staffAdmin),
  );
  reporter.expectWriteDenied(
    "staff_role_assignments: DENIED self-elevation insert",
    await sales.client
      .from("staff_role_assignments")
      .insert({
        org_id: orgId,
        staff_id: p.staffSales,
        role_id: p.roles.admin,
        scope_type: "organization",
      })
      .select("id"),
  );
  reporter.expectWriteDenied(
    "staff_role_assignments: DENIED revoking someone else's role",
    await sales.client
      .from("staff_role_assignments")
      .update({ deleted_at: new Date().toISOString() })
      .eq("staff_id", p.staffAdmin)
      .select("id"),
  );
  reporter.expectWriteDenied(
    "staff_role_assignments: DENIED delete without role management",
    await sales.client
      .from("staff_role_assignments")
      .delete()
      .eq("staff_id", p.staffSales)
      .select("id"),
  );
  reporter.expectWriteDenied(
    "staff_permission_overrides: DENIED granting self an override",
    await sales.client
      .from("staff_permission_overrides")
      .insert({
        org_id: orgId,
        staff_id: p.staffSales,
        permission_id: p.permissions.expenseManage,
        effect: "allow",
        scope_type: "organization",
      })
      .select("id"),
  );
  reporter.expectWriteDenied(
    "staff: DENIED editing own employment_type",
    await sales.client
      .from("staff")
      .update({ employment_type: "executive" })
      .eq("staff_id", p.staffSales)
      .select("staff_id"),
  );

  const adminGrant = await adminUser.client
    .from("staff_role_assignments")
    .insert({
      org_id: orgId,
      staff_id: p.staffSales,
      role_id: p.roles.weeklySubmit,
      scope_type: "self",
    })
    .select("id");
  reporter.expectWriteOk(
    "staff_role_assignments: role manager may grant a role",
    adminGrant,
  );

  // ---- Audit and legacy migration scaffolding -----------------------------
  reporter.expectDenied(
    "permission_audit_events: DENIED to a member without management",
    await sales.client.from("permission_audit_events").select("id").eq("org_id", orgId),
  );
  reporter.expectDenied(
    "migration_import_batches: DENIED to a member without management",
    await sales.client.from("migration_import_batches").select("id").eq("org_id", orgId),
    p.batchId,
  );
  reporter.expectWriteDenied(
    "migration_source_records: DENIED insert without management",
    await sales.client
      .from("migration_source_records")
      .insert({
        batch_id: p.batchId,
        external_record_id: `deny-${fx.runId}`,
        payload: {},
        content_hash: "deny",
      })
      .select("id"),
  );
  reporter.expectRows(
    "migration_import_batches: visible to staff manager",
    await adminUser.client
      .from("migration_import_batches")
      .select("id")
      .eq("id", p.batchId),
  );
}

export async function cleanupPlatformFixtures({ admin }, p) {
  if (!p) return;
  const staffIds = [
    p.staffSales,
    p.staffPartTime,
    p.staffExecNoRoles,
    p.staffAdmin,
    p.staffOtherOrg,
  ].filter(Boolean);

  if (p.batchId) {
    await admin.from("migration_errors").delete().eq("batch_id", p.batchId);
    await admin.from("migration_identity_matches").delete().eq("batch_id", p.batchId);
    await admin.from("migration_source_records").delete().eq("batch_id", p.batchId);
    await admin.from("migration_import_batches").delete().eq("id", p.batchId);
  }

  if (staffIds.length) {
    await admin.from("permission_audit_events").delete().in("subject_staff_id", staffIds);
    await admin.from("staff_permission_overrides").delete().in("staff_id", staffIds);
    await admin.from("staff_role_assignments").delete().in("staff_id", staffIds);
    await admin.from("staff_departments").delete().in("staff_id", staffIds);
    await admin.from("staff_identities").delete().in("staff_id", staffIds);
    await admin.from("staff").delete().in("staff_id", staffIds);
  }

  if (p.otherOrgId) {
    await admin.from("organizations").delete().eq("id", p.otherOrgId);
  }
}
