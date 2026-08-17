import { describe, expect, it, vi } from "vitest";
import { buildAccessContext } from "@regapro/security";
import {
  BasicInternalKnowledgeRetriever,
  DisconnectedWebRetriever,
  HybridInternalKnowledgeRetriever,
  RuleBasedIntentRouter,
  DefaultRetrievalPlanner,
  createDefaultAnswerPipelineDeps,
  runAnswerPipeline,
  FallbackChainModelProvider,
  sanitizeVisibleAnswerText,
  type KnowledgeSearchPort,
} from "./index.js";
import { DisconnectedEmbeddingProvider } from "@regapro/knowledge";

function access(overrides?: Partial<Parameters<typeof buildAccessContext>[0]>) {
  return buildAccessContext({
    userId: "user-1",
    organizationId: "org-1",
    membershipId: "mem-1",
    departmentId: "dept-1",
    departmentKey: "sales",
    roles: ["editor"],
    threadConfidentialityLevel: "company",
    threadVisibility: "organization",
    ...overrides,
  });
}

describe("RuleBasedIntentRouter", () => {
  const router = new RuleBasedIntentRouter();

  it("routes workflow hints first", async () => {
    const d = await router.route({ text: "調べて", workflowHint: "task" });
    expect(d.intent).toBe("task");
  });

  it("does not lock routing on general workflow hint", async () => {
    const d = await router.route({
      text: "展示会を調べて",
      workflowHint: "general",
    });
    expect(d.intent).toBe("web_search");
  });

  it("detects web / knowledge / task / document", async () => {
    expect((await router.route({ text: "展示会を調べて" })).intent).toBe(
      "web_search",
    );
    expect((await router.route({ text: "社内マニュアルを確認" })).intent).toBe(
      "internal_knowledge",
    );
    expect((await router.route({ text: "タスクにして" })).intent).toBe("task");
    expect((await router.route({ text: "議事録を作成" })).intent).toBe("document");
  });

  it("does not route internal-only recruitment questions to web search", async () => {
    const text =
      "Web検索は使わず、公開済みの社内Knowledgeだけを使ってレガプロの有料職業紹介事業の基本業務を整理して";
    const d = await router.route({ text });
    expect(d.intent).toBe("internal_knowledge");
    const plan = new DefaultRetrievalPlanner().plan({
      intent: d,
      access: access(),
      text,
    });
    expect(plan.needWeb).toBe(false);
    expect(plan.needDeepResearch).toBe(false);
    expect(plan.needInternalKnowledge).toBe(true);
  });
});

