import { describe, expect, it } from "vitest";
import {
  DEFAULT_KNOWLEDGE_INGESTION_BUDGET,
  KnowledgeIngestionBudgetGuard,
} from "./budget.js";
import { isKnowledgeCaptureUtterance, planConversationCapture } from "./capture.js";
import {
  canBatchApprove,
  classifyKnowledgeConflict,
  preferCurrentKnowledge,
} from "./conflict.js";
import { HeuristicKnowledgeExtractor } from "./extractor.js";
import { splitKnowledgeBody } from "./chunker.js";
import { sha256Hex } from "./hash.js";
import { InMemoryKnowledgeJobQueue } from "./job-port.js";
import { GenericTranscriptIngestPort, transcriptToReusableText } from "./transcript.js";
import { assertNoSecurityPromotion } from "./visibility.js";
import { PassthroughTrainingDatasetPort } from "./training.js";

describe("large text split / resume budget", () => {
  it("splits a large source into resumable units without one LLM context", () => {
    const body = Array.from({ length: 40 }, (_, i) => `営業方針 ${i}。詳細な運用ルールを記載します。`).join(
      "\n\n",
    );
    const chunks = splitKnowledgeBody(body, {
      maxChars: 80,
      overlapChars: 10,
      minChars: 20,
    });
    expect(chunks.length).toBeGreaterThan(DEFAULT_KNOWLEDGE_INGESTION_BUDGET.maxUnitsPerTick);
    const guard = new KnowledgeIngestionBudgetGuard();
    let tick = 0;
    while (guard.takeUnitTick(tick) && tick < chunks.length) tick += 1;
    expect(tick).toBe(DEFAULT_KNOWLEDGE_INGESTION_BUDGET.maxUnitsPerTick);
    expect(tick).toBeLessThan(chunks.length);
  });

  it("detects duplicate source hashes", () => {
    const a = sha256Hex("同じ本文");
    const b = sha256Hex("同じ本文");
    expect(a).toBe(b);
  });
});

describe("conflict / supersession / historical", () => {
  const existing = [
    {
      id: "d1",
      title: "有料職業紹介の許可",
      body: "許可取得準備中",
      factStatus: "fact" as const,
      current: true,
    },
  ];

  it("marks identical body as duplicate", () => {
    const d = classifyKnowledgeConflict({
      title: "有料職業紹介の許可",
      body: "許可取得準備中",
      existing,
    });
    expect(d.kind).toBe("duplicate");
    expect(d.existingId).toBe("d1");
  });

  it("suggests supersession for same topic new fact", () => {
    const d = classifyKnowledgeConflict({
      title: "有料職業紹介の許可",
      body: "許可を取得済み",
      factStatus: "fact",
      existing,
    });
    expect(d.kind).toBe("supersession");
  });

  it("blocks batch approve for conflicts", () => {
    expect(
      canBatchApprove({ reviewStatus: "conflict", conflictKind: "conflict" }),
    ).toBe(false);
    expect(canBatchApprove({ reviewStatus: "new", conflictKind: "new" })).toBe(
      true,
    );
  });

  it("prefers current rows unless the query is historical", () => {
    const rows = [
      { id: "old", current: false, factStatus: "historical" },
      { id: "now", current: true, factStatus: "fact" },
    ];
    expect(preferCurrentKnowledge(rows, false).map((r) => r.id)).toEqual(["now"]);
    expect(preferCurrentKnowledge(rows, true)).toHaveLength(2);
  });
});

describe("Q&A extraction", () => {
  it("keeps raw Q&A and a separate generalized candidate", async () => {
    const ex = new HeuristicKnowledgeExtractor();
    const out = await ex.extract({
      originKind: "qa",
      title: "委譲",
      text: "Q&A",
      chunkIndex: 0,
      question: "部下へ仕事を振る時に意識することは？",
      answer: "任せる範囲と期限を先に合意する。検討中の例外は別途確認する。",
      domainKeys: ["management"],
    });
    expect(out.some((c) => c.candidateType === "qa")).toBe(true);
    expect(out.some((c) => c.candidateType === "knowhow")).toBe(true);
    expect(out.find((c) => c.candidateType === "qa")?.content).toMatch(/Q:/);
    expect(out.find((c) => c.candidateType === "knowhow")?.factStatus).not.toBe(
      "fact",
    );
  });
});

