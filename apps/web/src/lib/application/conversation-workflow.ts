import type { ConfidentialityLevel, Visibility } from "@regapro/shared";
import {
  CONFIDENTIALITY_LABELS,
  compareConfidentiality,
  maxConfidentiality,
} from "@regapro/shared";
import {
  canAssignConfidentialityLevel,
  classifySensitiveContent,
} from "@regapro/security";
import {
  appendUserMessage,
  ensureAssistantReply,
  getThread,
  type StoredMessage,
  type StoredThread,
} from "@/lib/application/chat-service";
import { resolveSessionAccess } from "@/lib/data/dev-sample/memberships";
import {
  completeResearchDemo,
  createResearchRun,
  listResearchRunsForThread,
} from "@/lib/application/research-service";
import {
  createDocumentArtifactFromRequest,
} from "@/lib/application/artifact-service";
import {
  createFileObject,
  type FileObjectMeta,
} from "@/lib/application/file-object-service";
import {
  ASSISTANT_TOOL_TO_WORKFLOW,
  WORKFLOW_TITLES,
  WORKFLOW_TOOL_MAP,
  type StartConversationInput,
  type StartConversationResult,
  type WorkflowType,
} from "@/lib/application/workflow-types";

type ExtendedThread = StoredThread & {
  workflowType?: WorkflowType;
  documentSubtype?: "text" | "document" | "presentation";
  toolId?: string | null;
};

function newId() {
  return globalThis.crypto.randomUUID();
}

/**
 * Unified entry for home tools, TopBar create, workspace research/docs, assistant tools.
 */
