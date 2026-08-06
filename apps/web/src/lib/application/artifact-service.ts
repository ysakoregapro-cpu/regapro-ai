import type { ConfidentialityLevel, Visibility } from "@regapro/shared";
import { createInheritedChildLabel } from "@regapro/security";
import { MarkdownRenderer, type ArtifactFormat } from "@regapro/artifacts";
import { CURRENT_MEMBERSHIP } from "@/lib/data/dev-sample/memberships";

export type StoredArtifact = {
  id: string;
  threadId: string;
  messageId: string | null;
  title: string;
  format: ArtifactFormat;
  formatStatus: "ready" | "disabled";
  disabledReason: string | null;
  markdownPreview: string;
  version: number;
  versions: { version: number; markdownPreview: string; createdAt: string }[];
  confidentialityLevel: ConfidentialityLevel;
  visibility: Visibility;
  projectId: string | null;
  createdAt: string;
  updatedAt: string;
  subtype: "text" | "document" | "presentation" | "code" | "prompt";
};

type Store = {
  artifacts: Map<string, StoredArtifact>;
  byThread: Map<string, string[]>;
};

const g = globalThis as unknown as { __regaproArtifactStore?: Store };

function store(): Store {
  if (!g.__regaproArtifactStore) {
    g.__regaproArtifactStore = {
      artifacts: new Map(),
      byThread: new Map(),
    };
  }
  return g.__regaproArtifactStore;
}

function newId() {
  return globalThis.crypto.randomUUID();
}

const CONNECTED: ArtifactFormat[] = ["markdown"];
const DISABLED_REASONS: Partial<Record<ArtifactFormat, string>> = {
  pdf: "PDF生成は未接続です",
  docx: "Word生成は未接続です",
  xlsx: "Excel生成は未接続です",
  pptx: "PowerPoint生成は未接続です",
};

function detectFormat(request: string, hint?: ArtifactFormat): ArtifactFormat {
  if (hint) return hint;
  if (/PowerPoint|pptx|スライド/i.test(request)) return "pptx";
  if (/Excel|xlsx|表を/i.test(request)) return "xlsx";
  if (/Word|docx/i.test(request)) return "docx";
  if (/PDF|pdf/i.test(request)) return "pdf";
  return "markdown";
}

function detectSubtype(
  request: string,
  hint?: "text" | "document" | "presentation",
): StoredArtifact["subtype"] {
  if (hint) return hint;
  if (/コード|実装|Cursor/i.test(request)) return "code";
  if (/指示書|プロンプト/i.test(request)) return "prompt";
  if (/スライド|提案資料|PowerPoint/i.test(request)) return "presentation";
  if (/議事録|文面|メール/i.test(request)) return "text";
  return "document";
}

export function createDocumentArtifactFromRequest(input: {
  threadId: string;
  messageId: string | null;
  request: string;
  confidentialityLevel: ConfidentialityLevel;
  visibility: Visibility;
  ownerUserId?: string;
  departmentId?: string | null;
  projectId?: string | null;
  formatHint?: ArtifactFormat;
  subtype?: "text" | "document" | "presentation";
}): StoredArtifact {
  const label = createInheritedChildLabel(
    {
      confidentialityLevel: input.confidentialityLevel,
      visibility: input.visibility,
      ownerUserId: input.ownerUserId ?? CURRENT_MEMBERSHIP.userId,
      departmentId: input.departmentId ?? null,
      projectId: input.projectId ?? null,
    },
    { threadId: input.threadId, messageId: input.messageId ?? undefined },
  );

  const format = detectFormat(input.request, input.formatHint);
  const subtype = detectSubtype(input.request, input.subtype);
  const ready = CONNECTED.includes(format);
  const title =
    input.request.replace(/\s+/g, " ").trim().slice(0, 40) || "新しい資料";

  const sections = [
    {
      heading: "概要",
      body: `依頼「${input.request.slice(0, 120)}」に基づく下書きです。`,
    },
    {
      heading: "本文",
      body:
        subtype === "text"
          ? "ここに本文の下書きが入ります。同じチャットから修正依頼できます。"
          : "構成案を同じ会話から調整できます。",
    },
  ];

  const renderer = new MarkdownRenderer();
  void renderer.render({
    title,
    format: "markdown",
    sections,
  });

  const markdownPreview = [
    `# ${title}`,
    "",
    ...sections.flatMap((s) => [`## ${s.heading}`, "", s.body, ""]),
  ].join("\n");

  const now = new Date().toISOString();
  const artifact: StoredArtifact = {
    id: newId(),
    threadId: input.threadId,
    messageId: input.messageId,
    title,
    format,
    formatStatus: ready ? "ready" : "disabled",
    disabledReason: ready
      ? null
      : (DISABLED_REASONS[format] ?? "未接続の形式です"),
    markdownPreview,
    version: 1,
    versions: [{ version: 1, markdownPreview, createdAt: now }],
    confidentialityLevel: label.confidentialityLevel,
    visibility: label.visibility ?? input.visibility,
    projectId: input.projectId ?? null,
    createdAt: now,
    updatedAt: now,
    subtype,
  };

  const s = store();
  s.artifacts.set(artifact.id, artifact);
  const list = s.byThread.get(input.threadId) ?? [];
  list.push(artifact.id);
  s.byThread.set(input.threadId, list);
  return artifact;
}

export function reviseArtifact(input: {
  artifactId: string;
  instruction: string;
}): StoredArtifact | null {
  const art = store().artifacts.get(input.artifactId);
  if (!art) return null;
  const now = new Date().toISOString();
  const nextPreview = `${art.markdownPreview}\n\n---\n\n### 修正 v${art.version + 1}\n\n${input.instruction}`;
  art.version += 1;
  art.markdownPreview = nextPreview;
  art.updatedAt = now;
  art.versions.push({
    version: art.version,
    markdownPreview: nextPreview,
    createdAt: now,
  });
  return art;
}

export function getArtifact(id: string) {
  return store().artifacts.get(id) ?? null;
}

export function listArtifactsForThread(threadId: string) {
  const ids = store().byThread.get(threadId) ?? [];
  return ids
    .map((id) => store().artifacts.get(id))
    .filter((a): a is StoredArtifact => Boolean(a));
}

export function listDocumentLibrary() {
  return [...store().artifacts.values()].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
}

export function __resetArtifactStoreForTests() {
  delete (globalThis as { __regaproArtifactStore?: Store }).__regaproArtifactStore;
}
