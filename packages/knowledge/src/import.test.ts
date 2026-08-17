import { describe, expect, it } from "vitest";
import { sha256Hex } from "./hash.js";
import {
  inferredClearanceForDomain,
  parseClearanceLevel,
  parseKnowledgeImportManifest,
  resolveKnowledgeImportItems,
} from "./import-manifest.js";
import { decideImportIdempotency, planKnowledgeImport } from "./import-plan.js";
import {
  buildStructuredImportRecords,
  structuredCandidateCount,
} from "./import-records.js";
import { detectPersonalProfileKnowledge } from "./personal-profile.js";
import { assertNoSecurityPromotion } from "./visibility.js";

const hash = sha256Hex;

function baseItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "seed-operating-principles",
    title: "RegaloProfessional AI Operating Principles",
    content: "範囲と期限を先に合意してから仕事を振る。",
    importMode: "structured",
    domains: ["company_common"],
    clearanceLevel: "company",
    visibility: "organization",
    authoritativeSeed: true,
    sourceQuality: 0.95,
    isCurrent: true,
    tags: ["operating-principles"],
    ...overrides,
  };
}

function parseOk(raw: unknown) {
  const parsed = parseKnowledgeImportManifest(raw);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error("expected ok");
  return parsed.manifest;
}

describe("knowledge bulk import", () => {
  it("structured import: 1 item → 1 candidate, authoritative seed, no auto publish", () => {
    const manifest = parseOk({ version: 1, items: [baseItem()] });
    const resolved = resolveKnowledgeImportItems({
      manifest,
      files: new Map(),
      hash,
    });
    expect(resolved.failures).toEqual([]);
    expect(resolved.items).toHaveLength(1);
    const records = buildStructuredImportRecords({ item: resolved.items[0]! });
    expect(structuredCandidateCount(resolved.items[0]!)).toBe(1);
    expect(records.candidate.status).toBe("draft");
    expect(records.candidate.review_status).not.toBe("approved");
    expect(records.job.status).toBe("completed");
    expect(records.source.origin_kind).toBe("authoritative_seed");
    expect(records.candidate.source_quality).toBeGreaterThanOrEqual(0.9);
    expect(records.candidate.extractor_type).toBe("structured-import");
  });

  it("source import plans a source job without publishing", () => {
    const manifest = parseOk({
      version: 1,
      items: [
        baseItem({
          id: "minutes-2026-01",
          title: "営業定例メモ",
          importMode: "source",
          authoritativeSeed: false,
          domains: ["sales"],
        }),
      ],
    });
    const resolved = resolveKnowledgeImportItems({
      manifest,
      files: new Map(),
      hash,
    });
    const plan = planKnowledgeImport({ items: resolved.items });
    expect(plan.items[0]?.importMode).toBe("source");
    expect(plan.items[0]?.published).toBe(false);
    expect(plan.items[0]?.candidateCount).toBe(0);
    expect(plan.summary.importMode.source).toBe(1);
  });

  it("dry-run plan does not imply writes (create vs skip only)", () => {
    const manifest = parseOk({ version: 1, items: [baseItem()] });
    const resolved = resolveKnowledgeImportItems({
      manifest,
      files: new Map(),
      hash,
    });
    const plan = planKnowledgeImport({ items: resolved.items });
    expect(plan.summary.createCount).toBe(1);
    expect(plan.items.every((i) => i.published === false)).toBe(true);
  });

  it("domain != clearance: recruitment L1 organization is valid", () => {
    expect(inferredClearanceForDomain("recruitment")).toBeNull();
    expect(inferredClearanceForDomain("management")).toBeNull();
    const manifest = parseOk({
      version: 1,
      items: [
        baseItem({
          id: "recruitment-l1",
          domains: ["recruitment"],
          clearanceLevel: 1,
          visibility: "organization",
        }),
      ],
    });
    const item = resolveKnowledgeImportItems({
      manifest,
      files: new Map(),
      hash,
    }).items[0]!;
    expect(item.domains).toEqual(["recruitment"]);
    expect(item.clearanceLevel).toBe("company");
    expect(parseClearanceLevel(1)).toBe("company");
  });

  it("L3 restricted knowledge is independent of management domain", () => {
    const manifest = parseOk({
      version: 1,
      items: [
        baseItem({
          id: "mgmt-l3",
          domains: ["management"],
          clearanceLevel: 3,
          visibility: "restricted",
        }),
      ],
    });
    const item = resolveKnowledgeImportItems({
      manifest,
      files: new Map(),
      hash,
    }).items[0]!;
    expect(item.domains).toEqual(["management"]);
    expect(item.clearanceLevel).toBe("executive");
    expect(item.visibility).toBe("restricted");
  });

  it("invalid domain fails before write", () => {
    const parsed = parseKnowledgeImportManifest({
      version: 1,
      items: [baseItem({ domains: ["not_a_domain"] })],
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.failures.some((f) => /Invalid enum|domains/i.test(f.message + f.path))).toBe(
      true,
    );
  });

  it("invalid clearance fails before write", () => {
    const parsed = parseKnowledgeImportManifest({
      version: 1,
      items: [baseItem({ clearanceLevel: 9 })],
    });
    expect(parsed.ok).toBe(false);
  });

  it("duplicate manifest item ids fail before write", () => {
    const parsed = parseKnowledgeImportManifest({
      version: 1,
      items: [baseItem(), baseItem({ title: "copy" })],
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.failures[0]?.code).toBe("duplicate_item_id");
  });

  it("repeat import is idempotent on item id / content hash / checksum", () => {
    const manifest = parseOk({ version: 1, items: [baseItem()] });
    const item = resolveKnowledgeImportItems({
      manifest,
      files: new Map(),
      hash,
    }).items[0]!;
    const first = decideImportIdempotency({ item, existing: [] });
    expect(first.action).toBe("create");
    const second = decideImportIdempotency({
      item,
      existing: [
        {
          sourceId: "s1",
          candidateId: "c1",
          importItemId: item.id,
          contentHash: item.contentHash,
          checksum: item.checksum,
          title: item.title,
        },
      ],
    });
    expect(second.action).toBe("skip_duplicate");
    const byHash = decideImportIdempotency({
      item: { ...item, id: "other-id" },
      existing: [
        {
          sourceId: "s1",
          candidateId: "c1",
          importItemId: "seed-operating-principles",
          contentHash: item.contentHash,
          checksum: item.checksum,
          title: item.title,
        },
      ],
    });
    expect(byHash.action).toBe("skip_duplicate");
    const plan = planKnowledgeImport({
      items: [item],
      existingSources: [
        {
          sourceId: "s1",
          candidateId: "c1",
          importItemId: item.id,
          contentHash: item.contentHash,
          checksum: item.checksum,
          title: item.title,
        },
      ],
    });
    expect(plan.summary.skipDuplicateCount).toBe(1);
    expect(plan.summary.createCount).toBe(0);
  });

  it("private scope is inherited onto the candidate", () => {
    const manifest = parseOk({
      version: 1,
      items: [baseItem({ id: "private-note", visibility: "private" })],
    });
    const item = resolveKnowledgeImportItems({
      manifest,
      files: new Map(),
      hash,
    }).items[0]!;
    const records = buildStructuredImportRecords({ item });
    expect(records.source.visibility).toBe("private");
    expect(records.candidate.suggested_visibility).toBe("private");
    expect(() =>
      assertNoSecurityPromotion({
        sourceVisibility: "private",
        targetVisibility: "organization",
        sourceLevel: "company",
        targetLevel: "company",
      }),
    ).toThrow(/PRIVATE_SOURCE/);
  });

  it("missing file fails before write", () => {
    const parsed = parseOk({
      version: 1,
      items: [baseItem({ content: undefined, file: "missing.md" })],
    });
    const resolved = resolveKnowledgeImportItems({
      manifest: parsed,
      files: new Map(),
      hash,
    });
    expect(resolved.failures[0]?.code).toBe("missing_file");
    expect(resolved.items).toHaveLength(0);
  });

  it("does not treat personal profiles as general knowledge", () => {
    const flagged = detectPersonalProfileKnowledge({
      title: "酒匂のAIに対する考え方",
      content: "役職は代表である。個人的な価値観としてAIをこう使う。",
    });
    expect(flagged.flagged).toBe(true);
    const ok = detectPersonalProfileKnowledge({
      title: "RegaloProfessional AI Operating Principles",
      content: "範囲と期限を先に合意してから仕事を振る。",
    });
    expect(ok.flagged).toBe(false);
  });

  it("qa mode keeps expert name as source metadata, not a second candidate", () => {
    const manifest = parseOk({
      version: 1,
      items: [
        baseItem({
          id: "qa-scope",
          importMode: "qa",
          authoritativeSeed: false,
          question: "部下へ仕事を振る時は？",
          answer: "範囲と期限を先に合意する。",
          expertName: "専門家A",
          candidateType: "qa",
        }),
      ],
    });
    const item = resolveKnowledgeImportItems({
      manifest,
      files: new Map(),
      hash,
    }).items[0]!;
    expect(item.expertName).toBe("専門家A");
    const records = buildStructuredImportRecords({ item });
    expect(records.source.metadata.expertName).toBe("専門家A");
    expect(records.candidate.candidate_type).toBe("qa");
  });
});
