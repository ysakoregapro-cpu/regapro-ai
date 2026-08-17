#!/usr/bin/env node
/**
 * Live Knowledge Factory smoke. Does NOT run in `npm test`.
 *
 *   REGAPRO_KNOWLEDGE_FACTORY_SMOKE=1 npm run smoke:knowledge-factory
 *
 * Uses a tagged non-secret fixture and deletes it afterwards.
 * Never prints source bodies or secrets.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";

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

if (
  process.env.REGAPRO_KNOWLEDGE_FACTORY_SMOKE !== "1" &&
  process.env.REGAPRO_KNOWLEDGE_HARDENING_SMOKE !== "1"
) {
  console.log(
    "smoke:knowledge-factory skipped (set REGAPRO_KNOWLEDGE_FACTORY_SMOKE=1 or REGAPRO_KNOWLEDGE_HARDENING_SMOKE=1)",
  );
  process.exit(0);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const secret = (
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || ""
).trim();
const anon = (
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  ""
).trim();

const FIXTURE =
  "株式会社テストでは2026年8月に新しい営業部長が就任した";
const TAG = `KF-SMOKE-${Date.now()}`;

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

const admin = createClient(url, secret, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const knowledge = await import(
  pathToFileURL(resolve(root, "packages/knowledge/dist/index.js")).href
);
const localAi = await import(
  pathToFileURL(resolve(root, "packages/local-ai/dist/index.js")).href
);

const { data: org, error: orgErr } = await admin
  .from("organizations")
  .select("id")
  .eq("slug", "regapro")
  .is("deleted_at", null)
  .maybeSingle();
if (orgErr || !org) {
  console.error("FAIL: org not found", orgErr?.message);
  process.exit(1);
}

const { data: member } = await admin
  .from("organization_memberships")
  .select("user_id")
  .eq("org_id", org.id)
  .is("deleted_at", null)
  .limit(1)
  .maybeSingle();
const userId = member?.user_id;
if (!userId) {
  console.error("FAIL: no membership for fixture owner");
  process.exit(1);
}

let sourceId = null;
let documentId = null;
let candidateId = null;
let smokeUserId = null;
let smokeMembershipId = null;
let failed = false;

try {
  const extractor = new knowledge.HeuristicKnowledgeExtractor();
  const drafts = await extractor.extract({
    originKind: "paste",
    title: TAG,
    text: FIXTURE,
    chunkIndex: 0,
    domainKeys: ["sales"],
  });
  const cand = drafts[0];
  if (!cand) throw new Error("extractor returned no candidate");

  const { data: source, error: sErr } = await admin
    .from("knowledge_sources")
    .insert({
      org_id: org.id,
      name: TAG,
      source_type: "paste",
      origin_kind: "paste",
      raw_text: FIXTURE,
      content_hash: sha256(FIXTURE + TAG),
      confidentiality_level: 1,
      visibility: "organization",
      owner_user_id: userId,
      source_date: "2026-08-01",
      observed_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (sErr || !source) throw new Error(sErr?.message ?? "source insert");
  sourceId = source.id;

  const { data: job, error: jErr } = await admin
    .from("knowledge_ingestion_jobs")
    .insert({
      org_id: org.id,
      source_id: source.id,
      status: "completed",
      total_units: 1,
      processed_units: 1,
      created_by: userId,
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (jErr || !job) throw new Error(jErr?.message ?? "job insert");

  const { data: chunk, error: cErr } = await admin
    .from("knowledge_source_chunks")
    .insert({
      org_id: org.id,
      source_id: source.id,
      job_id: job.id,
      chunk_index: 0,
      content: FIXTURE,
      content_hash: sha256(FIXTURE),
      status: "completed",
      extracted_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (cErr || !chunk) throw new Error(cErr?.message ?? "source chunk");

  const { data: candidate, error: candErr } = await admin
    .from("knowledge_candidates")
    .insert({
      org_id: org.id,
      title: TAG,
      content: cand.content,
      suggested_confidentiality_level: 1,
      suggested_visibility: "organization",
      source_user_id: userId,
      source_id: source.id,
      source_chunk_id: chunk.id,
      source_excerpt: cand.excerpt,
      candidate_type: cand.candidateType,
      fact_status: cand.factStatus,
      review_status: "approved",
      status: "approved",
      domain_keys: ["sales"],
      summary: cand.summary,
      extractor_type: "heuristic",
      extractor_version: "heuristic-v1",
      prompt_version: "heuristic-v1",
      extracted_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (candErr || !candidate) throw new Error(candErr?.message ?? "candidate");
  candidateId = candidate.id;

  await admin.from("knowledge_candidate_reviews").insert({
    org_id: org.id,
    candidate_id: candidate.id,
    reviewer_id: userId,
    action: "approve",
    comment: "smoke",
  });

  const { data: doc, error: dErr } = await admin
    .from("knowledge_documents")
    .insert({
      org_id: org.id,
      source_id: source.id,
      title: TAG,
      status: "published",
      content_hash: sha256(cand.content),
      confidentiality_level: 1,
      visibility: "organization",
      owner_user_id: userId,
      source_type: "paste",
      candidate_id: candidate.id,
      domain_keys: ["sales"],
      fact_status: "fact",
      is_current: true,
      published_at: new Date().toISOString(),
      embedding_status: "pending",
    })
    .select("id")
    .single();
  if (dErr || !doc) throw new Error(dErr?.message ?? "document");
  documentId = doc.id;

  const { data: version, error: vErr } = await admin
    .from("knowledge_document_versions")
    .insert({
      document_id: doc.id,
      version_number: 1,
      body: cand.content,
      created_by: userId,
    })
    .select("id")
    .single();
  if (vErr || !version) throw new Error(vErr?.message ?? "version");

  const embedding = localAi.createEmbeddingProvider();
  if (!embedding.available) {
    throw new Error("embedding provider unavailable");
  }
  const [vec] = await embedding.embedDocuments([cand.content]);
  if (!vec || vec.values.length !== 384) {
    throw new Error("embedding dimension mismatch");
  }

  const { error: kcErr } = await admin.from("knowledge_chunks").insert({
    document_version_id: version.id,
    document_id: doc.id,
    org_id: org.id,
    chunk_index: 0,
    content: cand.content,
    content_normalized: cand.content,
    content_hash: sha256(cand.content),
    confidentiality_level: 1,
    visibility: "organization",
    owner_user_id: userId,
    source_type: "paste",
    contains_personal_conversation: false,
    embedding: JSON.stringify(vec.values),
    embedding_model: vec.modelId,
    embedding_version: vec.modelVersion,
    embedding_dimensions: 384,
  });
  if (kcErr) throw new Error(kcErr.message);

  await admin
    .from("knowledge_documents")
    .update({ embedding_status: "ready" })
    .eq("id", doc.id);

  const { data: chunkRow, error: chunkReadErr } = await admin
    .from("knowledge_chunks")
    .select("id, embedding_dimensions")
    .eq("document_id", doc.id)
    .maybeSingle();
  if (chunkReadErr || !chunkRow) throw new Error(chunkReadErr?.message ?? "chunk missing");
  if (chunkRow.embedding_dimensions !== 384) {
    throw new Error("embedding not stored as 384-d");
  }

  if (!anon) throw new Error("missing publishable key for JWT retrieval");
  const smokeEmail = `kf-smoke-${Date.now()}@example.com`;
  const smokePassword = `Kf${Date.now()}!aA1`;
  const createdUser = await admin.auth.admin.createUser({
    email: smokeEmail,
    password: smokePassword,
    email_confirm: true,
  });
  if (createdUser.error || !createdUser.data.user) {
    throw new Error(createdUser.error?.message ?? "smoke user create");
  }
  const smokeUserIdLocal = createdUser.data.user.id;
  smokeUserId = smokeUserIdLocal;
  await admin.from("profiles").upsert({
    user_id: smokeUserIdLocal,
    display_name: TAG,
  });
  const { data: membership, error: mErr } = await admin
    .from("organization_memberships")
    .insert({ org_id: org.id, user_id: smokeUserIdLocal })
    .select("id")
    .single();
  if (mErr || !membership) throw new Error(mErr?.message ?? "membership");
  smokeMembershipId = membership.id;
  const { data: editorRole } = await admin
    .from("roles")
    .select("id")
    .eq("key", "editor")
    .is("org_id", null)
    .maybeSingle();
  if (!editorRole) throw new Error("editor role missing");
  await admin.from("membership_roles").insert({
    membership_id: membership.id,
    role_id: editorRole.id,
  });
  const userClient = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signed = await userClient.auth.signInWithPassword({
    email: smokeEmail,
    password: smokePassword,
  });
  if (signed.error) throw new Error(signed.error.message);
  const lex = await userClient.rpc("regapro_knowledge_lexical_search", {
    p_query: "株式会社テスト 営業部長",
    p_limit: 10,
  });
  if (lex.error) throw new Error(lex.error.message);
  const hit = (lex.data ?? []).some((h) => h.document_id === doc.id);
  if (!hit) throw new Error("lexical search missed fixture document");

  console.log("OK: source → candidate → review → publish → chunk → e5 → lexical");
  console.log(
    JSON.stringify({
      source: Boolean(sourceId),
      document: Boolean(documentId),
      embeddingDims: 384,
      lexicalHit: true,
    }),
  );
} catch (err) {
  failed = true;
  console.error("FAIL:", err instanceof Error ? err.message : err);
} finally {
  if (documentId) {
    await admin.from("knowledge_chunks").delete().eq("document_id", documentId);
    await admin.from("knowledge_document_versions").delete().eq("document_id", documentId);
    await admin.from("knowledge_documents").delete().eq("id", documentId);
  }
  if (candidateId) {
    await admin.from("knowledge_candidate_reviews").delete().eq("candidate_id", candidateId);
    await admin.from("knowledge_candidates").delete().eq("id", candidateId);
  }
  if (sourceId) {
    await admin.from("knowledge_source_chunks").delete().eq("source_id", sourceId);
    await admin.from("knowledge_ingestion_jobs").delete().eq("source_id", sourceId);
    await admin.from("knowledge_sources").delete().eq("id", sourceId);
  }
  if (smokeMembershipId) {
    await admin.from("membership_roles").delete().eq("membership_id", smokeMembershipId);
    await admin.from("organization_memberships").delete().eq("id", smokeMembershipId);
  }
  if (smokeUserId) {
    await admin.from("profiles").delete().eq("user_id", smokeUserId);
    await admin.auth.admin.deleteUser(smokeUserId);
  }
  console.log("cleanup: fixture rows removed");
}

process.exit(failed ? 1 : 0);
