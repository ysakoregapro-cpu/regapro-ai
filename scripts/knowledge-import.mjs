#!/usr/bin/env node
/**
 * Bulk Knowledge Import CLI.
 *
 *   npm run knowledge:import -- ".\.local\knowledge-import\current-seed" --dry-run
 *   npm run knowledge:import -- ".\.local\knowledge-import\current-seed"
 *
 * Authenticates as a knowledge:write user (JWT + RLS). Does not bypass
 * security with service_role. Does not auto-publish. Does not print bodies
 * or secrets.
 */
import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

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

function argFlag(name) {
  return process.argv.includes(name);
}

function positionalDir() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  return args[0];
}

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
}

function collectFiles(dir, base = dir, out = new Map()) {
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".") && name !== ".keep") continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      collectFiles(full, base, out);
      continue;
    }
    if (/\.(env|pem|key)$/i.test(name) || name === "manifest.json") continue;
    const rel = relative(base, full).replace(/\\/g, "/");
    out.set(rel, readFileSync(full, "utf8"));
  }
  return out;
}

const knowledgeDist = resolve(root, "packages/knowledge/dist/index.js");
const sharedDist = resolve(root, "packages/shared/dist/index.js");
if (!existsSync(knowledgeDist) || !existsSync(sharedDist)) {
  fail("packages are not built. Run: npm run build:packages");
}

const knowledge = await import(pathToFileURL(knowledgeDist).href);
const shared = await import(pathToFileURL(sharedDist).href);

const dirArg = positionalDir();
if (!dirArg) {
  fail(
    'Usage: npm run knowledge:import -- "<dir>" [--dry-run]\nExample: npm run knowledge:import -- ".\\.local\\knowledge-import\\current-seed" --dry-run',
  );
}

const importDir = resolve(process.cwd(), dirArg);
if (!existsSync(importDir) || !statSync(importDir).isDirectory()) {
  fail(`import directory not found: ${importDir}`);
}

const manifestPath = join(importDir, "manifest.json");
if (!existsSync(manifestPath)) {
  const yaml = ["manifest.yaml", "manifest.yml"].find((n) => existsSync(join(importDir, n)));
  if (yaml) {
    fail("YAML manifests are not supported (no yaml dependency). Use manifest.json.");
  }
  fail(`manifest.json not found in ${importDir}`);
}

let raw;
try {
  raw = JSON.parse(readFileSync(manifestPath, "utf8"));
} catch {
  fail("manifest.json is not valid JSON");
}

const parsed = knowledge.parseKnowledgeImportManifest(raw);
if (!parsed.ok) {
  console.error("manifest validation failed:");
  for (const f of parsed.failures) {
    console.error(`  - ${f.path}: ${f.message} (${f.code})`);
  }
  process.exit(1);
}

const files = collectFiles(importDir);
const resolved = knowledge.resolveKnowledgeImportItems({
  manifest: parsed.manifest,
  files,
  hash: sha256,
});
if (resolved.failures.length) {
  console.error("import items failed before write:");
  for (const f of resolved.failures) {
    console.error(`  - ${f.itemId ?? f.path}: ${f.message} (${f.code})`);
  }
  process.exit(1);
}

const dryRun = argFlag("--dry-run");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const anon = (
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  ""
).trim();
const email = process.env.REGAPRO_KNOWLEDGE_IMPORT_EMAIL?.trim();
const password = process.env.REGAPRO_KNOWLEDGE_IMPORT_PASSWORD;

async function signInUser() {
  if (!url || !anon) {
    fail("Missing NEXT_PUBLIC_SUPABASE_URL and publishable/anon key.");
  }
  if (!email || !password) {
    fail(
      "Set REGAPRO_KNOWLEDGE_IMPORT_EMAIL and REGAPRO_KNOWLEDGE_IMPORT_PASSWORD. Writes use the user JWT (RLS). service_role is not used.",
    );
  }
  const client = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.user || !data.session) {
    fail(`sign-in failed: ${error?.message ?? "no session"}`);
  }
  return { client, user: data.user };
}