export function startConversationWorkflow(
  input: StartConversationInput,
): StartConversationResult {
  const session = resolveSessionAccess({ userId: input.userId });
  const membership = session.membership;
  const workflowType = input.workflowType;
  const toolId = WORKFLOW_TOOL_MAP[workflowType];
  const content = input.initialMessage?.trim() ?? "";

  // Reuse chat store idempotency via start path when message present
  const s = getChatStore();

  if (input.idempotencyKey) {
    const hit = s.idempotency.get(input.idempotencyKey);
    if (hit) {
      const existing = s.threads.get(hit.threadId) as ExtendedThread | undefined;
      const runs = listResearchRunsForThread(hit.threadId);
      return {
        ok: true,
        threadId: hit.threadId,
        messageId: hit.messageId || null,
        researchRunId: runs[0]?.id ?? null,
        redirectTo: buildRedirect(hit.threadId, workflowType, Boolean(hit.messageId)),
        workflowType,
        toolId: existing?.toolId ?? toolId,
      };
    }
  }

  let level: ConfidentialityLevel = input.confidentialityLevel ?? "company";
  if (!canAssignConfidentialityLevel(session.access, level)) {
    return {
      ok: false,
      code: "LEVEL_DENIED",
      message: `選択できる情報区分は「${session.selectableLevels
        .map((l) => CONFIDENTIALITY_LABELS[l])
        .join(" / ")}」までです`,
      restoreContent: content,
    };
  }

  const visibility: Visibility = input.visibility ?? "private";
  const now = new Date().toISOString();
  const threadId = newId();

  let messageId: string | null = null;
  let classificationSignals: string[] = [];

  if (content) {
    const classification = classifySensitiveContent(content);
    classificationSignals = classification.matchedSignals;
    if (
      compareConfidentiality(classification.suggestedLevel, level) > 0 &&
      !canAssignConfidentialityLevel(session.access, classification.suggestedLevel)
    ) {
      return {
        ok: false,
        code: "PERMISSION_DENIED",
        message:
          "この内容は現在の権限では扱えません。所属の管理者へ相談してください。",
        restoreContent: content,
        suggestedLevel: classification.suggestedLevel,
      };
    }
    // Raise if classification suggests higher and user can
    if (
      compareConfidentiality(classification.suggestedLevel, level) > 0 &&
      canAssignConfidentialityLevel(session.access, classification.suggestedLevel)
    ) {
      level = maxConfidentiality(level, classification.suggestedLevel);
    }
  }

  const title = content
    ? titleFromContent(content)
    : WORKFLOW_TITLES[workflowType];

  const thread: ExtendedThread = {
    id: threadId,
    title,
    orgId: membership.organizationId,
    ownerUserId: membership.userId,
    departmentId: membership.departmentId,
    projectId: input.projectId ?? null,
    confidentialityLevel: level,
    visibility,
    securityLabelSource: "user",
    minimumDerivedLevel: level,
    containsSensitiveContent: classificationSignals.length > 0,
    createdAt: now,
    updatedAt: now,
    workflowType,
    documentSubtype: input.documentSubtype,
    toolId,
  };

  s.threads.set(threadId, thread);
  s.participants.set(threadId, new Set([membership.userId]));
  const messages: StoredMessage[] = [];

  if (content) {
    messageId = newId();
    messages.push({
      id: messageId,
      threadId,
      role: "user",
      content,
      createdAt: now,
      confidentialityLevel: level,
      visibility,
      classificationSource: "rule",
      sensitivitySignals: classificationSignals,
    });
  }
  s.messages.set(threadId, messages);

  if (input.idempotencyKey) {
    s.idempotency.set(input.idempotencyKey, {
      threadId,
      messageId: messageId ?? "",
    });
  }

  s.auditLogs.push({
    id: newId(),
    action: "workflow.started",
    at: now,
    meta: { threadId, workflowType, level },
  });

  let researchRunId: string | null = null;

  // Attach pending files to message / thread
  if (input.attachmentIds?.length) {
    for (const fid of input.attachmentIds) {
      createFileObject({
        id: fid,
        threadId,
        messageId,
        confidentialityLevel: level,
        visibility,
        name: "添付ファイル",
        mimeType: "application/octet-stream",
        sizeBytes: 0,
        storageMode: "dev-sample-ephemeral",
      });
    }
  }

  if (workflowType === "research" && content && messageId) {
    const run = createResearchRun({
      threadId,
      requestMessageId: messageId,
      purpose: content,
      confidentialityLevel: level,
      visibility,
      projectId: input.projectId,
      requestedBy: membership.userId,
      idempotencyKey: input.idempotencyKey
        ? `research:${input.idempotencyKey}`
        : undefined,
    });
    researchRunId = run.id;
    completeResearchDemo(run.id);
    ensureAssistantReply({
      threadId,
      userId: membership.userId,
      idempotencyKey: `reply:${threadId}:${messageId}`,
    });
  } else if (
    (workflowType === "document" ||
      workflowType === "code" ||
      workflowType === "prompt") &&
    content &&
    messageId
  ) {
    createDocumentArtifactFromRequest({
      threadId,
      messageId,
      request: content,
      confidentialityLevel: level,
      visibility,
      formatHint: input.outputFormat,
      subtype: input.documentSubtype,
      ownerUserId: membership.userId,
      departmentId: membership.departmentId,
      projectId: input.projectId ?? null,
    });
    ensureAssistantReply({
      threadId,
      userId: membership.userId,
      idempotencyKey: `reply:${threadId}:${messageId}`,
    });
  } else if (content && messageId) {
    ensureAssistantReply({
      threadId,
      userId: membership.userId,
      idempotencyKey: `reply:${threadId}:${messageId}`,
    });
  }

  return {
    ok: true,
    threadId,
    messageId,
    researchRunId,
    redirectTo: buildRedirect(threadId, workflowType, Boolean(messageId)),
    workflowType,
    toolId,
  };
}

function buildRedirect(
  threadId: string,
  workflowType: WorkflowType,
  hasMessage: boolean,
): string {
  const tool = WORKFLOW_TOOL_MAP[workflowType];
  const qs = new URLSearchParams();
  qs.set("thread", threadId);
  if (tool) qs.set("tool", tool);
  if (hasMessage) qs.set("started", "1");
  if (workflowType === "research" && !hasMessage) qs.set("focus", "1");
  return `/assistant?${qs.toString()}`;
}

function titleFromContent(content: string): string {
  const t = content.replace(/\s+/g, " ").trim();
  return t.length > 36 ? `${t.slice(0, 36)}…` : t || "新しい会話";
}

/** Access underlying chat store (same global as chat-service). */
function getChatStore(): {
  threads: Map<string, StoredThread>;
  messages: Map<string, StoredMessage[]>;
  participants: Map<string, Set<string>>;
  idempotency: Map<string, { threadId: string; messageId: string }>;
  auditLogs: { id: string; action: string; at: string; meta: Record<string, string> }[];
} {
  const g = globalThis as unknown as {
    __regaproChatStore?: {
      threads: Map<string, StoredThread>;
      messages: Map<string, StoredMessage[]>;
      participants: Map<string, Set<string>>;
      idempotency: Map<string, { threadId: string; messageId: string }>;
      auditLogs: {
        id: string;
        action: string;
        at: string;
        meta: Record<string, string>;
      }[];
    };
  };
  if (!g.__regaproChatStore) {
    // Force chat-service seed by importing side effect via getThread on dummy
    getThread("__init__");
  }
  return g.__regaproChatStore!;
}