describe("conversation capture security", () => {
  it("detects capture utterances", () => {
    expect(isKnowledgeCaptureUtterance("これをナレッジに追加して")).toBe(true);
    expect(isKnowledgeCaptureUtterance("今日の天気は")).toBe(false);
  });

  it("blocks private conversation promotion", () => {
    const plan = planConversationCapture({
      userQuestion: "相談",
      assistantAnswer: "回答",
      evidenceTitles: [],
      instruction: "ナレッジに追加して",
      visibility: "private",
      containsPersonalConversation: false,
    });
    expect(plan.allowed).toBe(false);
  });

  it("keeps provenance when allowed", () => {
    const plan = planConversationCapture({
      userQuestion: "営業の手順は",
      assistantAnswer: "ヒアリングを先にする",
      evidenceTitles: ["営業マニュアル"],
      instruction: "この回答を営業ナレッジにして",
      visibility: "organization",
      containsPersonalConversation: false,
    });
    expect(plan.allowed).toBe(true);
    expect(plan.content).toMatch(/質問:/);
    expect(plan.content).toMatch(/回答:/);
    expect(plan.sourceQuality).toBeLessThan(0.5);
  });
});

describe("security inheritance", () => {
  it("forbids private → organization auto promote", () => {
    expect(() =>
      assertNoSecurityPromotion({
        sourceVisibility: "private",
        targetVisibility: "organization",
        sourceLevel: "company",
        targetLevel: "company",
      }),
    ).toThrow(/PRIVATE_SOURCE/);
  });
});

describe("jobs / transcript / training ports", () => {
  it("tracks resumable job progress in the in-memory queue", async () => {
    const q = new InMemoryKnowledgeJobQueue();
    const id = await q.enqueue({
      sourceId: "s1",
      orgId: "o1",
      createdBy: "u1",
    });
    const job = await q.load(id);
    expect(job?.status).toBe("pending");
    await q.saveProgress({
      ...job!,
      status: "processing",
      totalUnits: 10,
      processedUnits: 3,
      cursorIndex: 3,
    });
    expect((await q.load(id))?.processedUnits).toBe(3);
  });

  it("parses structured transcripts without vendor lock-in", () => {
    const port = new GenericTranscriptIngestPort();
    const t = port.parse({
      title: "週次",
      messages: [
        { role: "user", content: "進捗は", timestamp: "2026-08-01T00:00:00.000Z" },
        { role: "assistant", content: "案件Aは進行中" },
        { role: "user", content: "私生活の話" },
      ],
    });
    const text = transcriptToReusableText(t);
    expect(text).toMatch(/案件A/);
    expect(text).not.toMatch(/私生活/);
  });

  it("keeps training candidates separate from knowledge", () => {
    const port = new PassthroughTrainingDatasetPort();
    const row = port.fromEvaluation({
      question: "q",
      evidenceRefs: [{ sourceType: "knowledge_chunk", id: "c1" }],
      modelAnswer: "a",
      correctedAnswer: "b",
      evaluation: "corrected",
      confidentialityLevel: "company",
      visibility: "organization",
    });
    expect(row.correctedAnswer).toBe("b");
  });
});

describe("source text extractors", () => {
  it("reads utf-8 text and csv without calling a model", async () => {
    const { extractSourceText } = await import("./source-text.js");
    const txt = extractSourceText({
      mimeType: "text/plain",
      filename: "note.txt",
      bytes: new TextEncoder().encode("営業方針です"),
    });
    expect(txt.text).toMatch(/営業方針/);
    const csv = extractSourceText({
      mimeType: "text/csv",
      filename: "a.csv",
      bytes: new TextEncoder().encode("name,role\nA,営業"),
    });
    expect(csv.text).toMatch(/営業/);
    const unknown = extractSourceText({
      mimeType: "application/octet-stream",
      filename: "x.bin",
      bytes: new Uint8Array([1, 2, 3]),
    });
    expect(unknown.text).toBeNull();
    expect(unknown.limitation).toBe("unsupported_type");
  });
});
