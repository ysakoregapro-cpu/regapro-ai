import { describe, expect, it } from "vitest";
import { levelFromDb, levelToDb } from "@/lib/data/persistence/level-map";
import {
  messageFromRow,
  messageToInsert,
  parseVisibility,
  threadFromRow,
  threadToInsert,
} from "@/lib/data/persistence/mappers";

describe("persistence level-map", () => {
  it("round-trips confidentiality levels", () => {
    expect(levelToDb("company")).toBe(1);
    expect(levelToDb("people")).toBe(2);
    expect(levelToDb("executive")).toBe(3);
    expect(levelFromDb(1)).toBe("company");
    expect(levelFromDb(2)).toBe("people");
    expect(levelFromDb(3)).toBe("executive");
  });
});

describe("persistence mappers", () => {
  it("maps thread security metadata without loss", () => {
    const thread = {
      id: "11111111-1111-4111-8111-111111111111",
      title: "案件確認",
      orgId: "22222222-2222-4222-8222-222222222222",
      ownerUserId: "33333333-3333-4333-8333-333333333333",
      departmentId: "44444444-4444-4444-8444-444444444444",
      projectId: null,
      confidentialityLevel: "people" as const,
      visibility: "private" as const,
      securityLabelSource: "user",
      minimumDerivedLevel: "people" as const,
      containsSensitiveContent: true,
      createdAt: "2026-08-09T00:00:00.000Z",
      updatedAt: "2026-08-09T00:00:00.000Z",
    };
    const row = threadToInsert(thread);
    expect(row.confidentiality_level).toBe(2);
    expect(row.visibility).toBe("private");
    expect(row.contains_sensitive_content).toBe(true);

    const back = threadFromRow({
      ...row,
      confidentiality_level: row.confidentiality_level,
      visibility: row.visibility,
      security_label_source: row.security_label_source,
      minimum_derived_level: row.minimum_derived_level,
      contains_sensitive_content: row.contains_sensitive_content,
    });
    expect(back.confidentialityLevel).toBe("people");
    expect(back.visibility).toBe("private");
    expect(back.ownerUserId).toBe(thread.ownerUserId);
    expect(back.containsSensitiveContent).toBe(true);
  });

  it("maps message sensitivity fields", () => {
    const message = {
      id: "55555555-5555-4555-8555-555555555555",
      threadId: "11111111-1111-4111-8111-111111111111",
      role: "user" as const,
      content: "確認します",
      createdAt: "2026-08-09T00:00:00.000Z",
      confidentialityLevel: "company" as const,
      visibility: "department" as const,
      classificationSource: "rule",
      sensitivitySignals: ["market_salary"],
    };
    const insert = messageToInsert(message, "33333333-3333-4333-8333-333333333333");
    expect(insert.author_id).toBe("33333333-3333-4333-8333-333333333333");
    expect(insert.sensitivity_signals).toEqual(["market_salary"]);

    const back = messageFromRow({
      id: insert.id,
      thread_id: insert.thread_id,
      role: insert.role,
      content: insert.content,
      created_at: insert.created_at,
      confidentiality_level: insert.confidentiality_level,
      visibility: insert.visibility,
      classification_confidence: insert.classification_confidence,
      classification_source: insert.classification_source,
      sensitivity_signals: insert.sensitivity_signals,
    });
    expect(back.role).toBe("user");
    expect(back.sensitivitySignals).toEqual(["market_salary"]);
    expect(parseVisibility("org")).toBe("private");
  });
});