async function loadMembership(client, userId) {
  const { data, error } = await client
    .from("organization_memberships")
    .select(
      `
      id,
      org_id,
      user_id,
      department_id,
      clearance_override,
      departments ( id, key, name, default_clearance_level ),
      membership_roles ( deleted_at, roles ( key, deleted_at ) )
    `,
    )
    .eq("user_id", userId)
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();
  if (error || !data) {
    fail(`membership not found: ${error?.message ?? "empty"}`);
  }
  const roles = (data.membership_roles ?? [])
    .filter((mr) => mr.deleted_at === null && mr.roles && !mr.roles.deleted_at)
    .map((mr) => mr.roles.key);
  const permissions = new Set();
  for (const role of roles) {
    for (const p of shared.ROLE_PERMISSIONS[role] ?? []) permissions.add(p);
  }
  if (!permissions.has("knowledge:write")) {
    fail("this user does not have knowledge:write");
  }
  const deptKey = data.departments?.key;
  const override = data.clearance_override;
  const maxLevel = override
    ? shared.confidentialityFromRank(override)
    : shared.DEPARTMENT_DEFAULT_CLEARANCE[deptKey] ?? "company";
  return {
    orgId: data.org_id,
    membershipId: data.id,
    departmentId: data.department_id,
    maxLevel,
    roles,
  };
}

async function loadExisting(client, orgId) {
  const { data: sources } = await client
    .from("knowledge_sources")
    .select("id, name, content_hash, checksum, metadata")
    .eq("org_id", orgId)
    .is("deleted_at", null)
    .limit(2000);
  const existingSources = (sources ?? []).map((s) => ({
    sourceId: s.id,
    candidateId: null,
    importItemId: s.metadata?.importItemId ?? null,
    contentHash: s.content_hash,
    checksum: s.checksum,
    title: s.name,
  }));
  const { data: docs } = await client
    .from("knowledge_documents")
    .select("id, title, fact_status, is_current, source_quality, source_type")
    .eq("org_id", orgId)
    .eq("status", "published")
    .is("deleted_at", null)
    .limit(80);
  return { existingSources, existingPublished: (docs ?? []).map((d) => ({
    id: d.id,
    title: d.title,
    body: d.title,
    factStatus: d.fact_status,
    current: d.is_current,
    sourceQuality: d.source_quality,
    originKind: d.source_type,
  })) };
}

let existingSources = [];
let existingPublished = [];
let session = null;

if (!dryRun || (email && password)) {
  session = await signInUser();
  const membership = await loadMembership(session.client, session.user.id);
  const live = await loadExisting(session.client, membership.orgId);
  existingSources = live.existingSources;
  existingPublished = live.existingPublished;
  session.membership = membership;
}

const plan = knowledge.planKnowledgeImport({
  items: resolved.items,
  existingSources,
  existingPublished,
});

console.log(`Knowledge import ${dryRun ? "dry-run" : "apply"}`);
console.log(`directory: ${relative(process.cwd(), importDir) || "."}`);
console.log(knowledge.formatImportPlanSummary(plan));

if (plan.invalid.length) {
  fail("invalid items present; refusing to write.");
}

if (dryRun) {
  console.log("dry-run: no database or storage writes.");
  process.exit(0);
}

if (!session) fail("authentication required for apply");

const membership = session.membership;
const client = session.client;
const userId = session.user.id;

function canAssign(level) {
  return shared.compareConfidentiality(level, membership.maxLevel) <= 0;
}

