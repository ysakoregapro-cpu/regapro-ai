import { describe, expect, it } from "vitest";
import {
  interpretNaturalLanguageTask,
  isReminderEligible,
  recalculateRemindersForTasks,
  shouldConfirmBeforeCreate,
} from "./index.js";

describe("NL task interpreter", () => {
  const ref = new Date("2026-08-06T10:00:00+09:00");

  it("parses TODO prefix", () => {
    const result = interpretNaturalLanguageTask("TODO: 資料を作成", ref);
    expect(result.draft.title).toBe("資料を作成");
    expect(result.matchedPatterns).toContain("prefix");
  });

  it("parses 明日 due date", () => {
    const result = interpretNaturalLanguageTask("明日までに報告書", ref);
    expect(result.draft.dueAt).toBeDefined();
    expect(result.matchedPatterns.length).toBeGreaterThan(0);
  });

  it("parses 金曜17時", () => {
    const result = interpretNaturalLanguageTask("金曜17時にミーティング", ref);
    expect(result.draft.dueAt).toBeDefined();
  });

  it("parses 来週月曜", () => {
    const result = interpretNaturalLanguageTask("来週月曜 レビュー", ref);
    expect(result.draft.dueAt).toBeDefined();
  });

  it("requires confirmation for low confidence", () => {
    const result = interpretNaturalLanguageTask("なんかやる", ref);
    expect(shouldConfirmBeforeCreate(result.draft)).toBe(true);
  });
});

describe("reminder recalculation", () => {
  it("excludes completed and cancelled", () => {
    const ids = recalculateRemindersForTasks([
      {
        id: "a",
        status: "open",
        dueAt: "2026-08-10T00:00:00+09:00",
      },
      {
        id: "b",
        status: "completed",
        dueAt: "2026-08-10T00:00:00+09:00",
      },
      {
        id: "c",
        status: "cancelled",
        dueAt: "2026-08-10T00:00:00+09:00",
      },
    ]);
    expect(ids).toEqual(["a"]);
    expect(isReminderEligible({ status: "completed" })).toBe(false);
  });
});
