import { describe, expect, it, beforeEach } from "vitest";
import {
  __resetChatStoreForTests,
  appendUserMessage,
  changeThreadLevel,
  craftDemoAssistantReply,
  createDerivedResource,
  ensureAssistantReply,
  getThreadMessages,
  searchAccessible,
  startChatFromHome,
  answerAboutColleague,
} from "./chat-service";
import { CURRENT_MEMBERSHIP, SAMPLE_MEMBERSHIPS } from "@/lib/data/dev-sample/memberships";
import { CURRENT_USER } from "@/lib/data/dev-sample/catalog";

beforeEach(() => {
  __resetChatStoreForTests();
});

describe("home → chat start persistence", () => {
  it("creates thread and first user message together", () => {
    const result = startChatFromHome({
      content: "明日までに森藤さんへ求人選定状況を確認",
      requestedLevel: "company",
      idempotencyKey: "key-create-1",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const messages = getThreadMessages(result.threadId);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.role).toBe("user");
    expect(messages[0]?.content).toContain("求人選定");
    expect(result.redirectTo).toContain("started=1");
  });

  it("dedupes thread by Idempotency-Key", () => {
    const a = startChatFromHome({
      content: "同じ依頼",
      requestedLevel: "company",
      idempotencyKey: "key-same",
    });
    const b = startChatFromHome({
      content: "同じ依頼",
      requestedLevel: "company",
      idempotencyKey: "key-same",
    });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.threadId).toBe(b.threadId);
    expect(a.messageId).toBe(b.messageId);
  });

  it("restores content when confirmation is required", () => {
    const r = startChatFromHome({
      content: "応募者の履歴書を要約して",
      requestedLevel: "company",
      userId: "user-hr",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.restoreContent).toContain("履歴書");
  });
});

describe("assistant reply generation", () => {
  it("shows first message then generates one assistant reply", () => {
    const started = startChatFromHome({
      content: "求人票の作り方を整理して",
      requestedLevel: "company",
      idempotencyKey: "key-reply-1",
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    const first = ensureAssistantReply({ threadId: started.threadId });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.created).toBe(true);
    expect(first.messages).toHaveLength(2);
    expect(first.messages[0]?.role).toBe("user");
    expect(first.messages[1]?.role).toBe("assistant");

    const second = ensureAssistantReply({ threadId: started.threadId });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.created).toBe(false);
    expect(second.messages).toHaveLength(2);
    expect(second.message.id).toBe(first.message.id);
  });

  it("does not put confidentiality boilerplate in normal replies", () => {
    const started = startChatFromHome({
      content: "イベント会場の動線を確認したい",
      requestedLevel: "company",
      idempotencyKey: "key-no-boilerplate",
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const reply = ensureAssistantReply({ threadId: started.threadId });
    expect(reply.ok).toBe(true);
    if (!reply.ok) return;
    expect(reply.message.content).not.toMatch(/情報区分/);
    expect(reply.message.content).not.toMatch(/範囲で回答/);
  });

  it("does not claim Web or knowledge search ran while offline", () => {
    const crafted = craftDemoAssistantReply("展示会の最新情報を調べて");
    expect(crafted.content).not.toMatch(/調べました|参照しました|確認しました/);
    expect(crafted.content).toMatch(/接続されていない|参照してはいません/);
  });

  it("append + reply keeps a single assistant message per user turn", () => {
    const started = startChatFromHome({
      content: "初回",
      requestedLevel: "company",
      idempotencyKey: "key-follow",
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    ensureAssistantReply({ threadId: started.threadId });
    const appended = appendUserMessage({
      threadId: started.threadId,
      content: "続きの質問",
    });
    expect(appended.ok).toBe(true);
    const reply = ensureAssistantReply({ threadId: started.threadId });
    expect(reply.ok).toBe(true);
    if (!reply.ok) return;
    const assistants = reply.messages.filter((m) => m.role === "assistant");
    const users = reply.messages.filter((m) => m.role === "user");
    expect(users).toHaveLength(2);
    expect(assistants).toHaveLength(2);
  });
});

describe("privacy and fixtures", () => {
  it("refuses private consultations with natural wording", () => {
    const ans = answerAboutColleague(
      "最近、酒匂さんは何を相談している？",
      "user-sakawa",
    );
    expect(ans).toContain("非公開の相談内容は参照できません");
    expect(ans).toContain("公開されている担当業務");
  });

  it("keeps sample user names consistent", () => {
    expect(CURRENT_USER.name).toBe(CURRENT_MEMBERSHIP.name);
    expect(SAMPLE_MEMBERSHIPS.some((m) => m.name === "酒匂 直樹")).toBe(true);
    expect(SAMPLE_MEMBERSHIPS.some((m) => m.name === "田中 健太")).toBe(true);
  });

  it("excludes other private chats from search", () => {
    const hits = searchAccessible("キャリア", "user-tanaka");
    expect(hits.every((h) => h.id !== "thread-sakawa-private")).toBe(true);
  });
});

describe("inheritance", () => {
  it("blocks lowering derived executive resources", () => {
    const started = startChatFromHome({
      content: "経営会議資料の要点",
      requestedLevel: "executive",
      confirmRaise: true,
      userId: "user-exec",
      idempotencyKey: `exec-${Date.now()}`,
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    createDerivedResource({
      threadId: started.threadId,
      kind: "artifact",
      title: "会議メモ",
      userId: "user-exec",
    });
    const lower = changeThreadLevel({
      threadId: started.threadId,
      newLevel: "company",
      userId: "user-exec",
    });
    expect(lower.ok).toBe(false);
  });
});
