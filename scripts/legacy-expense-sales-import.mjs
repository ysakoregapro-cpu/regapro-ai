/**
 * Phase 8.1 legacy expense / sales import.
 * Never writes to legacy projects. No display-name matching.
 * Email matches are candidates only (never auto-publish personal history).
 *
 * Usage:
 *   node scripts/legacy-expense-sales-import.mjs --entity expense --org-id <uuid> --dry-run
 *   node scripts/legacy-expense-sales-import.mjs --entity sales --org-id <uuid> --dry-run --source-dir tmp/legacy-import/sales
 *   node scripts/legacy-expense-sales-import.mjs --entity expense --org-id <uuid> --apply --source-dir tmp/legacy-import/expense
 *
 * Legacy RO env (optional if --source-dir provided):
 *   LEGACY_EXPENSE_URL / LEGACY_EXPENSE_SERVICE_ROLE_KEY
 *   LEGACY_SALES_URL / LEGACY_SALES_SERVICE_ROLE_KEY
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { loadEnvFiles, requireEnv } from "./rls-integration/lib.mjs";

loadEnvFiles();

const args = process.argv.slice(2);
const argVal = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
};
const entity = argVal("--entity");
const orgId = argVal("--org-id");
const dryRun = !args.includes("--apply");
const sourceDir = argVal("--source-dir");
const confirmEmailMatches = args.includes("--confirm-email-matches");
const failAfterRaw = argVal("--fail-after");
const failAfter =
  failAfterRaw == null || failAfterRaw === ""
    ? null
    : Number.parseInt(failAfterRaw, 10);
if (failAfterRaw != null && (!Number.isFinite(failAfter) || failAfter < 0)) {
  console.error("--fail-after must be a non-negative integer");
  process.exit(2);
}

function fail(code, report) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(code);
}

function client(url, key) {
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function hashPayload(obj) {
  return createHash("sha256").update(JSON.stringify(obj)).digest("hex");
}

function prefix(id) {
  return typeof id === "string" ? id.slice(0, 8) : "????";
}

function normalizeCode(v) {
  if (typeof v !== "string") return "";
  return v.trim().toLowerCase();
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function parseYen(label, v) {
  if (v == null || v === "") {
    return { ok: false, reason: `${label}_null` };
  }
  const n = Number(v);
  if (!Number.isFinite(n)) return { ok: false, reason: `${label}_nan` };
  if (!Number.isInteger(n) && Math.abs(n - Math.trunc(n)) > 1e-9) {
    return { ok: false, reason: `${label}_fractional` };
  }
  const yen = Math.trunc(n);
  if (yen <= 0) return { ok: false, reason: `${label}_non_positive` };
  if (yen > 2147483647) return { ok: false, reason: `${label}_overflow` };
  return { ok: true, value: yen };
}

function parseYenNonNeg(label, v) {
  if (v == null || v === "") {
    return { ok: false, reason: `${label}_null` };
  }
  const n = Number(v);
  if (!Number.isFinite(n)) return { ok: false, reason: `${label}_nan` };
  if (!Number.isInteger(n) && Math.abs(n - Math.trunc(n)) > 1e-9) {
    return { ok: false, reason: `${label}_fractional` };
  }
  const yen = Math.trunc(n);
  if (yen < 0) return { ok: false, reason: `${label}_negative` };
  if (yen > 2147483647) return { ok: false, reason: `${label}_overflow` };
  return { ok: true, value: yen };
}

function parseRateBps(label, v) {
  if (v == null || v === "") return { ok: false, reason: `${label}_null` };
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return { ok: false, reason: `${label}_invalid` };
  let bps;
  if (n <= 1) bps = Math.round(n * 10000);
  else if (n <= 100) bps = Math.round(n * 100);
  else return { ok: false, reason: `${label}_out_of_range` };
  if (bps < 0 || bps > 10000) return { ok: false, reason: `${label}_bps_range` };
  return { ok: true, value: bps };
}

const report = {
  status: "OK",
  entity,
  dryRun,
  orgIdPrefix: orgId ? prefix(orgId) : null,
  legacyCounts: {},
  enrichment: { loaded: false, blockedReasons: [] },
  identity: {
    confirmed: 0,
    candidate: 0,
    candidateNeedsOrgPersonConfirm: 0,
    collision: 0,
    unmatched: 0,
    leftOrSuspended: 0,
  },
  import: {
    sourceN: 0,
    /** dry-run / pre-write: would import with confirmed identity + valid amounts */
    plannedImport: 0,
    /** apply: successfully written (or updated) via atomic RPC */
    imported: 0,
    skippedUnchanged: 0,
    quarantined: 0,
    failed: 0,
    excludedSoftDeleted: 0,
    excludedInactive: 0,
    excludedWithReason: 0,
  },
  amounts: {
    sourceYenTotal: 0,
    plannedYenTotal: 0,
    quarantinedYenTotal: 0,
    importedYenTotal: 0,
  },
  reconciliation: {
    sourceN: 0,
    accountedN: 0,
    balanced: false,
    formula: "sourceN = imported+skippedUnchanged + quarantined + excludedWithReason (+ failed on hard stop)",
  },
  receipt: { withPath: 0, copyAttempted: 0, copyOk: 0, deferred: 0 },
  writes: { attempted: 0, note: dryRun ? "dry-run guarantees zero writes" : "apply mode" },
  samples: {
    confirmed: [],
    candidate: [],
    collision: [],
    unmatched: [],
    planned: [],
    quarantined: [],
  },
};
const identityReview = [];
const CROSS_PROJECT_EMAIL_MD5 = new Set(); // filled from DUMP_MANIFEST — never logged as values in samples

