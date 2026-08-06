import { describe, expect, it } from "vitest";
import { ArtifactSpecSchema, MarkdownRenderer } from "./index.js";

describe("ArtifactSpec parse", () => {
  it("parses valid spec", () => {
    const spec = ArtifactSpecSchema.parse({
      title: "Report",
      format: "markdown",
      sections: [{ heading: "Intro", body: "Hello" }],
    });
    expect(spec.title).toBe("Report");
  });

  it("rejects invalid format", () => {
    expect(() =>
      ArtifactSpecSchema.parse({
        title: "X",
        format: "html",
        sections: [],
      }),
    ).toThrow();
  });
});

describe("MarkdownRenderer", () => {
  it("renders deterministically", async () => {
    const renderer = new MarkdownRenderer();
    const result = await renderer.render({
      title: "T",
      format: "markdown",
      sections: [{ heading: "H", body: "B" }],
    });
    const text = new TextDecoder().decode(result.content);
    expect(text).toContain("# T");
    expect(text).toContain("## H");
  });
});
