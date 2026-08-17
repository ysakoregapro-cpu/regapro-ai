import { classifyKnowledgeConflict, type ExistingKnowledgeRef } from "./conflict.js";
import { detectPersonalProfileKnowledge } from "./personal-profile.js";
import { inheritVisibility } from "./visibility.js";
import type { ResolvedImportItem } from "./import-manifest.js";
import { clearanceRankLabel } from "./import-manifest.js";

export type ExistingImportRef = {
  sourceId: string;
  candidateId: string | null;
  importItemId: string | null;
  contentHash: string | null;
  checksum: string | null;
  title: string;
};

export type ImportPlanAction = "create" | "skip_duplicate" | "invalid";

export type PlannedImportItem = {
  id: string;
  title: string;
  importMode: ResolvedImportItem["importMode"];
  domains: string[];
  clearanceLevel: ResolvedImportItem["clearanceLevel"];
  clearanceLabel: "L1" | "L2" | "L3";
  visibility: string;
  candidateType: string;
  factStatus: string;
  isCurrent: boolean;
  authoritativeSeed: boolean;
  sourceKind: "file" | "inline" | "qa";
  charCount: number;
  contentHash: string;
  action: ImportPlanAction;
  candidateCount: number;
  conflictKind: "new" | "duplicate" | "supersession" | "conflict";
  conflictReason: string | null;
  skipReason: string | null;
  invalidCode: string | null;
  published: false;
};

export type KnowledgeImportPlan = {
  items: PlannedImportItem[];
  invalid: PlannedImportItem[];
  summary: KnowledgeImportPlanSummary;
};

export type KnowledgeImportPlanSummary = {
  itemCount: number;
  validCount: number;
  invalidCount: number;
  createCount: number;
  skipDuplicateCount: number;
  domains: Record<string, number>;
  clearance: Record<string, number>;
  visibility: Record<string, number>;
  sourceKind: Record<string, number>;
  importMode: Record<string, number>;
  current: number;
  historical: number;
  authoritativeSeed: number;
  duplicateCandidates: number;
  conflictCandidates: number;
  personalProfileFlags: number;
};

function countBy(values: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) out[v] = (out[v] ?? 0) + 1;
  return out;
}

export function decideImportIdempotency(input: {
  item: Pick<ResolvedImportItem, "id" | "contentHash" | "checksum">;
  existing: ExistingImportRef[];
}): { action: "create" | "skip_duplicate"; existing?: ExistingImportRef; reason?: string } {
  const byItem = input.existing.find((e) => e.importItemId === input.item.id);
  if (byItem) {
    return { action: "skip_duplicate", existing: byItem, reason: "import_item_id" };
  }
  const byHash = input.existing.find((e) => e.contentHash === input.item.contentHash);
  if (byHash) {
    return { action: "skip_duplicate", existing: byHash, reason: "content_hash" };
  }
  const byChecksum = input.existing.find(
    (e) => e.checksum && e.checksum === input.item.checksum,
  );
  if (byChecksum) {
    return { action: "skip_duplicate", existing: byChecksum, reason: "source_checksum" };
  }
  return { action: "create" };
}