if (entity !== "expense" && entity !== "sales") {
  report.status = "BLOCKED";
  report.reason = "--entity expense|sales is required";
  fail(2, report);
}
if (!orgId) {
  report.status = "BLOCKED";
  report.reason = "--org-id is required (no active-staff org fallback)";
  fail(2, report);
}

const { url, secret } = requireEnv();
const newDb = client(url, secret);

const { data: orgRow, error: orgErr } = await newDb
  .from("organizations")
  .select("id, slug")
  .eq("id", orgId)
  .maybeSingle();
if (orgErr || !orgRow) {
  report.status = "BLOCKED";
  report.reason = `org-id not found: ${orgErr?.message ?? "missing"}`;
  fail(2, report);
}

const sourceSystem = entity === "expense" ? "legacy_expense" : "legacy_sales";

const { data: staffRows, error: staffErr } = await newDb
  .from("staff")
  .select("staff_id, staff_no, status, org_id")
  .eq("org_id", orgId);
if (staffErr) throw staffErr;

const { data: identityRows, error: idErr } = await newDb
  .from("staff_identities")
  .select("staff_id, identity_type, source_system, external_user_id, auth_user_id, metadata");
if (idErr) throw idErr;

const staffById = new Map((staffRows ?? []).map((s) => [s.staff_id, s]));
const byStaffNo = new Map();
const byAuth = new Map();
const byLegacyExternal = new Map();
const byEmailMd5 = new Map(); // email_md5 -> staff_id[] in org

for (const s of staffRows ?? []) {
  byStaffNo.set(normalizeCode(s.staff_no), s.staff_id);
}
for (const i of identityRows ?? []) {
  const staff = staffById.get(i.staff_id);
  if (!staff) continue;
  if (i.auth_user_id) {
    const list = byAuth.get(i.auth_user_id) ?? [];
    list.push(i.staff_id);
    byAuth.set(i.auth_user_id, list);
  }
  if (i.source_system === sourceSystem && i.external_user_id) {
    byLegacyExternal.set(String(i.external_user_id), i.staff_id);
  }
}

// New-app verified auth emails for org staff (md5 only).
const { data: newEmailRows, error: newEmailErr } = await newDb.rpc("regapro_current_staff_id").then(
  () => ({ data: null, error: null }),
  () => ({ data: null, error: null }),
);
void newEmailRows;
void newEmailErr;

// Load auth email md5 for new staff via service SQL is not available through Data API;
// expect auth_emails_new.json in source-dir OR compute from dump of new app identities joined externally.
let newAuthEmails = [];
const newEmailPath = sourceDir
  ? join(sourceDir, "auth_emails_new.json")
  : join("tmp/legacy-import", "auth_emails_new.json");
if (existsSync(newEmailPath)) {
  newAuthEmails = readJson(newEmailPath);
  for (const row of newAuthEmails) {
    if (!row.confirmed || !row.email_md5 || !row.staff_id) continue;
    if (!staffById.has(row.staff_id)) continue;
    const list = byEmailMd5.get(row.email_md5) ?? [];
    list.push(row.staff_id);
    byEmailMd5.set(row.email_md5, [...new Set(list)]);
  }
}

report.staffCatalog = {
  orgStaffN: (staffRows ?? []).length,
  identitiesInOrg: (identityRows ?? []).filter((i) => staffById.has(i.staff_id)).length,
  appAuthInOrg: (identityRows ?? []).filter(
    (i) => staffById.has(i.staff_id) && i.identity_type === "app_auth" && i.auth_user_id,
  ).length,
};

const { data: confirmedMatches } = await newDb
  .from("migration_identity_matches")
  .select("external_user_id, staff_id, status, match_method, source_system")
  .eq("source_system", sourceSystem)
  .eq("status", "confirmed");
const confirmedByExternal = new Map();
for (const m of confirmedMatches ?? []) {
  if (m.staff_id && staffById.has(m.staff_id)) {
    confirmedByExternal.set(String(m.external_user_id), m.staff_id);
  }
}

/**
 * Resolve person.
 * confirmed: auth_user_id unique in-org OR staff_no OR existing_identity(source) OR confirmed match row
 * candidate: verified email md5 unique in-org (not enough alone to import)
 */
