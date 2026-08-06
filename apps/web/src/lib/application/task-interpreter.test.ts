import { describe, expect, it } from "vitest";
import { interpretTaskUtterance } from "./task-interpreter";

describe("interpretTaskUtterance", () => {
  const ref = new Date("2026-08-06T10:00:00+09:00");

  it("parses 明日 with assignee and project hints", () => {
    const result = interpretTaskUtterance(
      "明日までに田中さんへ求人選定状況を確認",
      ref
    );
    expect(result.assigneeHint).toBe("田中 健太");
    expect(result.projectHint).toBe("有料職業紹介");
    expect(result.dueHint).toBe("2026-08-07 17:00");
    expect(result.title).toContain("田中");
    expect(result.confidence).toBeGreaterThan(0.7);
  });

  it("parses 森藤 as assignee", () => {
    const result = interpretTaskUtterance("森藤さんにイベント資料を確認してもらう", ref);
    expect(result.assigneeHint).toBe("森藤 美穂");
    expect(result.projectHint).toBe("通信イベント運営");
  });

  it("parses 金曜17時 due hint", () => {
    const result = interpretTaskUtterance("金曜17時にミーティング資料を共有", ref);
    expect(result.dueHint).toBe("2026-08-07 17:00");
  });

  it("parses 来週月曜 due hint", () => {
    const result = interpretTaskUtterance("来週月曜 レビュー", ref);
    expect(result.dueHint).toBe("2026-08-17 17:00");
  });

  it("sets urgent priority for 至急 and 代表確認", () => {
    expect(interpretTaskUtterance("至急：採用条件を整理", ref).priority).toBe("urgent");
    expect(interpretTaskUtterance("代表確認が必要な案をまとめる", ref).priority).toBe("urgent");
  });

  it("enables day-before notification when 前日 is mentioned", () => {
    const result = interpretTaskUtterance("期限前日に通知して、DX画面を確認", ref);
    expect(result.notifyDayBefore).toBe(true);
    expect(result.projectHint).toBe("DX開発");
  });

  it("parses completion utterance", () => {
    const result = interpretTaskUtterance("求人選定タスクが終わった", ref);
    expect(result.description).toBe("完了として更新");
    expect(result.confidence).toBeGreaterThan(0.6);
  });

  it("keeps low confidence for vague input", () => {
    const result = interpretTaskUtterance("なんかやる", ref);
    expect(result.confidence).toBeLessThan(0.7);
    expect(result.title).toBe("なんかやる");
  });
});
