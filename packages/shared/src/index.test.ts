import { describe, expect, it } from "vitest";
import {
  ConfidentialityLevelSchema,
  compareConfidentiality,
  DEPARTMENT_DEFAULT_CLEARANCE,
  resolveEffectiveClearance,
  selectableLevelsForClearance,
  inheritSecurityLabel,
} from "./index.js";
import { loadRegaproEnv, parseDataMode, RegaproEnvError } from "./env.js";
import {
  parseJapaneseRelativeDate,
  parseJapaneseRelativeDatesInText,
} from "./relative-dates.js";
import { toTokyoDate } from "./dates.js";

describe("env validation", () => {
  it("accepts dev-sample", () => {
    expect(parseDataMode("dev-sample")).toBe("dev-sample");
  });

  it("accepts supabase", () => {
    expect(parseDataMode("supabase")).toBe("supabase");
  });

  it("rejects invalid mode with explicit error", () => {
    expect(() => parseDataMode("production")).toThrow(RegaproEnvError);
    expect(() => parseDataMode(undefined)).toThrow(RegaproEnvError);
  });

  it("never silently falls back", () => {
    expect(() => loadRegaproEnv({ REGAPRO_DATA_MODE: "local" })).toThrow(
      RegaproEnvError,
    );
  });
});

describe("confidentiality model", () => {
  it("parses levels", () => {
    expect(ConfidentialityLevelSchema.parse("company")).toBe("company");
    expect(() => ConfidentialityLevelSchema.parse("4")).toThrow();
  });

  it("compares ranks", () => {
    expect(compareConfidentiality("executive", "people")).toBeGreaterThan(0);
  });

  it("department defaults", () => {
    expect(DEPARTMENT_DEFAULT_CLEARANCE.sales).toBe("company");
    expect(DEPARTMENT_DEFAULT_CLEARANCE.people).toBe("people");
    expect(DEPARTMENT_DEFAULT_CLEARANCE.executive_strategy).toBe("executive");
  });

  it("applies clearance override", () => {
    expect(
      resolveEffectiveClearance({
        departmentKey: "sales",
        clearanceOverride: "people",
      }),
    ).toBe("people");
  });

  it("lists selectable levels", () => {
    expect(selectableLevelsForClearance("people")).toEqual([
      "company",
      "people",
    ]);
  });

  it("inherits security label", () => {
    const child = inheritSecurityLabel(
      {
        confidentialityLevel: "people",
        visibility: "private",
        ownerUserId: "u1",
      },
      { originThreadId: "t1" },
    );
    expect(child.confidentialityLevel).toBe("people");
    expect(child.securityLabelSource).toBe("inherited");
  });
});

describe("Japanese relative dates", () => {
  const ref = toTokyoDate(new Date("2026-08-06T10:00:00+09:00"));

  it("parses 明日", () => {
    const result = parseJapaneseRelativeDate("明日", ref);
    expect(result?.matched).toBe("明日");
    expect(result?.date.getDate()).toBe(7);
  });

  it("parses 金曜17時", () => {
    const result = parseJapaneseRelativeDate("金曜17時", ref);
    expect(result?.date.getDay()).toBe(5);
    expect(result?.date.getHours()).toBe(17);
  });

  it("parses 来週月曜", () => {
    const result = parseJapaneseRelativeDate("来週月曜", ref);
    expect(result?.matched).toBe("来週月曜");
    expect(result?.date.getDay()).toBe(1);
  });

  it("extracts multiple dates from text", () => {
    const results = parseJapaneseRelativeDatesInText("明日と金曜17時", ref);
    expect(results.length).toBeGreaterThanOrEqual(2);
  });
});