function resolvePerson(row, legacyEmailByUserId) {
  const candidates = new Map(); // staffId -> methods[]
  const add = (staffId, method) => {
    if (!staffId || !staffById.has(staffId)) return;
    const methods = candidates.get(staffId) ?? [];
    methods.push(method);
    candidates.set(staffId, methods);
  };

  const externalId = String(row.id ?? row.profile_id ?? row.member_id ?? "");
  if (confirmedByExternal.has(externalId)) {
    add(confirmedByExternal.get(externalId), "manual_confirmed");
  }

  const authUserId = row.auth_user_id ?? row.authUserId ?? null;
  if (authUserId && byAuth.has(authUserId)) {
    for (const sid of byAuth.get(authUserId)) add(sid, "auth_user_id");
  }

  const loginId = row.login_id ?? null;
  if (loginId && byStaffNo.has(normalizeCode(loginId))) {
    add(byStaffNo.get(normalizeCode(loginId)), "staff_no");
  }

  if (externalId && byLegacyExternal.has(externalId)) {
    add(byLegacyExternal.get(externalId), "existing_identity");
  }

  // Email candidate (never alone for confirmed). 3-PJ common hash needs org/person proof.
  const emailKey = authUserId ?? externalId;
  const emailRow = legacyEmailByUserId.get(String(emailKey));
  let emailCandidateStaff = null;
  let emailCrossProject = false;
  if (emailRow?.confirmed && emailRow.email_md5 && byEmailMd5.has(emailRow.email_md5)) {
    emailCrossProject = CROSS_PROJECT_EMAIL_MD5.has(emailRow.email_md5);
    const hits = byEmailMd5.get(emailRow.email_md5);
    if (hits.length === 1) {
      emailCandidateStaff = hits[0];
      // Never auto-confirm from email alone — not even with --confirm-email-matches for 3-PJ common.
      if (confirmEmailMatches && !emailCrossProject) {
        add(hits[0], "email_verified_candidate");
      }
    } else if (hits.length > 1) {
      return {
        kind: "collision",
        staffId: null,
        methods: ["email_verified_candidate"],
        staffIds: hits,
      };
    }
  }

  const strong = [...candidates.entries()].filter(([, methods]) =>
    methods.some((m) => m !== "email_verified_candidate"),
  );

  if (strong.length === 1) {
    const [staffId, methods] = strong[0];
    const staff = staffById.get(staffId);
    return {
      kind: staff?.status === "active" ? "confirmed" : "left",
      staffId,
      methods: [...new Set(methods)],
    };
  }
  if (strong.length > 1) {
    return {
      kind: "collision",
      staffId: null,
      methods: [...new Set(strong.flatMap(([, m]) => m))],
      staffIds: strong.map(([id]) => id),
    };
  }

  // Only email candidate remains
  if (emailCandidateStaff) {
    return {
      kind: emailCrossProject ? "candidate_needs_org_person_confirm" : "candidate",
      staffId: emailCandidateStaff,
      methods: emailCrossProject
        ? ["email_verified_candidate", "cross_project_email_unconfirmed"]
        : ["email_verified_candidate"],
    };
  }

  return { kind: "unmatched", staffId: null, methods: [] };
}

function countIdentity(person, externalPrefix) {
  identityReview.push({
    externalPrefix,
    staffPrefix: person.staffId ? prefix(person.staffId) : null,
    staffPrefixes: (person.staffIds ?? []).map(prefix),
    methods: person.methods ?? [],
    status: person.kind,
  });
  if (person.kind === "confirmed") {
    report.identity.confirmed += 1;
    if (report.samples.confirmed.length < 5) {
      report.samples.confirmed.push({
        externalPrefix,
        staffPrefix: prefix(person.staffId),
        methods: person.methods,
      });
    }
  } else if (person.kind === "candidate" || person.kind === "candidate_needs_org_person_confirm") {
    report.identity.candidate += 1;
    if (person.kind === "candidate_needs_org_person_confirm") {
      report.identity.candidateNeedsOrgPersonConfirm += 1;
    }
    if (report.samples.candidate.length < 5) {
      report.samples.candidate.push({
        externalPrefix,
        staffPrefix: prefix(person.staffId),
        methods: person.methods,
        note:
          person.kind === "candidate_needs_org_person_confirm"
            ? "cross-project email — need separate person+org proof; not imported"
            : "email match only — not imported to personal views",
      });
    }
  } else if (person.kind === "collision") {
    report.identity.collision += 1;
    if (report.samples.collision.length < 5) {
      report.samples.collision.push({
        externalPrefix,
        staffPrefixes: (person.staffIds ?? []).map(prefix),
        methods: person.methods,
      });
    }
  } else if (person.kind === "left") {
    report.identity.leftOrSuspended += 1;
    report.identity.unmatched += 1;
  } else {
    report.identity.unmatched += 1;
    if (report.samples.unmatched.length < 5) {
      report.samples.unmatched.push({ externalPrefix });
    }
  }
}

async function loadLegacy() {
  if (sourceDir) {
    const dir = resolve(sourceDir);
    if (entity === "expense") {
      return {
        profiles: readJson(join(dir, "profiles.json")),
        categories: readJson(join(dir, "expense_categories.json")),
        applications: readJson(join(dir, "expense_applications.json")),
        versions: readJson(join(dir, "expense_application_versions.json")),
        events: readJson(join(dir, "expense_events.json")),
        authEmails: readJson(join(dir, "auth_emails.json")),
      };
    }
    return {
      members: readJson(join(dir, "members.json")),
      salesRecords: readJson(join(dir, "sales_records.json")),
      allocations: readJson(join(dir, "sales_allocations.json")),
      axisRecords: readJson(join(dir, "axis_records.json")),
      authEmails: readJson(join(dir, "auth_emails.json")),
    };
  }

  const legacyUrl =
    entity === "expense" ? process.env.LEGACY_EXPENSE_URL : process.env.LEGACY_SALES_URL;
  const legacyKey =
    entity === "expense"
      ? process.env.LEGACY_EXPENSE_SERVICE_ROLE_KEY
      : process.env.LEGACY_SALES_SERVICE_ROLE_KEY;
  if (!legacyUrl || !legacyKey) {
    report.status = "BLOCKED";
    report.reason =
      `LEGACY_${entity.toUpperCase()}_* env not set and --source-dir not provided`;
    fail(2, report);
  }
  const legacy = client(legacyUrl, legacyKey);

  if (entity === "expense") {
    const profiles = await legacy.from("profiles").select("id, login_id, is_active, role");
    if (profiles.error) throw profiles.error;
    const categories = await legacy.from("expense_categories").select("*");
    if (categories.error) throw categories.error;
    const applications = await legacy.from("expense_applications").select("*");
    if (applications.error) throw applications.error;
    const versions = await legacy.from("expense_application_versions").select("*");
    if (versions.error) throw versions.error;
    const events = await legacy.from("expense_events").select("*");
    if (events.error) throw events.error;
    // auth emails require SQL; if unavailable, empty map (email candidates disabled)
    return {
      profiles: profiles.data ?? [],
      categories: categories.data ?? [],
      applications: applications.data ?? [],
      versions: versions.data ?? [],
      events: events.data ?? [],
      authEmails: [],
    };
  }

  const members = await legacy.from("members").select("id, auth_user_id, is_active, role");
  if (members.error) throw members.error;
  const salesRecords = await legacy.from("sales_records").select("*");
  if (salesRecords.error) throw salesRecords.error;
  const allocations = await legacy.from("sales_allocations").select("*");
  if (allocations.error) throw allocations.error;
  const axisRecords = await legacy
    .from("axis_records")
    .select("source_sync_id, is_active");
  if (axisRecords.error) throw axisRecords.error;
  return {
    members: members.data ?? [],
    salesRecords: salesRecords.data ?? [],
    allocations: allocations.data ?? [],
    axisRecords: axisRecords.data ?? [],
    authEmails: [],
  };
}

