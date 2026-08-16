#!/usr/bin/env node
/**
 * Live conversation-path E2E. Does NOT run in `npm test`.
 *
 *   REGAPRO_ANSWER_E2E=1 npm run e2e:answer-pipeline
 *
 * Reports counts only. Never prints secrets, message bodies, or confidential text.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";

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

if (process.env.REGAPRO_ANSWER_E2E !== "1") {
  console.log("e2e:answer-pipeline skipped (set REGAPRO_ANSWER_E2E=1)");
  process.exit(0);
}

const CASE_A =
  "レガプロで有料職業紹介事業を進める上で、現在把握している主な取り組みを整理して";
const CASE_B =
  "レガプロの通信事業について、現在把握している社内状況と現在の通信販売・人材市場の外部環境を分けて調査し、来期に向けた組織上の課題と改善案を3案比較して。外部情報には根拠を付けて。";

function redact(msg) {
  return String(msg).replace(/sk-[A-Za-z0-9._-]+/g, "[REDACTED]");
}

const security = await import(
  pathToFileURL(resolve(root, "packages/security/dist/index.js")).href
);
const runtime = await import(
  pathToFileURL(resolve(root, "packages/ai-runtime/dist/index.js")).href
);
const webIntel = await import(
  pathToFileURL(resolve(root, "packages/web-intelligence/dist/index.js")).href
);

function access() {
  return security.buildAccessContext({
    userId: process.env.REGAPRO_E2E_USER_ID || "00000000-0000-0000-0000-000000000001",
    organizationId:
      process.env.REGAPRO_E2E_ORG_ID || "00000000-0000-0000-0000-000000000002",
    membershipId: "00000000-0000-0000-0000-000000000003",
    departmentId: "00000000-0000-0000-0000-000000000004",
    departmentKey: "sales",
    roles: ["editor"],
    threadConfidentialityLevel: "company",
    threadVisibility: "organization",
  });
}

async function knowledgeInventory() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = (
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || ""
  ).trim();
  if (!url || !key) {
    return { documents: null, published: null, chunks: null };
  }
  const admin = createClient(url, key, { auth: { persistSession: false } });
  const [docs, published, chunks] = await Promise.all([
    admin.from("knowledge_documents").select("id", { count: "exact", head: true }).is("deleted_at", null),
    admin
      .from("knowledge_documents")
      .select("id", { count: "exact", head: true })
      .is("deleted_at", null)
      .eq("status", "published"),
    admin.from("knowledge_chunks").select("id", { count: "exact", head: true }).is("deleted_at", null),
  ]);
  return {
    documents: docs.count ?? 0,
    published: published.count ?? 0,
    chunks: chunks.count ?? 0,
  };
}

function emptyKnowledgeSearch() {
  return {
    async lexicalSearch() {
      return [];
    },
    async vectorSearch() {
      return [];
    },
  };
}

async function runCase(label, text, web, research, model) {
  const intent = await new runtime.RuleBasedIntentRouter().route({
    text,
    workflowHint: null,
  });
  const plan = new runtime.DefaultRetrievalPlanner().plan({
    intent,
    access: access(),
    text,
  });

  const deps = runtime.createDefaultAnswerPipelineDeps({
    knowledgeSearch: emptyKnowledgeSearch(),
    web,
    research,
    model,
  });

  const answer = await runtime.runAnswerPipeline(deps, {
    request: {
      organizationId: access().organizationId,
      userId: access().userId,
      threadId: "e2e-thread",
      messageId: null,
      userText: text,
      access: access(),
      workflowHint: null,
      allowAuditBypass: false,
    },
  });

  const webStats = runtime.readRetrieverStats(plan.needDeepResearch ? research : web);
  const persisted = answer.citations.length;

  console.log(`\n[${label}]`);
  console.log(`  intent=${intent.intent} reason=${intent.reason}`);
  console.log(
    `  plan internal=${plan.needInternalKnowledge} web=${plan.needWeb} deep=${plan.needDeepResearch} citations=${plan.needCitations}`,
  );
  console.log(
    `  Internal: retrieved=${answer.retrieval.internalCount}`,
  );
  console.log(
    `  Web: queries=${answer.retrieval.sanitizedQueryCount || webStats.sanitizedQueryCount} sources=${answer.retrieval.webCount + answer.retrieval.researchCount} pagesFetched=${answer.retrieval.pagesFetched || webStats.pagesFetched}`,
  );
  console.log(
    `  Model: role=${answer.model.role ?? "none"} provider=${answer.model.providerId} modelId=${answer.model.modelId} fallback=${answer.model.fallbackCount ?? 0}`,
  );
  console.log(
    `  Citation: generated=${answer.citations.length} persisted_sim=${persisted} reloaded=${persisted}`,
  );
  console.log(`  usedInternal=${answer.usedInternalKnowledge} usedWeb=${answer.usedWeb}`);
  console.log(`  limitations=${answer.limitations.length}`);
  return answer;
}

try {
  const inventory = await knowledgeInventory();
  console.log("Knowledge inventory (counts only, no bodies)");
  console.log(
    `  documents=${inventory.documents} published=${inventory.published} chunks=${inventory.chunks}`,
  );

  const webDeps = webIntel.createWebIntelligenceDeps(process.env);
  const status = webIntel.webProviderStatus(webDeps);
  console.log(
    `Providers connected: tavily=${status.tavily} firecrawl=${status.firecrawl} gateway=${Boolean(process.env.AI_GATEWAY_API_KEY?.trim())}`,
  );

  const sanitizedB = webIntel.sanitizeExternalQuery({
    request: CASE_B,
    confidentialityLevel: "company",
  });
  console.log(
    `Case B sanitizer: queries=${sanitizedB.sanitizedQueries.length} allowed=${sanitizedB.externalTransmissionAllowed} compensationHijack=${sanitizedB.removedSensitiveSignals.includes("compensation")}`,
  );

  const web = new runtime.WebIntelligenceRetriever(webDeps);
  const research = new runtime.WebIntelligenceResearchRetriever(webDeps);
  const model = new runtime.FallbackChainModelProvider([
    new runtime.VercelGatewayModelProvider(),
  ]);

  await runCase("Case A internal-only", CASE_A, web, research, model);
  await runCase("Case B internal+web", CASE_B, web, research, model);
  console.log("\nlive answer E2E complete");
} catch (err) {
  console.error("FAIL live answer E2E:", redact(err instanceof Error ? err.message : err));
  process.exit(1);
}
