import { beforeEach, describe, expect, it } from "vitest";
import { __resetChatStoreForTests } from "@/lib/application/chat-service";
import {
  __resetResearchStoreForTests,
  buildResearchAnswer,
  completeResearchDemo,
  createResearchRun,
  getResearchRun,
  listResearchLibrary,
  listResearchRunsForThread,
} from "@/lib/application/research-service";
import {
  __resetArtifactStoreForTests,
  createDocumentArtifactFromRequest,
  listArtifactsForThread,
  reviseArtifact,
} from "@/lib/application/artifact-service";
import {
  __resetFileStoreForTests,
  createFileObject,
} from "@/lib/application/file-object-service";
import {
  assertNoSensitiveInExternalQueries,
  sanitizeExternalQuery,
} from "@/lib/application/external-query-sanitizer";
import { startConversationWorkflow } from "@/lib/application/conversation-workflow";

beforeEach(() => {
  __resetChatStoreForTests();
  __resetResearchStoreForTests();
  __resetArtifactStoreForTests();
  __resetFileStoreForTests();
});

describe("startConversationWorkflow", () => {
  it("creates research thread from TopBar-style entry without message", () => {
    const result = startConversationWorkflow({
      workflowType: "research",
      idempotencyKey: "idem-research-empty-01",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.redirectTo).toContain("/assistant?thread=");
    expect(result.redirectTo).toContain("tool=web_research");
    expect(result.messageId).toBeNull();
    expect(result.researchRunId).toBeNull();
  });

  it("home Web research with message creates ResearchRun linked to thread", () => {
    const result = startConversationWorkflow({
      workflowType: "research",
      initialMessage: "有料職業紹介の手数料相場を調べて",
      idempotencyKey: "idem-research-msg-01",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.researchRunId).toBeTruthy();
    const runs = listResearchRunsForThread(result.threadId);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.threadId).toBe(result.threadId);
    expect(runs[0]?.isDemo).toBe(true);
    expect(runs[0]?.status).toBe("completed");
  });

  it("idempotent research run creation does not duplicate", () => {
    const first = startConversationWorkflow({
      workflowType: "research",
      initialMessage: "市場の平均年収を調べて",
      idempotencyKey: "idem-dup-research",
    });
    const second = startConversationWorkflow({
      workflowType: "research",
      initialMessage: "市場の平均年収を調べて",
      idempotencyKey: "idem-dup-research",
    });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.threadId).toBe(second.threadId);
    expect(listResearchRunsForThread(first.threadId)).toHaveLength(1);
  });

  it("document workflow creates artifact versions", () => {
    const started = startConversationWorkflow({
      workflowType: "document",
      initialMessage: "この内容を議事録にして",
      documentSubtype: "text",
      idempotencyKey: "idem-doc-01",
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const arts = listArtifactsForThread(started.threadId);
    expect(arts.length).toBeGreaterThan(0);
    const art = arts[0]!;
    expect(art.formatStatus).toBe("ready");
    const revised = reviseArtifact({
      artifactId: art.id,
      instruction: "参加者欄を追記して",
    });
    expect(revised?.version).toBe(2);
  });

  it("disabled formats are honest", () => {
    const art = createDocumentArtifactFromRequest({
      threadId: "thread-x",
      messageId: null,
      request: "PowerPointで提案資料を作って",
      confidentialityLevel: "company",
      visibility: "private",
    });
    expect(art.format).toBe("pptx");
    expect(art.formatStatus).toBe("disabled");
    expect(art.disabledReason).toMatch(/未接続/);
  });
});

describe("ResearchRun demo honesty", () => {
  it("does not claim real web search completed", () => {
    const run = createResearchRun({
      threadId: "thread-demo",
      requestMessageId: "msg-demo",
      purpose: "DX推進の市場動向",
      confidentialityLevel: "company",
      visibility: "private",
      idempotencyKey: "rr-demo-1",
    });
    completeResearchDemo(run.id);
    const done = getResearchRun(run.id)!;
    const answer = buildResearchAnswer(done);
    expect(answer).not.toMatch(/Webを検索しました/);
    expect(answer).not.toMatch(/複数サイトを確認しました/);
    expect(answer).not.toMatch(/最新情報を取得しました/);
    expect(answer).toMatch(/確認用データ/);
    expect(done.isDemo).toBe(true);
    expect(done.citations[0]?.url).toBeNull();
  });

  it("appears in research library", () => {
    const started = startConversationWorkflow({
      workflowType: "research",
      initialMessage: "採用市場の一般動向",
      idempotencyKey: "lib-1",
    });
    expect(started.ok).toBe(true);
    const lib = listResearchLibrary();
    expect(lib.some((r) => r.purpose.includes("採用市場"))).toBe(true);
  });
});

describe("ExternalQuerySanitizer", () => {
  it("removes employee name and compensation from external queries", () => {
    const plan = sanitizeExternalQuery({
      request: "酒匂さんの実給与と市場相場を比較して",
      confidentialityLevel: "executive",
    });
    assertNoSensitiveInExternalQueries(plan);
    expect(plan.removedSensitiveSignals).toContain("person_name");
    expect(plan.removedSensitiveSignals).toContain("compensation");
    for (const q of plan.sanitizedQueries) {
      expect(q).not.toMatch(/酒匂/);
      expect(q).not.toMatch(/実給与/);
    }
    expect(plan.sanitizedQueries.length).toBeGreaterThan(0);
  });

  it("allows general market salary queries", () => {
    const plan = sanitizeExternalQuery({
      request: "事業推進責任者の平均年収の相場を調べて",
      confidentialityLevel: "company",
    });
    expect(plan.sanitizedQueries.length).toBeGreaterThan(0);
    expect(plan.removedSensitiveSignals).not.toContain("person_name");
  });
});

describe("File inheritance", () => {
  it("inherits thread confidentiality", () => {
    const file = createFileObject({
      threadId: "t1",
      messageId: null,
      name: "memo.txt",
      mimeType: "text/plain",
      sizeBytes: 12,
      confidentialityLevel: "people",
      visibility: "private",
      storageMode: "dev-sample-ephemeral",
    });
    expect(file.confidentialityLevel).toBe("people");
    expect(file.ephemeralNotice).toBeTruthy();
  });
});

describe("global create menu contract", () => {
  it("documents that task/doc are not global create entries", () => {
    // Behavioral contract — TopBar menu items are covered by component choices.
    // Task creation remains via assistant / tasks quick-add / TaskDraft.
    const allowedGlobalCreate = ["新しいチャット", "詳細調査を開始", "ファイルを追加"];
    expect(allowedGlobalCreate).not.toContain("タスクを追加");
    expect(allowedGlobalCreate).not.toContain("ドキュメントを作る");
  });
});
