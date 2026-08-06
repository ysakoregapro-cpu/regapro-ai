import { describe, expect, it } from "vitest";
import {
  assertNotDirectPublishFromAi,
  canTransitionKnowledge,
  createDraftFromCandidate,
  transitionKnowledge,
} from "./lifecycle.js";

describe("knowledge state transitions", () => {
  it("allows draft -> review", () => {
    expect(canTransitionKnowledge("draft", "review")).toBe(true);
    expect(transitionKnowledge("draft", "review")).toBe("review");
  });

  it("blocks draft -> published", () => {
    expect(canTransitionKnowledge("draft", "published")).toBe(false);
    expect(() => transitionKnowledge("draft", "published")).toThrow();
  });

  it("allows approved -> published", () => {
    expect(transitionKnowledge("approved", "published")).toBe("published");
  });

  it("creates draft from AI candidate", () => {
    const draft = createDraftFromCandidate({
      sourceAnswerId: "00000000-0000-4000-8000-000000000001",
      title: "Fact",
      body: "Content",
      confidence: 0.8,
      extractedFacts: ["a"],
    });
    expect(draft.status).toBe("draft");
  });

  it("prevents direct AI publish", () => {
    expect(() =>
      assertNotDirectPublishFromAi("ai_answer", "published"),
    ).toThrow();
  });
});