async function applyStructured(item) {
  const records = knowledge.buildStructuredImportRecords({
    item,
    existingPublished,
  });
  const { data: source, error: sErr } = await client
    .from("knowledge_sources")
    .insert({
      org_id: membership.orgId,
      name: records.source.name,
      source_type: records.source.source_type,
      origin_kind: records.source.origin_kind,
      raw_text: records.source.raw_text,
      normalized_text: records.source.normalized_text,
      content_hash: records.source.content_hash,
      checksum: records.source.checksum,
      confidentiality_level: records.source.confidentiality_level,
      visibility: records.source.visibility,
      owner_user_id: userId,
      department_id: records.source.department_id ?? membership.departmentId,
      project_id: records.source.project_id,
      source_date: records.source.source_date,
      observed_at: new Date().toISOString(),
      metadata: records.source.metadata,
    })
    .select("id")
    .single();
  if (sErr || !source) throw new Error(sErr?.message ?? "source insert failed");
  const { data: job, error: jErr } = await client
    .from("knowledge_ingestion_jobs")
    .insert({
      org_id: membership.orgId,
      source_id: source.id,
      status: records.job.status,
      created_by: userId,
      total_units: records.job.total_units,
      processed_units: records.job.processed_units,
      failed_units: records.job.failed_units,
      completed_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (jErr || !job) throw new Error(jErr?.message ?? "job insert failed");
  const { data: chunk, error: cErr } = await client
    .from("knowledge_source_chunks")
    .insert({
      org_id: membership.orgId,
      source_id: source.id,
      job_id: job.id,
      chunk_index: records.chunk.chunk_index,
      content: records.chunk.content,
      content_hash: records.chunk.content_hash,
      status: records.chunk.status,
    })
    .select("id")
    .single();
  if (cErr || !chunk) throw new Error(cErr?.message ?? "chunk insert failed");
  const { error: candErr } = await client.from("knowledge_candidates").insert({
    org_id: membership.orgId,
    title: records.candidate.title,
    content: records.candidate.content,
    content_hash: records.candidate.content_hash,
    suggested_confidentiality_level: records.candidate.suggested_confidentiality_level,
    suggested_visibility: records.candidate.suggested_visibility,
    source_user_id: userId,
    source_id: source.id,
    source_chunk_id: chunk.id,
    source_excerpt: records.candidate.source_excerpt,
    candidate_type: records.candidate.candidate_type,
    fact_status: records.candidate.fact_status,
    review_status: records.candidate.review_status,
    domain_keys: records.candidate.domain_keys,
    summary: records.candidate.summary,
    tags: records.candidate.tags,
    conflict_kind: records.candidate.conflict_kind,
    conflict_reason: records.candidate.conflict_reason,
    supersedes_document_id: records.candidate.supersedes_document_id,
    confidence: records.candidate.confidence,
    source_quality: records.candidate.source_quality,
    is_current: records.candidate.is_current,
    valid_from: records.candidate.valid_from,
    valid_until: records.candidate.valid_until,
    source_date: records.candidate.source_date,
    extracted_at: new Date().toISOString(),
    extractor_type: records.candidate.extractor_type,
    extractor_version: records.candidate.extractor_version,
    prompt_version: records.candidate.prompt_version,
    status: records.candidate.status,
  });
  if (candErr) throw new Error(candErr.message);
  return { sourceId: source.id, jobId: job.id };
}

async function applySource(item) {
  const originKind = knowledge.originKindForImportItem(item);
  const { data: source, error: sErr } = await client
    .from("knowledge_sources")
    .insert({
      org_id: membership.orgId,
      name: item.title.slice(0, 200),
      source_type: originKind,
      origin_kind: originKind,
      raw_text: item.content,
      normalized_text: item.content,
      content_hash: item.contentHash,
      checksum: item.checksum,
      confidentiality_level: shared.confidentialityRank(item.clearanceLevel),
      visibility: item.visibility,
      owner_user_id: userId,
      department_id: item.departmentId ?? membership.departmentId,
      project_id: item.projectId,
      source_date: item.sourceDate,
      observed_at: new Date().toISOString(),
      metadata: {
        importItemId: item.id,
        importMode: item.importMode,
        domainKeys: item.domains,
        sourceQuality: item.sourceQuality,
        authoritativeSeed: item.authoritativeSeed,
      },
    })
    .select("id")
    .single();
  if (sErr || !source) throw new Error(sErr?.message ?? "source insert failed");
  const { data: job, error: jErr } = await client
    .from("knowledge_ingestion_jobs")
    .insert({
      org_id: membership.orgId,
      source_id: source.id,
      status: "pending",
      created_by: userId,
    })
    .select("id")
    .single();
  if (jErr || !job) throw new Error(jErr?.message ?? "job insert failed");
  return { sourceId: source.id, jobId: job.id };
}

const byId = new Map(resolved.items.map((i) => [i.id, i]));
let created = 0;
let skipped = 0;
let sourceJobs = 0;
for (const row of plan.items) {
  if (row.action === "skip_duplicate") {
    skipped += 1;
    continue;
  }
  const item = byId.get(row.id);
  if (!item) continue;
  if (!canAssign(item.clearanceLevel)) {
    fail(`clearance ${row.clearanceLabel} exceeds importer maximum for item ${item.id}`);
  }
  try {
    if (item.importMode === "source") {
      await applySource(item);
      sourceJobs += 1;
    } else {
      await applyStructured(item);
    }
    created += 1;
  } catch (err) {
    fail(`write failed for ${item.id}: ${err instanceof Error ? err.message : "failed"}`);
  }
}

console.log(
  `wrote: ${created} (skipped ${skipped}, source jobs queued ${sourceJobs}). review inbox only; not published.`,
);
if (sourceJobs) {
  console.log("source-mode jobs are pending. Process them from 処理状況 to extract candidates.");
}