/**
 * After a user message on a research/document thread, create ResearchRun or Artifact.
 */
export function processWorkflowAfterUserMessage(input: {
  threadId: string;
  messageId: string;
  content: string;
  userId?: string;
}): {
  researchRunId: string | null;
  artifactId: string | null;
} {
  const thread = getThread(input.threadId, input.userId) as ExtendedThread | null;
  if (!thread) return { researchRunId: null, artifactId: null };

  const workflow =
    thread.workflowType ??
    (thread.toolId ? ASSISTANT_TOOL_TO_WORKFLOW[thread.toolId] : undefined) ??
    "general";

  if (workflow === "research") {
    const existing = listResearchRunsForThread(input.threadId).find(
      (r) => r.requestMessageId === input.messageId,
    );
    if (existing) {
      return { researchRunId: existing.id, artifactId: null };
    }
    const run = createResearchRun({
      threadId: input.threadId,
      requestMessageId: input.messageId,
      purpose: input.content,
      confidentialityLevel: thread.confidentialityLevel,
      visibility: thread.visibility,
      projectId: thread.projectId,
      requestedBy: input.userId,
      idempotencyKey: `research-msg:${input.messageId}`,
    });
    completeResearchDemo(run.id);
    return { researchRunId: run.id, artifactId: null };
  }

  if (workflow === "document" || workflow === "code" || workflow === "prompt") {
    const art = createDocumentArtifactFromRequest({
      threadId: input.threadId,
      messageId: input.messageId,
      request: input.content,
      confidentialityLevel: thread.confidentialityLevel,
      visibility: thread.visibility,
      subtype: thread.documentSubtype,
      ownerUserId: thread.ownerUserId,
      departmentId: thread.departmentId,
      projectId: thread.projectId,
    });
    return { researchRunId: null, artifactId: art.id };
  }

  // Detect natural-language research / document intents on general threads
  if (/調べて|調査して|Webで|相場を/.test(input.content)) {
    const run = createResearchRun({
      threadId: input.threadId,
      requestMessageId: input.messageId,
      purpose: input.content,
      confidentialityLevel: thread.confidentialityLevel,
      visibility: thread.visibility,
      projectId: thread.projectId,
      idempotencyKey: `research-msg:${input.messageId}`,
    });
    completeResearchDemo(run.id);
    return { researchRunId: run.id, artifactId: null };
  }

  if (
    /議事録|Word|Excel|PowerPoint|資料にして|提案資料|文面/.test(input.content)
  ) {
    const art = createDocumentArtifactFromRequest({
      threadId: input.threadId,
      messageId: input.messageId,
      request: input.content,
      confidentialityLevel: thread.confidentialityLevel,
      visibility: thread.visibility,
      ownerUserId: thread.ownerUserId,
      departmentId: thread.departmentId,
      projectId: thread.projectId,
    });
    return { researchRunId: null, artifactId: art.id };
  }

  return { researchRunId: null, artifactId: null };
}

export function setThreadWorkflow(
  threadId: string,
  workflowType: WorkflowType,
  documentSubtype?: "text" | "document" | "presentation",
) {
  const s = getChatStore();
  const t = s.threads.get(threadId) as ExtendedThread | undefined;
  if (!t) return;
  t.workflowType = workflowType;
  t.toolId = WORKFLOW_TOOL_MAP[workflowType];
  if (documentSubtype) t.documentSubtype = documentSubtype;
}

export function attachFileToThread(input: {
  threadId: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  messageId?: string | null;
}): FileObjectMeta | { ok: false; message: string } {
  const thread = getThread(input.threadId);
  if (!thread) return { ok: false, message: "会話が見つかりません" };
  return createFileObject({
    threadId: input.threadId,
    messageId: input.messageId ?? null,
    confidentialityLevel: thread.confidentialityLevel,
    visibility: thread.visibility,
    name: input.name,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    storageMode: "dev-sample-ephemeral",
  });
}

export { appendUserMessage };
