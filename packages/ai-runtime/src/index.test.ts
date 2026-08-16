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

void vi;