export function planKnowledgeImport(input: {
  items: ResolvedImportItem[];
  existingSources?: ExistingImportRef[];
  existingPublished?: ExistingKnowledgeRef[];
}): KnowledgeImportPlan {
  const existing = input.existingSources ?? [];
  const published = input.existingPublished ?? [];
  const planned: PlannedImportItem[] = [];

  for (const item of input.items) {
    const profile = detectPersonalProfileKnowledge({
      title: item.title,
      content: item.content,
      importMode: item.importMode,
    });
    const sourceKind: PlannedImportItem["sourceKind"] =
      item.importMode === "qa" ? "qa" : item.file ? "file" : "inline";
    const candidateCount = item.importMode === "structured" || item.importMode === "qa" ? 1 : 0;
    const idem = decideImportIdempotency({ item, existing });
    const conflict =
      idem.action === "create"
        ? classifyKnowledgeConflict({
            title: item.title,
            body: item.content,
            factStatus: item.factStatus,
            isCurrent: item.isCurrent,
            sourceQuality: item.sourceQuality,
            originKind: item.authoritativeSeed ? "authoritative_seed" : item.importMode,
            sourceDate: item.sourceDate,
            existing: published,
          })
        : { kind: "duplicate" as const, existingId: idem.existing?.sourceId ?? null, reason: idem.reason ?? "duplicate" };

    if (profile.flagged) {
      planned.push({
        id: item.id,
        title: item.title,
        importMode: item.importMode,
        domains: [...item.domains],
        clearanceLevel: item.clearanceLevel,
        clearanceLabel: clearanceRankLabel(item.clearanceLevel),
        visibility: item.visibility,
        candidateType: item.candidateType,
        factStatus: item.factStatus,
        isCurrent: item.isCurrent,
        authoritativeSeed: item.authoritativeSeed,
        sourceKind,
        charCount: item.charCount,
        contentHash: item.contentHash,
        action: "invalid",
        candidateCount: 0,
        conflictKind: "new",
        conflictReason: null,
        skipReason: null,
        invalidCode: profile.reasons[0] ?? "personal_profile",
        published: false,
      });
      continue;
    }

    planned.push({
      id: item.id,
      title: item.title,
      importMode: item.importMode,
      domains: [...item.domains],
      clearanceLevel: item.clearanceLevel,
      clearanceLabel: clearanceRankLabel(item.clearanceLevel),
      visibility: inheritVisibility(item.visibility),
      candidateType: item.candidateType,
      factStatus: item.factStatus,
      isCurrent: item.isCurrent,
      authoritativeSeed: item.authoritativeSeed,
      sourceKind,
      charCount: item.charCount,
      contentHash: item.contentHash,
      action: idem.action,
      candidateCount: idem.action === "skip_duplicate" ? 0 : candidateCount,
      conflictKind: conflict.kind,
      conflictReason: conflict.reason,
      skipReason: idem.action === "skip_duplicate" ? (idem.reason ?? "duplicate") : null,
      invalidCode: null,
      published: false,
    });
  }

  const invalid = planned.filter((p) => p.action === "invalid");
  const summary: KnowledgeImportPlanSummary = {
    itemCount: planned.length,
    validCount: planned.length - invalid.length,
    invalidCount: invalid.length,
    createCount: planned.filter((p) => p.action === "create").length,
    skipDuplicateCount: planned.filter((p) => p.action === "skip_duplicate").length,
    domains: countBy(planned.flatMap((p) => p.domains)),
    clearance: countBy(planned.map((p) => p.clearanceLabel)),
    visibility: countBy(planned.map((p) => p.visibility)),
    sourceKind: countBy(planned.map((p) => p.sourceKind)),
    importMode: countBy(planned.map((p) => p.importMode)),
    current: planned.filter((p) => p.isCurrent).length,
    historical: planned.filter((p) => !p.isCurrent).length,
    authoritativeSeed: planned.filter((p) => p.authoritativeSeed).length,
    duplicateCandidates: planned.filter((p) => p.conflictKind === "duplicate").length,
    conflictCandidates: planned.filter(
      (p) => p.conflictKind === "conflict" || p.conflictKind === "supersession",
    ).length,
    personalProfileFlags: invalid.filter((p) => p.invalidCode?.includes("personal")).length,
  };

  return { items: planned, invalid, summary };
}

export function formatImportPlanSummary(plan: KnowledgeImportPlan): string {
  const s = plan.summary;
  const lines = [
    `items: ${s.itemCount} (create ${s.createCount}, skip ${s.skipDuplicateCount}, invalid ${s.invalidCount})`,
    `domains: ${formatCounts(s.domains)}`,
    `clearance: ${formatCounts(s.clearance)}`,
    `visibility: ${formatCounts(s.visibility)}`,
    `source kind: ${formatCounts(s.sourceKind)}`,
    `import mode: ${formatCounts(s.importMode)}`,
    `current/historical: ${s.current}/${s.historical}`,
    `authoritative seed: ${s.authoritativeSeed}`,
    `duplicate candidates: ${s.duplicateCandidates}`,
    `conflict/supersession: ${s.conflictCandidates}`,
    `personal profile flags: ${s.personalProfileFlags}`,
    "auto-publish: no",
  ];
  if (plan.invalid.length) {
    lines.push("invalid items:");
    for (const row of plan.invalid) {
      lines.push(`  - ${row.id}: ${row.invalidCode}`);
    }
  }
  return lines.join("\n");
}

function formatCounts(map: Record<string, number>): string {
  const keys = Object.keys(map);
  if (!keys.length) return "(none)";
  return keys.map((k) => `${k}=${map[k]}`).join(", ");
}
