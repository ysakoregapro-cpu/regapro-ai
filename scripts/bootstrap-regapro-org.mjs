/**
 * Idempotent bootstrap for 株式会社レガプロ + departments.
 *
 * Usage:
 *   npm run db:bootstrap-org
 *   npm run db:bootstrap-org -- --admin-email=you@example.com
 *   npm run db:bootstrap-org -- --admin-user-id=<uuid> --admin-display-name="氏名"
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY
 * (or SUPABASE_SERVICE_ROLE_KEY) in apps/web/.env.local or the environment.
 * Does not create Auth users — create the admin in Supabase Auth first.
 */
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  const text = readFileSync(filePath, "utf8");
  for (const line of text.split(/\r?\n/)) {
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
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadEnvFile(resolve(root, "apps/web/.env.local"));
loadEnvFile(resolve(root, ".env.local"));

function argValue(flag) {
  const idx = process.argv.indexOf(flag);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  const prefix = `${flag}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

const ORG_SLUG = "regapro";
const ORG_NAME = "株式会社レガプロ";
const DEPARTMENTS = [
  { key: "sales", name: "営業部", defaultClearanceLevel: 1 },
  { key: "people", name: "人事部", defaultClearanceLevel: 2 },
  { key: "executive_strategy", name: "経営戦略部", defaultClearanceLevel: 3 },
];

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret =
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secret) {
    console.error(
      "Missing NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY).",
    );
    process.exit(1);
  }

  const adminEmail = argValue("--admin-email");
  const adminUserId = argValue("--admin-user-id");
  const adminDisplayName = argValue("--admin-display-name");
  const adminDepartment = argValue("--admin-department") || "executive_strategy";

  const admin = createClient(url, secret, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: existingOrg } = await admin
    .from("organizations")
    .select("id")
    .eq("slug", ORG_SLUG)
    .is("deleted_at", null)
    .maybeSingle();

  let organizationId;
  if (existingOrg?.id) {
    organizationId = existingOrg.id;
    await admin
      .from("organizations")
      .update({ name: ORG_NAME, updated_at: new Date().toISOString() })
      .eq("id", organizationId);
    console.log(`Organization exists: ${ORG_NAME} (${organizationId})`);
  } else {
    const { data, error } = await admin
      .from("organizations")
      .insert({ name: ORG_NAME, slug: ORG_SLUG })
      .select("id")
      .single();
    if (error) throw error;
    organizationId = data.id;
    console.log(`Organization created: ${ORG_NAME} (${organizationId})`);
  }

  const deptIds = {};
  for (const dept of DEPARTMENTS) {
    const { data: existing } = await admin
      .from("departments")
      .select("id")
      .eq("org_id", organizationId)
      .eq("key", dept.key)
      .is("deleted_at", null)
      .maybeSingle();

    if (existing?.id) {
      await admin
        .from("departments")
        .update({
          name: dept.name,
          default_clearance_level: dept.defaultClearanceLevel,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id);
      deptIds[dept.key] = existing.id;
      console.log(`Department exists: ${dept.name} (${existing.id})`);
    } else {
      const { data, error } = await admin
        .from("departments")
        .insert({
          org_id: organizationId,
          key: dept.key,
          name: dept.name,
          default_clearance_level: dept.defaultClearanceLevel,
        })
        .select("id")
        .single();
      if (error) throw error;
      deptIds[dept.key] = data.id;
      console.log(`Department created: ${dept.name} (${data.id})`);
    }
  }

  if (!adminEmail && !adminUserId) {
    console.log("");
    console.log("Org + departments are ready (idempotent).");
    console.log(
      "Admin membership was NOT attached. Create a Supabase Auth user, then re-run:",
    );
    console.log(
      '  npm run db:bootstrap-org -- --admin-email=you@example.com --admin-display-name="氏名"',
    );
    console.log("  or");
    console.log(
      '  npm run db:bootstrap-org -- --admin-user-id=<uuid> --admin-display-name="氏名"',
    );
    return;
  }

  let userId = adminUserId || null;
  let email = adminEmail || null;

  if (!userId && email) {
    const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (listed.error) throw listed.error;
    const found = listed.data.users.find(
      (u) => u.email?.toLowerCase() === email.toLowerCase(),
    );
    if (!found) {
      console.error(
        `No Auth user for email "${email}". Create the user in Supabase Dashboard → Authentication first.`,
      );
      process.exit(2);
    }
    userId = found.id;
    email = found.email || email;
  }

  if (userId && !email) {
    const { data, error } = await admin.auth.admin.getUserById(userId);
    if (error || !data.user) {
      console.error(`No Auth user for id "${userId}".`);
      process.exit(2);
    }
    email = data.user.email || null;
  }

  const displayName = adminDisplayName || (email ? email.split("@")[0] : "管理者");
  const departmentId = deptIds[adminDepartment];
  if (!departmentId) {
    console.error(`Unknown department key: ${adminDepartment}`);
    process.exit(1);
  }

  const { data: existingProfile } = await admin
    .from("profiles")
    .select("id")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();

  if (existingProfile?.id) {
    await admin
      .from("profiles")
      .update({ display_name: displayName, updated_at: new Date().toISOString() })
      .eq("id", existingProfile.id);
    console.log(`Profile updated for ${userId}`);
  } else {
    const { error } = await admin.from("profiles").insert({
      user_id: userId,
      display_name: displayName,
    });
    if (error) throw error;
    console.log(`Profile created for ${userId}`);
  }

  const { data: role, error: roleError } = await admin
    .from("roles")
    .select("id")
    .eq("key", "admin")
    .is("org_id", null)
    .is("deleted_at", null)
    .maybeSingle();
  if (roleError || !role) throw roleError || new Error("admin role template missing");

  const { data: existingMem } = await admin
    .from("organization_memberships")
    .select("id")
    .eq("org_id", organizationId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();

  let membershipId;
  if (existingMem?.id) {
    membershipId = existingMem.id;
    await admin
      .from("organization_memberships")
      .update({
        department_id: departmentId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", membershipId);
    console.log(`Membership exists: ${membershipId}`);
  } else {
    const { data, error } = await admin
      .from("organization_memberships")
      .insert({
        org_id: organizationId,
        user_id: userId,
        department_id: departmentId,
      })
      .select("id")
      .single();
    if (error) throw error;
    membershipId = data.id;
    console.log(`Membership created: ${membershipId}`);
  }

  const { data: existingMr } = await admin
    .from("membership_roles")
    .select("id")
    .eq("membership_id", membershipId)
    .eq("role_id", role.id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!existingMr) {
    const { error } = await admin.from("membership_roles").insert({
      membership_id: membershipId,
      role_id: role.id,
    });
    if (error) throw error;
    console.log("Admin role assigned.");
  } else {
    console.log("Admin role already assigned.");
  }

  console.log("");
  console.log("Bootstrap complete.");
  console.log(`  org: ${organizationId}`);
  console.log(`  admin user: ${userId}`);
  console.log(`  membership: ${membershipId}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
