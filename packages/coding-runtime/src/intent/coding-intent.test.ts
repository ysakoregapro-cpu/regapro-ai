import { describe, expect, it } from "vitest";
import { classifyCodingIntent, extractPastedBlocks } from "./coding-intent.js";

describe("coding intent", () => {
  it("treats pasted GAS as coding without a workspace", () => {
    const text = `このGAS直して

\`\`\`js
function onOpen() {
  SpreadsheetApp.getUi().createMenu("Regapro").addToUi();
}
\`\`\`
`;
    const d = classifyCodingIntent(text);
    expect(d.isCoding).toBe(true);
    expect(d.mode).toBe("pasted");
    expect(d.language).toBe("gas");
    expect(d.requiresWorkspace).toBe(false);
    expect(extractPastedBlocks(text)[0]?.code).toMatch(/SpreadsheetApp/);
  });

  it("does not treat a missing local file as a requirement for pasted code", () => {
    const d = classifyCodingIntent("このTypeScriptをリファクタして\n```ts\nexport const x = 1;\n```");
    expect(d.mode).toBe("pasted");
    expect(d.requiresWorkspace).toBe(false);
  });

  it("detects vibe/workspace when a repo path is present", () => {
    const d = classifyCodingIntent(
      "C:\\Users\\natan\\source\\regapro-expense の構成を調べてバグを直して typecheck まで",
    );
    expect(d.isCoding).toBe(true);
    expect(d.mode).toBe("vibe");
    expect(d.requiresWorkspace).toBe(true);
  });
});