const legacyData = await loadLegacy();

function loadRestrictedJson(name) {
  const p = join("tmp/legacy-import/_restricted", name);
  if (!existsSync(p)) return null;
  return readJson(p);
}

function mergeById(rows, overlay, idKey, fields) {
  if (!overlay) return { merged: 0, missing: rows.length };
  const byId = new Map(overlay.map((r) => [String(r[idKey]), r]));
  let merged = 0;
  let missing = 0;
  for (const row of rows) {
    const e = byId.get(String(row[idKey]));
    if (!e) {
      missing += 1;
      continue;
    }
    for (const f of fields) {
      if (Object.prototype.hasOwnProperty.call(e, f)) row[f] = e[f];
    }
    merged += 1;
  }
  return { merged, missing };
}

const manifestPath = join("tmp/legacy-import", "DUMP_MANIFEST.json");
if (existsSync(manifestPath)) {
  const man = readJson(manifestPath);
  for (const h of man?.email_md5_cross_match?.all_three_projects ?? []) {
    CROSS_PROJECT_EMAIL_MD5.add(h);
  }
}

if (entity === "expense") {
  const appsText = loadRestrictedJson("expense_apps_text.json");
  const versText = loadRestrictedJson("expense_versions_text.json");
  const evText = loadRestrictedJson("expense_events_text.json");
  if (!appsText || !versText || !evText) {
    report.enrichment.blockedReasons.push("restricted_expense_text_missing");
  } else {
    const a = mergeById(legacyData.applications, appsText, "id", [
      "description",
      "after_reason",
      "admin_note",
      "applicant_name_snapshot",
    ]);
    const v = mergeById(legacyData.versions, versText, "id", [
      "description",
      "after_reason",
    ]);
    const e = mergeById(legacyData.events, evText, "id", ["note"]);
    report.enrichment = {
      loaded: true,
      applicationsMerged: a.merged,
      versionsMerged: v.merged,
      eventsMerged: e.merged,
      applicationsMissing: a.missing,
      versionsMissing: v.missing,
      eventsMissing: e.missing,
      blockedReasons: [],
    };
    if (a.missing || v.missing || e.missing) {
      report.enrichment.blockedReasons.push("restricted_expense_row_gap");
    }
  }
} else {
  const names = loadRestrictedJson("sales_names.json");
  if (!names) {
    report.enrichment.blockedReasons.push("restricted_sales_names_missing");
  } else {
    const m = mergeById(legacyData.salesRecords, names, "id", [
      "staff_name",
      "case_owner_name",
      "assign_owner_name",
    ]);
    report.enrichment = {
      loaded: true,
      salesNamesMerged: m.merged,
      salesNamesMissing: m.missing,
      blockedReasons: [],
    };
    if (m.missing) report.enrichment.blockedReasons.push("restricted_sales_names_row_gap");
  }
}

if (report.enrichment.blockedReasons.length) {
  report.status = "BLOCKED";
  report.reason = `enrichment incomplete: ${report.enrichment.blockedReasons.join(",")}`;
  fail(2, report);
}

// Validate sales auth_emails are member-scoped (not full auth.users dump).
if (entity === "sales") {
  const members = legacyData.members ?? [];
  const authEmails = legacyData.authEmails ?? [];
  const authIds = new Set(members.map((m) => String(m.auth_user_id)).filter((x) => x && x !== "null"));
  const orphanAuth = authEmails.filter((e) => !authIds.has(String(e.id)));
  const missingAuth = [...authIds].filter((id) => !authEmails.some((e) => String(e.id) === id));
  report.authEmailScope = {
    members: members.length,
    authEmailRows: authEmails.length,
    memberAuthIds: authIds.size,
    orphanAuthRows: orphanAuth.length,
    membersMissingAuthEmail: missingAuth.length,
    allConfirmed: authEmails.every((e) => e.confirmed === true),
  };
  if (orphanAuth.length > 0 || authEmails.length !== authIds.size) {
    report.status = "BLOCKED";
    report.reason =
      "sales auth_emails must be limited to member-linked auth users (no extra auth.users rows)";
    fail(2, report);
  }
}

const legacyEmailByUserId = new Map(
  (legacyData.authEmails ?? []).map((e) => [String(e.id), e]),
);

let batchId = null;
let hardFailed = false;

