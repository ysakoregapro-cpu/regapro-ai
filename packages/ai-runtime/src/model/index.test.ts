import { describe, expect, it, vi } from "vitest";
import { buildAccessContext } from "@regapro/security";
import { CapabilityModelRouter } from "./router.js";
import { filterOutboundLlmPayload } from "./security-filter.js";
import { VercelGatewayModelProvider } from "./vercel-gateway.js";
import { FallbackChainModelProvider } from "./fallback-chain.js";
import { RuntimeBudgetGuard } from "./budget.js";
import type { ModelGenerateInput, ModelProvider } from "../ports.js";
import type { AIContext } from "../types.js";

function access() {
  return buildAccessContext({
    userId: "user-1",
    organizationId: "org-1",
    membershipId: "mem-1",
    departmentId: "dept-1",
    departmentKey: "sales",
    roles: ["editor"],
    threadConfidentialityLevel: "company",
    threadVisibility: "organization",
  });
}

function emptyContext(): AIContext {
  return {
    items: [],
    ceiling: "company",
    rejectedCount: 0,
    budgetHints: { maxItems: 12, maxChars: 12000 },
  };
}

function baseInput(overrides?: Partial<ModelGenerateInput>): ModelGenerateInput {
  return {
    access: access(),
    userText: "社内の就業規則を教えて",
    context: emptyContext(),
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
    intent: {
      intent: "internal_knowledge",
      confidence: 1,
      reason: "t",
      provider: "rules",
    },
    ...overrides,
  };
}

describe("CapabilityModelRouter", () => {
  const router = new CapabilityModelRouter();

  it("routes code / reasoning / skip-llm by capability signals", () => {
    expect(
      router.route({
        intent: "code",
        text: "TypeScript の型を直して",
        hasInternalEvidence: false,
        hasWebEvidence: false,
      }).role,
    ).toBe("code");

    expect(
      router.route({
        intent: "general",
        text: "通信事業の今期の組織課題を整理して、来期の組織案を3案比較",
        hasInternalEvidence: true,
        hasWebEvidence: true,
      }).role,
    ).toBe("reasoning");

    expect(
      router.route({
        intent: "internal_knowledge",
        text: "就業規則を教えて",
        hasInternalEvidence: true,
        hasWebEvidence: false,
      }).skipLlm,
    ).toBe(true);
  });
});

describe("filterOutboundLlmPayload", () => {
  it("sets ZDR for people/executive and redacts secrets", () => {
    const ctx = buildAccessContext({
      userId: "user-1",
      organizationId: "org-1",
      membershipId: "mem-1",
      departmentId: "dept-1",
      departmentKey: "hr",
      roles: ["admin"],
      threadConfidentialityLevel: "people",
      threadVisibility: "restricted",
    });
    const payload = filterOutboundLlmPayload({
      access: ctx,
      userText: "API key sk-abcdefghijklmnopqrstuvwxyz を確認",
      context: {
        items: [],
        ceiling: "people",
        rejectedCount: 0,
        budgetHints: { maxItems: 8, maxChars: 4000 },
      },
    });
    expect(payload.zeroDataRetention).toBe(true);
    expect(payload.disallowPromptTraining).toBe(true);
    expect(payload.metadataOnlyTrace).toBe(true);
    expect(payload.user).not.toMatch(/sk-abcdefghijklmnopqrstuvwxyz/);
  });

  it("separates internal/web counts and does not invent company facts when empty", () => {
    const payload = filterOutboundLlmPayload({
      access: access(),
      userText: "通信事業の社内状況と外部環境",
      context: emptyContext(),
    });
    expect(payload.user).toMatch(/社内出典: 0件/);
    expect(payload.user).toMatch(/外部出典: 0件/);
    expect(payload.system).toMatch(/一般知識で補完しない/);
    expect(payload.system).toMatch(/固定ラベルを本文に書かない/);
  });
});

describe("VercelGatewayModelProvider", () => {
  it("is disconnected without a key and does not call fetch", async () => {
    const fetchImpl = vi.fn();
    const p = new VercelGatewayModelProvider({
      apiKey: null,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      env: {},
    });
    expect(p.connected).toBe(false);
    await expect(p.generate(baseInput())).rejects.toThrow(/UNCONFIGURED/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sends ZDR on elevated requests and records usage", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        model: "openai/gpt-4.1-mini",
        choices: [{ message: { content: "就業時間は9時です。" } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    }));
    const p = new VercelGatewayModelProvider({
      apiKey: "test-key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      env: {},
    });
    const ctx = buildAccessContext({
      userId: "user-1",
      organizationId: "org-1",
      membershipId: "mem-1",
      departmentId: "dept-1",
      departmentKey: "hr",
      roles: ["admin"],
      threadConfidentialityLevel: "executive",
      threadVisibility: "restricted",
    });
    const out = await p.generate(
      baseInput({
        access: ctx,
        context: { ...emptyContext(), ceiling: "executive" },
        role: "fast",
      }),
    );
    expect(out.connected).toBe(true);
    expect(out.usage?.totalTokens).toBe(15);
    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(body.providerOptions.gateway.zeroDataRetention).toBe(true);
    expect(body.providerOptions.gateway.disallowPromptTraining).toBe(true);
  });
});

describe("FallbackChainModelProvider", () => {
  it("falls through to honest fallback when cloud fails", async () => {
    const failing: ModelProvider = {
      id: "vercel-gateway",
      connected: true,
      async generate() {
        throw new Error("GATEWAY_HTTP_500");
      },
    };
    const chain = new FallbackChainModelProvider([failing]);
    const out = await chain.generate(
      baseInput({
        userText: "議事録の下書きを作って",
        intent: {
          intent: "document",
          confidence: 1,
          reason: "t",
          provider: "rules",
        },
      }),
    );
    expect(out.providerId).toBe("honest-fallback");
    expect((out.fallbackCount ?? 0) > 0).toBe(true);
  });
});

describe("RuntimeBudgetGuard", () => {
  it("caps LLM calls", () => {
    const g = new RuntimeBudgetGuard({
      maxLlmCalls: 2,
      maxTokens: 100,
      maxReasoningRetries: 0,
      timeoutMs: 10_000,
      maxRecursion: 1,
    });
    expect(g.takeLlmCall()).toBe(true);
    expect(g.takeLlmCall()).toBe(true);
    expect(g.takeLlmCall()).toBe(false);
  });
});