describe("sanitizeVisibleAnswerText", () => {
  it("strips knowledge URIs and duplicated 根拠 footers", () => {
    const raw =
      "基本業務は許可取得です（根拠：『有料職業紹介』 knowledge://document/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/chunk/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb）\n根拠：同じ内容";
    const cleaned = sanitizeVisibleAnswerText(raw);
    expect(cleaned).not.toMatch(/knowledge:\/\//);
    expect(cleaned).not.toMatch(/根拠/);
    expect(cleaned).toMatch(/基本業務は許可取得です/);
  });
});

describe("DefaultRetrievalPlanner", () => {
  const planner = new DefaultRetrievalPlanner();

  it("never includes private conversations or audit cases", () => {
    const plan = planner.plan({
      intent: {
        intent: "deep_research",
        confidence: 1,
        reason: "t",
        provider: "rules",
      },
      access: access(),
    });
    expect(plan.includePrivateConversations).toBe(false);
    expect(plan.includeAuditCases).toBe(false);
    expect(plan.needWeb).toBe(true);
    expect(plan.needDeepResearch).toBe(true);
    expect(plan.needInternalKnowledge).toBe(true);
  });

  it("pairs web search with internal knowledge", () => {
    const plan = planner.plan({
      intent: {
        intent: "web_search",
        confidence: 1,
        reason: "t",
        provider: "rules",
      },
      access: access(),
      text: "通信市場の最新動向を調べて",
    });
    expect(plan.needWeb).toBe(true);
    expect(plan.needInternalKnowledge).toBe(true);
    expect(plan.includePrivateConversations).toBe(false);
  });

  it("attaches department domains and historical flag", () => {
    const current = planner.plan({
      intent: {
        intent: "internal_knowledge",
        confidence: 1,
        reason: "t",
        provider: "rules",
      },
      access: access(),
      text: "社内の許可状況を確認",
    });
    expect(current.preferredDomainKeys).toContain("sales");
    expect(current.includeHistoricalKnowledge).toBe(false);

    const past = planner.plan({
      intent: {
        intent: "internal_knowledge",
        confidence: 1,
        reason: "t",
        provider: "rules",
      },
      access: access(),
      text: "当時の許可状況は",
    });
    expect(past.includeHistoricalKnowledge).toBe(true);
  });
});

describe("security-aware retrieval", () => {
  it("requires AccessContext", async () => {
    const retriever = new BasicInternalKnowledgeRetriever(async () => []);
    await expect(
      retriever.retrieve({
        access: null as never,
        plan: {
          intent: "general",
          needInternalKnowledge: true,
          needWeb: false,
          needDeepResearch: false,
          needProjectContext: false,
          needDepartmentContext: false,
          needCitations: false,
          needToolExecution: false,
          includePrivateConversations: false,
          includeAuditCases: false,
        },
        query: "x",
      }),
    ).rejects.toThrow(/ACCESS_CONTEXT_REQUIRED/);
  });

  it("denies unauthorized high-clearance knowledge", async () => {
    const retriever = new BasicInternalKnowledgeRetriever(async () => [
      {
        id: "k1",
        title: "給与",
        body: "機密給与情報",
        confidentialityLevel: "executive",
        visibility: "organization",
        ownerUserId: "hr",
        published: true,
      },
      {
        id: "k2",
        title: "一般",
        body: "一般業務",
        confidentialityLevel: "company",
        visibility: "organization",
        ownerUserId: "sys",
        published: true,
      },
    ]);
    const items = await retriever.retrieve({
      access: access(),
      plan: {
        intent: "internal_knowledge",
        needInternalKnowledge: true,
        needWeb: false,
        needDeepResearch: false,
        needProjectContext: false,
        needDepartmentContext: false,
        needCitations: true,
        needToolExecution: false,
        includePrivateConversations: false,
        includeAuditCases: false,
      },
      query: "一般",
    });
    expect(items.every((i) => i.confidentialityLevel !== "executive")).toBe(
      true,
    );
  });

  it("excludes unpublished and private", async () => {
    const retriever = new BasicInternalKnowledgeRetriever(async () => [
      {
        id: "draft",
        title: "下書き",
        body: "下書き本文",
        confidentialityLevel: "company",
        visibility: "organization",
        ownerUserId: "sys",
        published: false,
      },
      {
        id: "priv",
        title: "個人メモ",
        body: "private",
        confidentialityLevel: "company",
        visibility: "private",
        ownerUserId: "sys",
        published: true,
      },
    ]);
    const items = await retriever.retrieve({
      access: access(),
      plan: {
        intent: "internal_knowledge",
        needInternalKnowledge: true,
        needWeb: false,
        needDeepResearch: false,
        needProjectContext: false,
        needDepartmentContext: false,
        needCitations: true,
        needToolExecution: false,
        includePrivateConversations: false,
        includeAuditCases: false,
      },
      query: "メモ",
    });
    expect(items).toEqual([]);
  });

  it("never returns audit mixes", async () => {
    const retriever = new BasicInternalKnowledgeRetriever(async () => [
      {
        id: "k",
        title: "x",
        body: "y",
        confidentialityLevel: "company",
        visibility: "organization",
        ownerUserId: "sys",
        published: true,
      },
    ]);
    const items = await retriever.retrieve({
      access: access({ auditMode: true, auditCaseId: "c1" }),
      plan: {
        intent: "internal_knowledge",
        needInternalKnowledge: true,
        needWeb: false,
        needDeepResearch: false,
        needProjectContext: false,
        needDepartmentContext: false,
        needCitations: true,
        needToolExecution: false,
        includePrivateConversations: false,
        includeAuditCases: false,
      },
      query: "x",
    });
    expect(items).toEqual([]);
  });

  it("disconnected web returns empty", async () => {
    const web = new DisconnectedWebRetriever();
    const items = await web.retrieve({
      access: access(),
      plan: {
        intent: "web_search",
        needInternalKnowledge: false,
        needWeb: true,
        needDeepResearch: false,
        needProjectContext: false,
        needDepartmentContext: false,
        needCitations: true,
        needToolExecution: false,
        includePrivateConversations: false,
        includeAuditCases: false,
      },
      query: "anything",
    });
    expect(web.connected).toBe(false);
    expect(items).toEqual([]);
  });
});

describe("HybridInternalKnowledgeRetriever", () => {
  const plan = {
    intent: "internal_knowledge" as const,
    needInternalKnowledge: true,
    needWeb: false,
    needDeepResearch: false,
    needProjectContext: false,
    needDepartmentContext: false,
    needCitations: true,
    needToolExecution: false,
    includePrivateConversations: false as const,
    includeAuditCases: false as const,
  };

  it("uses lexical-only when embedding disconnected (honest fallback)", async () => {
    let vectorCalled = false;
    const search: KnowledgeSearchPort = {
      async lexicalSearch() {
        return [
          {
            chunkId: "c1",
            documentId: "d1",
            documentTitle: "就業規則",
            content: "就業時間は9時",
            confidentialityLevel: 1,
            visibility: "organization",
            ownerUserId: null,
            projectId: null,
            departmentId: null,
            sourceType: "manual",
            updatedAt: "2026-08-01T00:00:00.000Z",
            rank: 1,
            score: 0.5,
          },
        ];
      },
      async vectorSearch() {
        vectorCalled = true;
        return [];
      },
    };
    const retriever = new HybridInternalKnowledgeRetriever(
      search,
      new DisconnectedEmbeddingProvider(),
    );
    const items = await retriever.retrieve({
      access: access(),
      plan,
      query: "就業",
    });
    expect(vectorCalled).toBe(false);
    expect(items).toHaveLength(1);
    expect(items[0]?.sourceType).toBe("knowledge_chunk");
  });

  it("prefers current knowledge over historical unless the plan asks for history", async () => {
    const search: KnowledgeSearchPort = {
      async lexicalSearch() {
        return [
          {
            chunkId: "old",
            documentId: "d-old",
            documentTitle: "許可",
            content: "許可取得準備中",
            confidentialityLevel: 1,
            visibility: "organization",
            ownerUserId: null,
            projectId: null,
            departmentId: null,
            sourceType: "manual",
            updatedAt: "2026-04-01T00:00:00.000Z",
            rank: 1,
            score: 0.9,
            isCurrent: false,
            factStatus: "historical",
          },
          {
            chunkId: "now",
            documentId: "d-now",
            documentTitle: "許可",
            content: "許可取得済み",
            confidentialityLevel: 1,
            visibility: "organization",
            ownerUserId: null,
            projectId: null,
            departmentId: null,
            sourceType: "manual",
            updatedAt: "2026-08-01T00:00:00.000Z",
            rank: 2,
            score: 0.8,
            isCurrent: true,
            factStatus: "fact",
          },
        ];
      },
      async vectorSearch() {
        return [];
      },
    };
    const retriever = new HybridInternalKnowledgeRetriever(
      search,
      new DisconnectedEmbeddingProvider(),
    );
    const current = await retriever.retrieve({
      access: access(),
      plan,
      query: "許可の状況",
    });
    expect(current.map((i) => i.id)).toEqual(["now"]);

    const historical = await retriever.retrieve({
      access: access(),
      plan: { ...plan, includeHistoricalKnowledge: true },
      query: "当時の許可状況",
    });
    expect(historical.map((i) => i.id).sort()).toEqual(["now", "old"]);
  });

  it("fuses lexical and vector ranks when embedding available", async () => {
    const search: KnowledgeSearchPort = {
      async lexicalSearch() {
        return [
          {
            chunkId: "a",
            documentId: "d1",
            documentTitle: "A",
            content: "alpha",
            confidentialityLevel: 1,
            visibility: "organization",
            ownerUserId: null,
            projectId: null,
            departmentId: null,
            sourceType: "manual",
            updatedAt: null,
            rank: 1,
            score: 0.9,
          },
          {
            chunkId: "b",
            documentId: "d2",
            documentTitle: "B",
            content: "beta",
            confidentialityLevel: 1,
            visibility: "organization",
            ownerUserId: null,
            projectId: null,
            departmentId: null,
            sourceType: "manual",
            updatedAt: null,
            rank: 2,
            score: 0.4,
          },
        ];
      },
      async vectorSearch() {
        return [
          {
            chunkId: "b",
            documentId: "d2",
            documentTitle: "B",
            content: "beta",
            confidentialityLevel: 1,
            visibility: "organization",
            ownerUserId: null,
            projectId: null,
            departmentId: null,
            sourceType: "manual",
            updatedAt: null,
            rank: 1,
            score: 0.99,
          },
        ];
      },
    };
    const embedding = {
      id: "test-embed",
      available: true,
      dimensions: 384,
      async embedDocuments() {
        return [];
      },
      async embedQuery() {
        return {
          values: Array.from({ length: 384 }, (_, i) => (i === 0 ? 1 : 0)),
          modelId: "test",
          modelVersion: "0",
          dimensions: 384,
        };
      },
    };
    const retriever = new HybridInternalKnowledgeRetriever(search, embedding);
    const items = await retriever.retrieve({
      access: access(),
      plan,
      query: "q",
    });
    expect(items[0]?.id).toBe("b");
  });
});

describe("runAnswerPipeline", () => {
  it("produces honest answer with citations structure and persistence fields", async () => {
    const traces: unknown[] = [];
    const deps = createDefaultAnswerPipelineDeps({
      loadKnowledge: async () => [
        {
          id: "k-open",
          title: "就業規則概要",
          body: "就業時間は9時からです",
          confidentialityLevel: "company",
          visibility: "organization",
          ownerUserId: "sys",
          published: true,
        },
      ],
      onTrace: (t) => traces.push(t),
    });

    const answer = await runAnswerPipeline(deps, {
      request: {
        organizationId: "org-1",
        userId: "user-1",
        threadId: "th-1",
        messageId: "m-1",
        userText: "社内の就業規則を教えて",
        access: access(),
        workflowHint: null,
        allowAuditBypass: false,
      },
    });

    expect(answer.text).not.toMatch(/調べました|検索しました/);
    expect(answer.model.connected).toBe(false);
    expect(answer.retrievalPlan.includePrivateConversations).toBe(false);
    expect(answer.intent.intent).toBe("internal_knowledge");
    expect(answer.usedWeb).toBe(false);
    expect(answer.generatedAt).toBeTruthy();
    expect(traces.length).toBe(1);
  });

  it("rejects audit mode", async () => {
    const deps = createDefaultAnswerPipelineDeps();
    await expect(
      runAnswerPipeline(deps, {
        request: {
          organizationId: "org-1",
          userId: "user-1",
          threadId: "th-1",
          messageId: null,
          userText: "hello",
          access: access({ auditMode: true, auditCaseId: "case-1" }),
          allowAuditBypass: false,
        },
      }),
    ).rejects.toThrow(/AUDIT/);
  });

  it("does not invent web results when web is requested", async () => {
    const deps = createDefaultAnswerPipelineDeps();
    const answer = await runAnswerPipeline(deps, {
      request: {
        organizationId: "org-1",
        userId: "user-1",
        threadId: "th-1",
        messageId: null,
        userText: "最新の展示会情報を調べて",
        access: access(),
        allowAuditBypass: false,
      },
    });
    expect(answer.usedWeb).toBe(false);
    expect(answer.citations.every((c) => c.sourceType !== "web")).toBe(true);
    expect(answer.limitations.some((l) => /Web検索/.test(l))).toBe(true);
  });
});

describe("AccessContext required at pipeline boundary", () => {
  it("fails closed without access", async () => {
    const deps = createDefaultAnswerPipelineDeps();
    await expect(
      runAnswerPipeline(deps, {
        request: {
          organizationId: "org-1",
          userId: "user-1",
          threadId: "th-1",
          messageId: null,
          userText: "hi",
          access: undefined as never,
          allowAuditBypass: false,
        },
      }),
    ).rejects.toThrow(/ACCESS_CONTEXT/);
  });
});

describe("live E2E fixtures (mocked providers, no external APIs)", () => {
  const CASE_A =
    "レガプロで有料職業紹介事業を進める上で、現在把握している主な取り組みを整理して";
  const CASE_B =
    "レガプロの通信事業について、現在把握している社内状況と現在の通信販売・人材市場の外部環境を分けて調査し、来期に向けた組織上の課題と改善案を3案比較して。外部情報には根拠を付けて。";

  const echoingModel = {
    id: "rules-template" as const,
    connected: true,
    async generate(input: {
      context: { items: { source: string; sourceType: string }[] };
    }) {
      return {
        text: input.context.items.map((i) => i.source).join(" / ") || "確認できる情報がない",
        confidence: 0.8,
        providerId: "rules-template" as const,
        modelId: "test-model",
        connected: true,
        limitations: [],
      };
    },
  };

  it("Case A: internal-only request does not call web and persists citations", async () => {
    const router = new RuleBasedIntentRouter();
    const planner = new DefaultRetrievalPlanner();
    const intent = await router.route({ text: CASE_A, workflowHint: "general" });
    expect(intent.intent).toBe("internal_knowledge");
    const plan = planner.plan({ intent, access: access(), text: CASE_A });
    expect(plan.needWeb).toBe(false);
    expect(plan.needInternalKnowledge).toBe(true);
    expect(plan.needCitations).toBe(true);

    let webCalls = 0;
    const deps = createDefaultAnswerPipelineDeps({
      loadKnowledge: async () => [
        {
          id: "k-intro",
          title: "有料職業紹介の社内メモ",
          body: "公開済みの取り組みメモ",
          confidentialityLevel: "company",
          visibility: "organization",
          ownerUserId: "sys",
          published: true,
        },
      ],
      web: {
        id: "web-spy",
        connected: true,
        async retrieve() {
          webCalls += 1;
          return [];
        },
      },
      model: echoingModel,
    });

    const answer = await runAnswerPipeline(deps, {
      request: {
        organizationId: "org-1",
        userId: "user-1",
        threadId: "th-a",
        messageId: "m-a",
        userText: CASE_A,
        access: access(),
        workflowHint: "general",
        allowAuditBypass: false,
      },
    });

    expect(webCalls).toBe(0);
    expect(answer.retrieval.internalCount).toBeGreaterThan(0);
    expect(answer.citations.length).toBeGreaterThan(0);
    expect(answer.citations.every((c) => c.provenance === "internal")).toBe(true);
    const reloaded = answer.citations.map((c) => ({ id: c.id, title: c.title }));
    expect(reloaded.length).toBe(answer.citations.length);
  });

  it("Case B: internal + current web research keeps both provenances", async () => {
    const router = new RuleBasedIntentRouter();
    const planner = new DefaultRetrievalPlanner();
    const intent = await router.route({ text: CASE_B });
    expect(intent.intent).toBe("deep_research");
    const plan = planner.plan({ intent, access: access(), text: CASE_B });
    expect(plan.needInternalKnowledge).toBe(true);
    expect(plan.needWeb).toBe(true);
    expect(plan.needDeepResearch).toBe(true);
    expect(plan.needCitations).toBe(true);

    let webSearchExecuted = 0;
    const deps = createDefaultAnswerPipelineDeps({
      loadKnowledge: async () => [
        {
          id: "k-tel",
          title: "通信事業の社内状況",
          body: "社内で把握している通信事業メモ",
          confidentialityLevel: "company",
          visibility: "organization",
          ownerUserId: "sys",
          published: true,
        },
      ],
      web: {
        id: "web-spy",
        connected: true,
        async retrieve() {
          throw new Error("shallow web must not run when deep research is on");
        },
      },
      research: {
        id: "research-spy",
        connected: true,
        async retrieve() {
          webSearchExecuted += 1;
          return [
            {
              id: "w1",
              title: "公開市場レポート",
              content: "通信販売市場の公開動向",
              sourceType: "research" as const,
              sourceId: "w1",
              sourceUri: "https://example.com/market",
              confidentialityLevel: "company" as const,
              visibility: "organization" as const,
              relevance: 0.9,
              freshness: "2026-08-01T00:00:00.000Z",
              excerpt: "公開動向",
              domain: "example.com",
              retrievedAt: "2026-08-16T00:00:00.000Z",
              publishedAt: null,
            },
          ];
        },
      },
      model: echoingModel,
    });

    const answer = await runAnswerPipeline(deps, {
      request: {
        organizationId: "org-1",
        userId: "user-1",
        threadId: "th-b",
        messageId: "m-b",
        userText: CASE_B,
        access: access(),
        workflowHint: null,
        allowAuditBypass: false,
      },
    });

    expect(webSearchExecuted).toBe(1);
    expect(answer.retrieval.internalCount).toBeGreaterThan(0);
    expect(answer.retrieval.researchCount).toBeGreaterThan(0);
    expect(answer.retrieval.contextCount).toBeGreaterThan(1);
    expect(answer.citations.length).toBeGreaterThan(0);
    expect(answer.citations.some((c) => c.provenance === "internal")).toBe(true);
    expect(answer.citations.some((c) => c.provenance === "web")).toBe(true);
    expect(answer.usedInternalKnowledge).toBe(true);
    expect(answer.usedWeb).toBe(true);
  });

  it("does not mix sample catalog when internal retrieval is empty", async () => {
    const deps = createDefaultAnswerPipelineDeps({
      model: echoingModel,
    });
    const answer = await runAnswerPipeline(deps, {
      request: {
        organizationId: "org-1",
        userId: "user-1",
        threadId: "th-empty",
        messageId: null,
        userText: CASE_A,
        access: access(),
        allowAuditBypass: false,
      },
    });
    expect(answer.usedInternalKnowledge).toBe(false);
    expect(answer.citations).toEqual([]);
    expect(answer.text).not.toMatch(/求人票作成の標準手順/);
  });

  it("skips the LLM for internal-only requests with zero evidence", async () => {
    let called = false;
    const failing = {
      id: "vercel-gateway" as const,
      connected: true,
      async generate() {
        called = true;
        throw new Error("GATEWAY_HTTP_500");
      },
    };
    const deps = createDefaultAnswerPipelineDeps({
      model: new FallbackChainModelProvider([failing]),
    });
    const answer = await runAnswerPipeline(deps, {
      request: {
        organizationId: "org-1",
        userId: "user-1",
        threadId: "th-zero",
        messageId: null,
        userText: CASE_A,
        access: access(),
        allowAuditBypass: false,
      },
    });
    expect(called).toBe(false);
    expect(answer.model.providerId).toBe("rules-template");
    expect(answer.text).toMatch(/確認できる社内Knowledgeがありません/);
    expect(answer.text).not.toMatch(/求人票作成の標準手順/);
  });

  it("falls to honest fallback, never sample catalog, on provider failure", async () => {
    const failing = {
      id: "vercel-gateway" as const,
      connected: true,
      async generate() {
        throw new Error("GATEWAY_HTTP_500");
      },
    };
    const deps = createDefaultAnswerPipelineDeps({
      model: new FallbackChainModelProvider([failing]),
    });
    const answer = await runAnswerPipeline(deps, {
      request: {
        organizationId: "org-1",
        userId: "user-1",
        threadId: "th-fail",
        messageId: null,
        userText: CASE_B,
        access: access(),
        allowAuditBypass: false,
      },
    });
    expect(answer.model.providerId).toBe("honest-fallback");
    expect(answer.text).not.toMatch(/求人票作成の標準手順/);
    expect(answer.text).not.toMatch(/候補A：現場経験/);
  });
});

void vi;