async function ensureBatch() {
  if (dryRun) return null;
  const { data, error } = await newDb
    .from("migration_import_batches")
    .insert({
      org_id: orgId,
      source_system: sourceSystem,
      entity_kind: entity,
      label: `phase81 ${entity} ${new Date().toISOString()}`,
      dry_run: false,
      status: "ready",
      created_by_staff_id: null,
      notes: "system migration batch; created_by intentionally null",
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

async function quarantineApply(externalId, externalUserId, payload, hash, code, message) {
  const { error } = await newDb.rpc("regapro_service_migration_quarantine", {
    p_batch_id: batchId,
    p_external_record_id: externalId,
    p_external_user_id: externalUserId,
    p_payload: payload,
    p_content_hash: hash,
    p_error_code: code,
    p_message: message,
  });
  if (error) throw error;
}

async function finishBatch(status) {
  if (dryRun || !batchId) return;
  report.writes.attempted += 1;
  const { error } = await newDb.rpc("regapro_service_migration_batch_finish", {
    p_batch_id: batchId,
    p_status: status,
    p_totals: {
      total: report.import.sourceN,
      matched: report.import.imported + report.import.skippedUnchanged,
      failed: report.import.failed,
      quarantined: report.import.quarantined,
      plannedImport: report.import.plannedImport,
      amounts: report.amounts,
      identity: report.identity,
    },
  });
  if (error) throw error;
}

async function recordIdentityProposal(externalUserId, person) {
  if (dryRun || !batchId) return;
  if (
    !["candidate", "candidate_needs_org_person_confirm", "confirmed", "collision", "unmatched", "left"].includes(
      person.kind,
    )
  ) {
    return;
  }
  const method =
    person.methods?.[0] === "email_verified_candidate"
      ? "email_verified_candidate"
      : person.methods?.[0] === "auth_user_id"
        ? "auth_user_id"
        : person.methods?.[0] === "staff_no"
          ? "staff_no"
          : person.methods?.[0] === "existing_identity"
            ? "existing_identity"
            : person.methods?.[0] === "manual_confirmed"
              ? "manual"
              : "manual";
  const status =
    person.kind === "confirmed"
      ? "confirmed"
      : person.kind === "collision"
        ? "rejected"
        : "proposed";
  report.writes.attempted += 1;
  const { error } = await newDb.from("migration_identity_matches").upsert(
    {
      batch_id: batchId,
      source_system: sourceSystem,
      external_user_id: String(externalUserId),
      staff_id: person.staffId,
      match_method: method,
      confidence: person.kind === "confirmed" ? 1 : person.kind.startsWith("candidate") ? 0.7 : 0,
      status,
      confirmed_at: person.kind === "confirmed" ? new Date().toISOString() : null,
    },
    { onConflict: "batch_id,source_system,external_user_id" },
  );
  if (error) throw error;
}

function processedOps() {
  return (
    report.import.imported +
    report.import.skippedUnchanged +
    report.import.quarantined +
    report.import.failed
  );
}

function maybeInjectFailure(label) {
  if (failAfter == null || dryRun) return;
  if (processedOps() < failAfter) return;
  hardFailed = true;
  throw new Error(`INJECTED_FAILURE after ${failAfter} processed records (${label})`);
}

if (!dryRun) {
  batchId = await ensureBatch();
  report.batchId = batchId;
}

if (entity === "expense") {
  const { profiles, categories, applications, versions, events } = legacyData;
  report.legacyCounts = {
    profiles: profiles.length,
    categories: categories.length,
    applications: applications.length,
    versions: versions.length,
    events: events.length,
    softDeleted: applications.filter((a) => a.deleted_at).length,
    withReceiptPath: applications.filter((a) => a.receipt_path).length,
  };
  report.import.sourceN = applications.length;
  report.reconciliation.sourceN = applications.length;
  report.receipt.withPath = report.legacyCounts.withReceiptPath;
  report.receipt.deferred = report.legacyCounts.withReceiptPath;

  for (const p of profiles) {
    const person = resolvePerson(
      { id: p.id, login_id: p.login_id, auth_user_id: p.id },
      legacyEmailByUserId,
    );
    countIdentity(person, prefix(p.id));
    await recordIdentityProposal(p.id, person);
  }

  const categoryIdByLegacy = new Map();
  for (const c of categories) {
    const code = String(c.code ?? `legacy_${c.id}`);
    if (dryRun) {
      categoryIdByLegacy.set(c.id, `dry:${code}`);
      continue;
    }
    report.writes.attempted += 1;
    const { data, error } = await newDb.rpc("regapro_service_import_expense_category", {
      p_org_id: orgId,
      p_code: code,
      p_name: String(c.name ?? code),
      p_sort_order: Number(c.sort_order ?? 0),
      p_active: c.is_active !== false,
    });
    if (error) throw error;
    categoryIdByLegacy.set(c.id, data);
  }

  const versionsByApp = new Map();
  for (const v of versions) {
    const list = versionsByApp.get(v.application_id) ?? [];
    list.push(v);
    versionsByApp.set(v.application_id, list);
  }
  const eventsByApp = new Map();
  for (const e of events) {
    const list = eventsByApp.get(e.application_id) ?? [];
    list.push(e);
    eventsByApp.set(e.application_id, list);
  }

  for (const app of applications) {
    if (app.deleted_at) report.import.excludedSoftDeleted += 1;
    const amountNum = Number(app.amount);
    if (Number.isFinite(amountNum)) report.amounts.sourceYenTotal += Math.trunc(amountNum);
    const person = resolvePerson(
      {
        id: app.applicant_id,
        login_id: profiles.find((p) => p.id === app.applicant_id)?.login_id,
        auth_user_id: app.applicant_id,
      },
      legacyEmailByUserId,
    );
    const externalId = String(app.id);
    const appVersions = versionsByApp.get(app.id) ?? [];
    const appEvents = eventsByApp.get(app.id) ?? [];
    const contentHash = hashPayload({
      application: {
        id: app.id,
        status: app.status,
        version: app.version,
        application_type: app.application_type,
        category_id: app.category_id,
        amount: app.amount,
        expense_date: app.expense_date,
        description: app.description,
        after_reason: app.after_reason,
        receipt_path: app.receipt_path,
        admin_note: app.admin_note,
        applicant_name_snapshot: app.applicant_name_snapshot,
        submitted_at: app.submitted_at,
        reviewed_at: app.reviewed_at,
        reviewed_by: app.reviewed_by,
        deleted_at: app.deleted_at,
        updated_at: app.updated_at,
      },
      versions: appVersions.map((v) => ({
        version: v.version,
        amount: v.amount,
        category_id: v.category_id,
        expense_date: v.expense_date,
        description: v.description,
        after_reason: v.after_reason,
        application_type: v.application_type,
        receipt_path: v.receipt_path,
      })),
      events: appEvents.map((e) => ({
        id: e.id,
        event_type: e.event_type,
        from_status: e.from_status,
        to_status: e.to_status,
        note: e.note,
        actor_id: e.actor_id,
      })),
    });

    const quarantinePayload = {
      contentHash,
      application_id: app.id,
      versionsN: appVersions.length,
      eventsN: appEvents.length,
      amount: app.amount,
      status: app.status,
      receipt_path: app.receipt_path ?? null,
      deleted_at: app.deleted_at ?? null,
    };

    if (person.kind !== "confirmed") {
      report.import.quarantined += 1;
      report.reconciliation.accountedN += 1;
      if (Number.isFinite(amountNum)) {
        report.amounts.quarantinedYenTotal += Math.trunc(amountNum);
      }
      if (report.samples.quarantined.length < 5) {
        report.samples.quarantined.push({
          externalPrefix: prefix(externalId),
          reason: person.kind,
        });
      }
      if (!dryRun) {
        report.writes.attempted += 1;
        await quarantineApply(
          externalId,
          String(app.applicant_id ?? ""),
          quarantinePayload,
          contentHash,
          `IDENTITY_${person.kind.toUpperCase()}`,
          `expense application not imported: identity ${person.kind}`,
        );
        try {
          maybeInjectFailure(`expense-quarantine:${prefix(externalId)}`);
        } catch (err) {
          report.import.failed += 1;
          report.reason = String(err?.message ?? err);
          break;
        }
      }
      continue;
    }

    // Confirmed path requires real description from enrichment (never invent "").
    if (
      app.description == null ||
      typeof app.description !== "string" ||
      app.description.trim() === "" ||
      app.applicant_name_snapshot == null ||
      typeof app.applicant_name_snapshot !== "string" ||
      app.applicant_name_snapshot.trim() === ""
    ) {
      report.import.quarantined += 1;
      report.reconciliation.accountedN += 1;
      if (Number.isFinite(amountNum)) {
        report.amounts.quarantinedYenTotal += Math.trunc(amountNum);
      }
      if (!dryRun) {
        report.writes.attempted += 1;
        await quarantineApply(
          externalId,
          String(app.applicant_id ?? ""),
          quarantinePayload,
          contentHash,
          "MISSING_REQUIRED_TEXT",
          "description/applicant_name_snapshot missing from enrichment",
        );
      }
      continue;
    }

    const amountCheck = parseYen("amount", app.amount);
    if (!amountCheck.ok) {
      report.import.quarantined += 1;
      report.reconciliation.accountedN += 1;
      if (Number.isFinite(amountNum)) {
        report.amounts.quarantinedYenTotal += Math.trunc(amountNum);
      }
      if (!dryRun) {
        report.writes.attempted += 1;
        await quarantineApply(
          externalId,
          String(app.applicant_id ?? ""),
          quarantinePayload,
          contentHash,
          "INVALID_AMOUNT",
          amountCheck.reason,
        );
        try {
          maybeInjectFailure(`expense-quarantine:${prefix(externalId)}`);
        } catch (err) {
          report.import.failed += 1;
          report.reason = String(err?.message ?? err);
          break;
        }
      }
      continue;
    }

    const categoryId = categoryIdByLegacy.get(app.category_id);
    if (!categoryId) {
      report.import.quarantined += 1;
      report.reconciliation.accountedN += 1;
      report.amounts.quarantinedYenTotal += amountCheck.value;
      if (!dryRun) {
        report.writes.attempted += 1;
        await quarantineApply(
          externalId,
          String(app.applicant_id ?? ""),
          quarantinePayload,
          contentHash,
          "CATEGORY_MISSING",
          "category not mapped",
        );
        try {
          maybeInjectFailure(`expense-quarantine:${prefix(externalId)}`);
        } catch (err) {
          report.import.failed += 1;
          report.reason = String(err?.message ?? err);
          break;
        }
      }
      continue;
    }

    const reviewer = app.reviewed_by
      ? resolvePerson({ id: app.reviewed_by, auth_user_id: app.reviewed_by }, legacyEmailByUserId)
      : null;

    report.import.plannedImport += 1;
    report.amounts.plannedYenTotal += amountCheck.value;
    if (report.samples.planned.length < 5) {
      report.samples.planned.push({
        externalPrefix: prefix(externalId),
        staffPrefix: prefix(person.staffId),
        status: app.status,
      });
    }

    if (dryRun) {
      report.reconciliation.accountedN += 1;
      continue;
    }

    const payload = {
      contentHash,
      staffId: person.staffId,
      categoryId,
      reviewerStaffId:
        reviewer?.kind === "confirmed" ? reviewer.staffId : null,
      application: app,
      versions: appVersions.map((v) => ({
        ...v,
        categoryId: categoryIdByLegacy.get(v.category_id) ?? categoryId,
      })),
      events: appEvents.map((e) => {
        const actor = e.actor_id
          ? resolvePerson({ id: e.actor_id, auth_user_id: e.actor_id }, legacyEmailByUserId)
          : null;
        return {
          ...e,
          actorStaffId: actor?.kind === "confirmed" ? actor.staffId : null,
          metadata: {
            from_status: e.from_status,
            to_status: e.to_status,
            note: e.note,
            actor_unresolved: !(actor?.kind === "confirmed"),
          },
        };
      }),
    };

    report.writes.attempted += 1;
    const { data, error } = await newDb.rpc("regapro_service_import_expense_application", {
      p_org_id: orgId,
      p_batch_id: batchId,
      p_payload: payload,
    });
    if (error) {
      report.import.failed += 1;
      hardFailed = true;
      report.writes.attempted += 1;
      await quarantineApply(
        externalId,
        String(app.applicant_id ?? ""),
        { ...quarantinePayload, error: error.message },
        contentHash,
        "IMPORT_RPC_FAILED",
        error.message,
      );
      report.reconciliation.accountedN += 1;
      continue;
    }
    if (data?.status === "skipped_unchanged") report.import.skippedUnchanged += 1;
    else {
      report.import.imported += 1;
      report.amounts.importedYenTotal += amountCheck.value;
    }
    report.reconciliation.accountedN += 1;
    try {
      maybeInjectFailure(`expense:${prefix(externalId)}`);
    } catch (err) {
      report.import.failed += 1;
      report.reason = String(err?.message ?? err);
      break;
    }
  }
} else {
  const { members, salesRecords, allocations, axisRecords } = legacyData;
  const axisBySync = new Map(
    (axisRecords ?? []).map((a) => [a.source_sync_id, a]),
  );
  report.legacyCounts = {
    members: members.length,
    salesRecords: salesRecords.length,
    activeSales: salesRecords.filter((s) => s.is_active && !s.deleted_at).length,
    allocations: allocations.length,
    axisRecords: axisRecords.length,
    salesWithAxisSync: salesRecords.filter(
      (s) => s.source_sync_id && axisBySync.has(s.source_sync_id),
    ).length,
  };
  report.sourceOfTruth =
    "personal_sales_cases from sales_records + allocation snapshots; axis_records are provenance only";
  report.import.sourceN = salesRecords.length;
  report.reconciliation.sourceN = salesRecords.length;

  for (const m of members) {
    const person = resolvePerson(
      { id: m.id, auth_user_id: m.auth_user_id },
      legacyEmailByUserId,
    );
    countIdentity(person, prefix(m.id));
    await recordIdentityProposal(m.id, person);
  }

  const allocsBySales = new Map();
  for (const a of allocations) {
    const list = allocsBySales.get(a.sales_record_id) ?? [];
    list.push(a);
    allocsBySales.set(a.sales_record_id, list);
  }
  const memberMap = new Map(members.map((m) => [m.id, m]));

  for (const sr of salesRecords) {
    if (sr.deleted_at || sr.is_active === false) report.import.excludedInactive += 1;
    const externalId = String(sr.id);
    const rowAllocs = allocsBySales.get(sr.id) ?? [];
    const invoiceNum = Number(sr.invoice_amount_incl);
    if (Number.isFinite(invoiceNum)) {
      report.amounts.sourceYenTotal += Math.trunc(invoiceNum);
    }
    const resolved = [];
    let blockingReason = null;
    for (const a of rowAllocs) {
      const member = memberMap.get(a.member_id);
      const person = resolvePerson(
        { id: a.member_id, auth_user_id: member?.auth_user_id ?? null },
        legacyEmailByUserId,
      );
      if (person.kind !== "confirmed") {
        blockingReason = `alloc_identity_${person.kind}`;
        break;
      }
      const rate = parseRateBps("allocation_rate", a.allocation_rate);
      const salesYen = parseYenNonNeg("allocated_sales_incl", a.allocated_sales_incl);
      const profitYen =
        a.allocated_profit_incl == null
          ? { ok: true, value: null }
          : parseYenNonNeg("allocated_profit_incl", a.allocated_profit_incl);
      if (!rate.ok || !salesYen.ok || !profitYen.ok) {
        blockingReason = rate.reason ?? salesYen.reason ?? profitYen.reason;
        break;
      }
      resolved.push({
        ...a,
        staffId: person.staffId,
        _rateBps: rate.value,
        _salesYen: salesYen.value,
        _profitYen: profitYen.value,
      });
    }

    const invoice = parseYenNonNeg("invoice_amount_incl", sr.invoice_amount_incl);
    const contentHash = hashPayload({
      id: sr.id,
      source_sync_id: sr.source_sync_id,
      work_date: sr.work_date,
      client_name: sr.client_name,
      location: sr.location,
      carrier: sr.carrier,
      work_role: sr.work_role,
      staff_name: sr.staff_name,
      staff_company: sr.staff_company,
      invoice_amount_excl: sr.invoice_amount_excl,
      invoice_amount_incl: sr.invoice_amount_incl,
      pay_amount_incl: sr.pay_amount_incl,
      case_profit_incl: sr.case_profit_incl,
      case_owner_name: sr.case_owner_name,
      assign_owner_name: sr.assign_owner_name,
      source_sheet: sr.source_sheet,
      source_row: sr.source_row,
      is_active: sr.is_active,
      deleted_at: sr.deleted_at,
      allocations: rowAllocs.map((a) => ({
        id: a.id,
        member_id: a.member_id,
        allocation_type: a.allocation_type,
        allocation_rate: a.allocation_rate,
        allocated_sales_incl: a.allocated_sales_incl,
        allocated_profit_incl: a.allocated_profit_incl,
      })),
    });

    const quarantinePayload = {
      contentHash,
      sales_record_id: sr.id,
      allocN: rowAllocs.length,
      resolvedN: resolved.length,
      missingN: rowAllocs.length - resolved.length,
      invoice_amount_incl: sr.invoice_amount_incl,
      source_sync_id: sr.source_sync_id,
      axis_present: Boolean(sr.source_sync_id && axisBySync.has(sr.source_sync_id)),
      allocations: rowAllocs.map((a) => ({
        id: a.id,
        member_id_prefix: prefix(String(a.member_id)),
        allocation_type: a.allocation_type,
        allocation_rate: a.allocation_rate,
        allocated_sales_incl: a.allocated_sales_incl,
        allocated_profit_incl: a.allocated_profit_incl,
      })),
    };

    if (rowAllocs.length === 0) blockingReason = blockingReason ?? "no_allocations";
    if (!invoice.ok) blockingReason = blockingReason ?? invoice.reason;
    if (resolved.length !== rowAllocs.length) {
      blockingReason = blockingReason ?? "partial_allocation_identity";
    }

    if (blockingReason) {
      report.import.quarantined += 1;
      report.reconciliation.accountedN += 1;
      if (Number.isFinite(invoiceNum)) {
        report.amounts.quarantinedYenTotal += Math.trunc(invoiceNum);
      }
      if (report.samples.quarantined.length < 5) {
        report.samples.quarantined.push({
          externalPrefix: prefix(externalId),
          reason: blockingReason,
          allocN: rowAllocs.length,
          resolvedN: resolved.length,
        });
      }
      if (!dryRun) {
        report.writes.attempted += 1;
        await quarantineApply(
          externalId,
          null,
          quarantinePayload,
          contentHash,
          "SALES_QUARANTINE",
          blockingReason,
        );
        try {
          maybeInjectFailure(`sales-quarantine:${prefix(externalId)}`);
        } catch (err) {
          report.import.failed += 1;
          report.reason = String(err?.message ?? err);
          break;
        }
      }
      continue;
    }

    const primary =
      resolved.find((a) => a.allocation_type === "case_owner") ?? resolved[0];
    report.import.plannedImport += 1;
    report.amounts.plannedYenTotal += invoice.value;
    if (report.samples.planned.length < 5) {
      report.samples.planned.push({
        externalPrefix: prefix(externalId),
        staffPrefix: prefix(primary.staffId),
        allocN: resolved.length,
      });
    }
    if (dryRun) {
      report.reconciliation.accountedN += 1;
      continue;
    }

    const titleParts = [sr.client_name, sr.location, sr.work_role].filter(Boolean);
    const payload = {
      contentHash,
      primaryStaffId: primary.staffId,
      title: titleParts.join(" / ") || `sales ${prefix(externalId)}`,
      salesRecord: sr,
      sourceRef: {
        legacy_sales_record_id: sr.id,
        source_sync_id: sr.source_sync_id,
        source_sheet: sr.source_sheet,
        source_row: sr.source_row,
        axis_present: Boolean(sr.source_sync_id && axisBySync.has(sr.source_sync_id)),
      },
      allocations: resolved.map((a) => ({
        id: a.id,
        staffId: a.staffId,
        allocation_type: a.allocation_type,
        allocation_rate: a.allocation_rate,
        allocated_sales_incl: a.allocated_sales_incl,
        allocated_profit_incl: a.allocated_profit_incl,
        created_at: a.created_at,
      })),
    };

    report.writes.attempted += 1;
    const { data, error } = await newDb.rpc("regapro_service_import_personal_sales_case", {
      p_org_id: orgId,
      p_batch_id: batchId,
      p_payload: payload,
    });
    if (error) {
      report.import.failed += 1;
      hardFailed = true;
      report.writes.attempted += 1;
      await quarantineApply(
        externalId,
        null,
        { ...quarantinePayload, error: error.message },
        contentHash,
        "IMPORT_RPC_FAILED",
        error.message,
      );
      report.reconciliation.accountedN += 1;
      continue;
    }
    if (data?.status === "skipped_unchanged") report.import.skippedUnchanged += 1;
    else {
      report.import.imported += 1;
      report.amounts.importedYenTotal += invoice.value;
    }
    report.reconciliation.accountedN += 1;
    try {
      maybeInjectFailure(`sales:${prefix(externalId)}`);
    } catch (err) {
      report.import.failed += 1;
      report.reason = String(err?.message ?? err);
      break;
    }
  }
}

report.reconciliation.balanced =
  report.reconciliation.accountedN === report.reconciliation.sourceN;
if (!report.reconciliation.balanced) {
  report.status = "FAILED";
  report.reason = report.reason ?? "reconciliation mismatch";
  hardFailed = true;
}

report.reconciliation.importedOrSkipped =
  report.import.imported + report.import.skippedUnchanged;
report.reconciliation.heldForIdentityOrData = report.import.quarantined;
report.reconciliation.check =
  report.reconciliation.sourceN ===
  report.reconciliation.importedOrSkipped +
    report.import.quarantined +
    (hardFailed ? 0 : 0);

try {
  mkdirSync(join("tmp/legacy-import/_restricted"), { recursive: true });
  writeFileSync(
    join("tmp/legacy-import/_restricted/identity_review.json"),
    `${JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        entity,
        orgIdPrefix: prefix(orgId),
        source_system: sourceSystem,
        rows: identityReview,
        policy: "no emails, names, or email_md5; prefixes and methods only",
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  report.identityReviewPath = "tmp/legacy-import/_restricted/identity_review.json";
} catch (err) {
  report.identityReviewWriteError = String(err?.message ?? err);
}

if (!dryRun) {
  try {
    await finishBatch(hardFailed || report.import.failed > 0 ? "failed" : "applied");
  } catch (err) {
    report.status = "FAILED";
    report.reason = `batch_finish_failed: ${err?.message ?? err}`;
    hardFailed = true;
  }
}

if (report.status === "OK" && (hardFailed || report.import.failed > 0)) {
  report.status = "FAILED";
}

console.log(JSON.stringify(report, null, 2));
process.exit(report.status === "FAILED" || report.status === "BLOCKED" ? 1 : 0);
