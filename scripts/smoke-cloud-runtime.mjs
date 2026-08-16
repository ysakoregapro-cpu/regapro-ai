#!/usr/bin/env node
/**
 * Explicit live smoke. Does not run in npm test.
 * Flags:
 *   REGAPRO_AI_GATEWAY_SMOKE=1
 *   REGAPRO_WEB_INTELLIGENCE_SMOKE=1
 *   REGAPRO_LANGFUSE_SMOKE=1
 * Never prints secret values.
 */
const flags = {
  gateway: process.env.REGAPRO_AI_GATEWAY_SMOKE === "1",
  web: process.env.REGAPRO_WEB_INTELLIGENCE_SMOKE === "1",
  langfuse: process.env.REGAPRO_LANGFUSE_SMOKE === "1",
};

if (!flags.gateway && !flags.web && !flags.langfuse) {
  console.log("smoke:cloud-runtime skipped (no REGAPRO_*_SMOKE=1 flags)");
  process.exit(0);
}

function present(name) {
  return Boolean(process.env[name]?.trim());
}

function fail(step, err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`FAIL ${step}: ${msg.replace(/sk-[A-Za-z0-9._-]+/g, "[REDACTED]")}`);
  process.exitCode = 1;
}

async function smokeGateway() {
  if (!present("AI_GATEWAY_API_KEY")) {
    throw new Error("AI_GATEWAY_API_KEY missing");
  }
  const base = (process.env.AI_GATEWAY_BASE_URL || "https://ai-gateway.vercel.sh/v1").replace(
    /\/$/,
    "",
  );
  const catalogRes = await fetch(`${base}/models`, {
    headers: { Authorization: `Bearer ${process.env.AI_GATEWAY_API_KEY}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!catalogRes.ok) throw new Error(`MODELS_HTTP_${catalogRes.status}`);
  const catalog = await catalogRes.json();
  const ids = Array.isArray(catalog.data)
    ? catalog.data.map((m) => m.id).filter((id) => typeof id === "string")
    : [];
  const envModel = process.env.REGAPRO_MODEL_FAST?.trim();
  const model =
    (envModel && ids.includes(envModel) ? envModel : null) ||
    ids.find((id) => /gpt-4o-mini|gpt-4\.1-mini|flash-lite|haiku/i.test(id) && !/embed|image|wan-/i.test(id)) ||
    ids.find((id) => !/embed|image|wan-/i.test(id)) ||
    envModel ||
    "openai/gpt-4.1-mini";
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.AI_GATEWAY_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "Reply with the single word: ok" }],
      stream: false,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`HTTP_${res.status}`);
  const json = await res.json();
  const text = json.choices?.[0]?.message?.content ?? "";
  if (!String(text).trim()) throw new Error("empty completion");
  console.log("PASS AI Gateway cheap completion");
}

async function smokeTavily() {
  if (!present("TAVILY_API_KEY")) throw new Error("TAVILY_API_KEY missing");
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: process.env.TAVILY_API_KEY,
      query: "example.com",
      max_results: 1,
      search_depth: "basic",
      include_answer: false,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`HTTP_${res.status}`);
  const json = await res.json();
  if (!Array.isArray(json.results)) throw new Error("unexpected payload");
  console.log(`PASS Tavily query (hits=${json.results.length})`);
}

async function smokeFirecrawl() {
  if (!present("FIRECRAWL_API_KEY")) throw new Error("FIRECRAWL_API_KEY missing");
  const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.FIRECRAWL_API_KEY}`,
    },
    body: JSON.stringify({
      url: "https://example.com",
      formats: ["markdown"],
      onlyMainContent: true,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`HTTP_${res.status}`);
  const json = await res.json();
  if (!json.data?.markdown) throw new Error("no markdown");
  console.log("PASS Firecrawl public page");
}

async function smokeBrowserbase() {
  if (!present("BROWSERBASE_API_KEY") || !present("BROWSERBASE_PROJECT_ID")) {
    throw new Error("BROWSERBASE credentials missing");
  }
  const res = await fetch("https://www.browserbase.com/v1/sessions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-BB-API-Key": process.env.BROWSERBASE_API_KEY,
    },
    body: JSON.stringify({ projectId: process.env.BROWSERBASE_PROJECT_ID }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`HTTP_${res.status}`);
  const session = await res.json();
  if (!session.id) throw new Error("no session id");
  await fetch(`https://www.browserbase.com/v1/sessions/${session.id}`, {
    method: "DELETE",
    headers: { "X-BB-API-Key": process.env.BROWSERBASE_API_KEY },
  }).catch(() => undefined);
  console.log("PASS Browserbase short session");
}

async function smokeLangfuse() {
  if (
    !present("LANGFUSE_PUBLIC_KEY") ||
    !present("LANGFUSE_SECRET_KEY") ||
    !present("LANGFUSE_BASE_URL")
  ) {
    throw new Error("LANGFUSE credentials missing");
  }
  const auth = Buffer.from(
    `${process.env.LANGFUSE_PUBLIC_KEY}:${process.env.LANGFUSE_SECRET_KEY}`,
  ).toString("base64");
  const base = process.env.LANGFUSE_BASE_URL.replace(/\/$/, "");
  const res = await fetch(`${base}/api/public/ingestion`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      batch: [
        {
          id: crypto.randomUUID(),
          type: "trace-create",
          timestamp: new Date().toISOString(),
          body: {
            id: crypto.randomUUID(),
            name: "regapro.smoke",
            metadata: { smoke: true, payloadPolicy: "metadata_only" },
          },
        },
      ],
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`HTTP_${res.status}`);
  console.log("PASS Langfuse metadata-only trace");
}

const jobs = [];
if (flags.gateway) jobs.push(smokeGateway().catch((e) => fail("AI Gateway", e)));
if (flags.web) {
  jobs.push(smokeTavily().catch((e) => fail("Tavily", e)));
  jobs.push(smokeFirecrawl().catch((e) => fail("Firecrawl", e)));
  jobs.push(smokeBrowserbase().catch((e) => fail("Browserbase", e)));
}
if (flags.langfuse) jobs.push(smokeLangfuse().catch((e) => fail("Langfuse", e)));

await Promise.all(jobs);
if (process.exitCode) {
  console.error("live smoke had failures (not hidden)");
  process.exit(process.exitCode);
}
console.log("live smoke complete");
