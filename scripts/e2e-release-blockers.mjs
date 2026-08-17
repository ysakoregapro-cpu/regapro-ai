#!/usr/bin/env node
/**
 * Release-blocker localhost E2E. Does NOT run in `npm test`.
 * Never prints secrets, Knowledge bodies, or raw answers.
 *
 *   node --env-file=apps/web/.env.local scripts/e2e-release-blockers.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";

function present(name) {
  return Boolean(process.env[name]?.trim());
}

function cookieHeader(res) {
  const raw =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : res.headers.get("set-cookie")
        ? [res.headers.get("set-cookie")]
        : [];
  return raw
    .filter(Boolean)
    .map((c) => String(c).split(";")[0])
    .join("; ");
}

function summarizeText(text) {
  const t = String(text ?? "");
  return {
    length: t.length,
    hasKnowledgeUri: /knowledge:\/\//i.test(t),
    hasGroundingFooter: /根拠[:：]/.test(t),
    hasUnconnectedModel: /AI モデル本体が未接続/.test(t),
    hasDemoResearch: /確認用データで調査フロー/.test(t),
    hasConfirmationAsk: /情報区分を人事/.test(t),
    saysUnknown: /確認できない|確認できる.*ありません|捏造/.test(t),
    mentionsRevenue: /売上高/.test(t) && /(?:[0-9,]+(?:億|万)?円|[0-9]+億円)/.test(t),
  };
}

async function jsonFetch(cookie, path, init = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    signal: AbortSignal.timeout(180_000),
  });
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = { parseError: true, status: res.status };
  }
  return { status: res.status, body, cookie: cookieHeader(res) || cookie };
}

async function main() {
  const report = {
    base: BASE,
    keys: {
      AI_GATEWAY_API_KEY: present("AI_GATEWAY_API_KEY"),
      TAVILY_API_KEY: present("TAVILY_API_KEY"),
      FIRECRAWL_API_KEY: present("FIRECRAWL_API_KEY"),
      BROWSERBASE_API_KEY: present("BROWSERBASE_API_KEY"),
      BROWSERBASE_PROJECT_ID: present("BROWSERBASE_PROJECT_ID"),
      REGAPRO_DATA_MODE: process.env.REGAPRO_DATA_MODE || "(unset)",
    },
    cases: {},
  };

  let email = process.env.REGAPRO_E2E_EMAIL?.trim() || process.env.REGAPRO_KNOWLEDGE_IMPORT_EMAIL?.trim();
  let password = process.env.REGAPRO_E2E_PASSWORD || process.env.REGAPRO_KNOWLEDGE_IMPORT_PASSWORD;
  let tempUserId = null;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anon = (
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    ""
  ).trim();
  const secret = (
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    ""
  ).trim();

  if (!email || !password) {
    if (!url || !anon || !secret) {
      console.log(JSON.stringify({ ok: false, error: "missing_auth_env" }, null, 2));
      process.exit(1);
    }
    const admin = createClient(url, secret, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: org } = await admin.from("organizations").select("id").eq("slug", "regapro").maybeSingle();
    if (!org) {
      console.log(JSON.stringify({ ok: false, error: "org_not_found" }, null, 2));
      process.exit(1);
    }
    const { data: dept } = await admin
      .from("departments")
      .select("id")
      .eq("org_id", org.id)
      .eq("key", "sales")
      .maybeSingle();
    const { data: role } = await admin
      .from("roles")
      .select("id")
      .eq("key", "editor")
      .is("org_id", null)
      .maybeSingle();
    email = `e2e.l1.${randomBytes(4).toString("hex")}@example.com`;
    password = `E2e!${randomBytes(12).toString("base64url")}`;
    const created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: "E2E L1" },
    });
    if (created.error || !created.data.user) {
      console.log(JSON.stringify({ ok: false, error: "temp_user_create_failed" }, null, 2));
      process.exit(1);
    }
    tempUserId = created.data.user.id;
    if (!dept?.id) {
      await admin.auth.admin.deleteUser(tempUserId);
      console.log(JSON.stringify({ ok: false, error: "sales_dept_missing" }, null, 2));
      process.exit(1);
    }
    await admin.from("profiles").upsert({ user_id: tempUserId, display_name: "E2E L1" });
    const { data: mem, error: memErr } = await admin
      .from("organization_memberships")
      .insert({ org_id: org.id, user_id: tempUserId, department_id: dept?.id ?? null })
      .select("id")
      .single();
    if (memErr || !mem) {
      await admin.auth.admin.deleteUser(tempUserId);
      console.log(JSON.stringify({ ok: false, error: "temp_membership_failed" }, null, 2));
      process.exit(1);
    }
    if (role?.id) {
      const { error: roleErr } = await admin.from("membership_roles").insert({
        membership_id: mem.id,
        role_id: role.id,
      });
      if (roleErr) {
        await admin.auth.admin.deleteUser(tempUserId);
        console.log(JSON.stringify({ ok: false, error: "temp_role_failed" }, null, 2));
        process.exit(1);
      }
    } else {
      await admin.auth.admin.deleteUser(tempUserId);
      console.log(JSON.stringify({ ok: false, error: "editor_role_missing" }, null, 2));
      process.exit(1);
    }
    report.login = { tempL1Created: true };
  }

  try {
  const login = await jsonFetch("", "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (login.status !== 200 || !login.body?.ok) {
    console.log(
      JSON.stringify(
        {
          ok: false,
          error: "login_failed",
          status: login.status,
          code: login.body?.error ? "auth_error" : login.body?.code,
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }
  const cookie = login.cookie;
  report.login = { ok: true, status: login.status };

  const session = await jsonFetch(cookie, "/api/auth/session");
  report.session = {
    mode: session.body?.mode ?? null,
    hasMembership: Boolean(session.body?.membership),
    selectableLevels: session.body?.membership?.selectableLevels ?? [],
  };

  // 1. L1 internal-only
  const internalQ =
    "Web検索は使わず、公開済みの社内Knowledgeだけを使ってレガプロの有料職業紹介事業の基本業務を整理して";
  const started = await jsonFetch(cookie, "/api/chat/start", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": `e2e-internal-${Date.now()}`,
    },
    body: JSON.stringify({
      content: internalQ,
      requestedLevel: "company",
      confirmRaise: false,
    }),
  });
  const internalThread = started.body?.threadId ?? null;
  let reply = { status: 0, body: {} };
  if (internalThread) {
    reply = await jsonFetch(cookie, `/api/chat/threads/${internalThread}/reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
  }
  const assistant = (reply.body?.messages ?? []).find((m) => m.role === "assistant");
  const citations = assistant?.citations ?? [];
  report.cases.internalOnly = {
    startStatus: started.status,
    startCode: started.body?.code ?? null,
    startOk: started.body?.ok === true,
    confirmation: started.body?.code === "NEEDS_CONFIRMATION",
    threadIdPresent: Boolean(internalThread),
    assistantPresent: Boolean(assistant),
    text: summarizeText(assistant?.content),
    citationCount: citations.length,
    internalCitationCount: citations.filter(
      (c) => c.provenance === "internal" || c.source === "社内情報" || c.source === "knowledge",
    ).length,
    webCitationCount: citations.filter(
      (c) => c.provenance === "web" || c.source === "web" || c.source === "外部情報",
    ).length,
    model: reply.body?.runtime ?? null,
  };

  // 2. Unknown knowledge
  const unknown = await jsonFetch(cookie, "/api/chat/start", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": `e2e-unknown-${Date.now()}`,
    },
    body: JSON.stringify({
      content: "2026年度の確定売上高と営業利益を教えて",
      requestedLevel: "company",
    }),
  });
  let unknownReply = { body: {} };
  if (unknown.body?.threadId) {
    unknownReply = await jsonFetch(
      cookie,
      `/api/chat/threads/${unknown.body.threadId}/reply`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
    );
  }
  const unknownAsst = (unknownReply.body?.messages ?? []).find((m) => m.role === "assistant");
  report.cases.unknownKnowledge = {
    startOk: unknown.body?.ok === true,
    text: summarizeText(unknownAsst?.content),
  };

  // 3. Hybrid
  const hybridQ =
    "レガプロ通信事業の内部状況を社内Knowledge、現在の通信市場をWebで調査して比較";
  const hybrid = await jsonFetch(cookie, "/api/chat/start", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": `e2e-hybrid-${Date.now()}`,
    },
    body: JSON.stringify({
      content: hybridQ,
      requestedLevel: "company",
    }),
  });
  let hybridReply = { body: {} };
  if (hybrid.body?.threadId) {
    hybridReply = await jsonFetch(
      cookie,
      `/api/chat/threads/${hybrid.body.threadId}/reply`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
    );
  }
  const hybridAsst = (hybridReply.body?.messages ?? []).find((m) => m.role === "assistant");
  const hybridCites = hybridAsst?.citations ?? [];
  report.cases.hybrid = {
    startOk: hybrid.body?.ok === true,
    text: summarizeText(hybridAsst?.content),
    citationCount: hybridCites.length,
    internalCitationCount: hybridCites.filter(
      (c) => c.provenance === "internal" || c.source === "社内情報",
    ).length,
    webCitationCount: hybridCites.filter(
      (c) =>
        c.provenance === "web" ||
        (typeof c.uri === "string" && c.uri.startsWith("http")),
    ).length,
    runtime: hybridReply.body?.runtime ?? hybrid.body?.runtime ?? null,
  };

  // 4. New chat (blank general)
  const a = await jsonFetch(cookie, "/api/chat/workflow", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": `e2e-blank-a-${Date.now()}`,
    },
    body: JSON.stringify({ workflowType: "general" }),
  });
  const b = await jsonFetch(cookie, "/api/chat/workflow", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": `e2e-blank-b-${Date.now()}`,
    },
    body: JSON.stringify({ workflowType: "general" }),
  });
  let bBundle = { body: {} };
  if (b.body?.threadId) {
    bBundle = await jsonFetch(cookie, `/api/chat/threads/${b.body.threadId}`);
  }
  report.cases.newChat = {
    aOk: a.body?.ok === true,
    bOk: b.body?.ok === true,
    distinct: a.body?.threadId && b.body?.threadId && a.body.threadId !== b.body.threadId,
    bMessageCount: (bBundle.body?.messages ?? []).length,
    bRedirectHasThread: String(b.body?.redirectTo ?? "").includes("thread="),
  };

  // 5. Detailed research
  const research = await jsonFetch(cookie, "/api/chat/workflow", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": `e2e-research-${Date.now()}`,
    },
    body: JSON.stringify({
      workflowType: "research",
      initialMessage: "日本の通信市場の直近動向を公開情報で整理して",
    }),
  });
  let researchList = { body: {} };
  if (research.body?.threadId) {
    researchList = await jsonFetch(
      cookie,
      `/api/research?threadId=${research.body.threadId}`,
    );
  }
  const run = (researchList.body?.runs ?? []).at(-1) ?? null;
  let researchThread = { body: {} };
  if (research.body?.threadId) {
    researchThread = await jsonFetch(cookie, `/api/chat/threads/${research.body.threadId}`);
  }
  const researchAsst = (researchThread.body?.messages ?? []).find((m) => m.role === "assistant");
  const meta = run?.processingMetadata ?? {};
  report.cases.detailedResearch = {
    startOk: research.body?.ok === true,
    isDemo: run?.isDemo === true,
    status: run?.status ?? null,
    provider: run?.provider ?? null,
    sourceCount: run?.citations?.length ?? run?.sources?.length ?? 0,
    tavilyQueryCount: Number(meta.queriesUsed ?? 0),
    firecrawlPageCount: Number(meta.pagesFetched ?? 0),
    browserSessions: Number(meta.browserSessions ?? 0),
    hasDemoNotice: summarizeText(researchAsst?.content).hasDemoResearch,
    errorCode: run?.errorCode ?? null,
    tavilyPresent: present("TAVILY_API_KEY"),
    firecrawlPresent: present("FIRECRAWL_API_KEY"),
    runtime: research.body?.runtime ?? null,
  };

  // 6. Reload persistence
  let reload = { body: {} };
  if (internalThread) {
    reload = await jsonFetch(cookie, `/api/chat/threads/${internalThread}`);
  }
  const reloadMsgs = reload.body?.messages ?? [];
  const reloadAsst = [...reloadMsgs].reverse().find((m) => m.role === "assistant");
  report.cases.reload = {
    messageCount: reloadMsgs.length,
    assistantPresent: Boolean(reloadAsst),
    citationCount: reloadAsst?.citations?.length ?? 0,
    hasKnowledgeUriInBody: /knowledge:\/\//i.test(reloadAsst?.content ?? ""),
  };

  console.log(JSON.stringify(report, null, 2));
  } finally {
    if (tempUserId && secret && url) {
      const admin = createClient(url, secret, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      await admin.from("membership_roles").delete().in(
        "membership_id",
        (
          await admin
            .from("organization_memberships")
            .select("id")
            .eq("user_id", tempUserId)
        ).data?.map((r) => r.id) ?? [],
      );
      await admin.from("organization_memberships").delete().eq("user_id", tempUserId);
      await admin.from("profiles").delete().eq("user_id", tempUserId);
      await admin.auth.admin.deleteUser(tempUserId);
    }
  }
}

main().catch((err) => {
  console.log(
    JSON.stringify(
      { ok: false, error: "e2e_exception", name: err?.name, message: String(err?.message ?? err).slice(0, 200) },
      null,
      2,
    ),
  );
  process.exit(1);
});
