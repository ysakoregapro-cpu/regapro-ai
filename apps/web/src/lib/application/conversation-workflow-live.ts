import "server-only";
import type { ConfidentialityLevel, Visibility } from "@regapro/shared";
import {
  CONFIDENTIALITY_LABELS,
  compareConfidentiality,
  maxConfidentiality,
} from "@regapro/shared";
import {
  canAssignConfidentialityLevel,
  canLowerResourceLevel,
  classifySensitiveContent,
  createInheritedChildLabel,
} from "@regapro/security";
import { resolveAppSession } from "@/lib/application/session-access";
import {
  type InheritedResource,
  type StartChatInput,
  type StartChatResult,
  type StoredMessage,
  type StoredThread,
} from "@/lib/application/chat-service";
import {
  getSupabaseWorkUnitPersistence,
  isUuid,
} from "@/lib/data/persistence";
import type {
  StartConversationInput,
  StartConversationResult,
  WorkflowType,
} from "@/lib/application/workflow-types";
import {
  ASSISTANT_TOOL_TO_WORKFLOW,
  WORKFLOW_TITLES,
  WORKFLOW_TOOL_MAP,
} from "@/lib/application/workflow-types";
import type { ResearchRun } from "@/lib/application/research-service";
import { buildResearchAnswer } from "@/lib/application/research-service";
import {
  assertNoSensitiveInExternalQueries,
  sanitizeExternalQuery,
} from "@/lib/application/external-query-sanitizer";
import type { StoredArtifact } from "@/lib/application/artifact-service";
import type { FileObjectMeta } from "@/lib/application/file-object-service";
import { validateFileUpload } from "@/lib/application/file-object-service";

function newId() {
  return globalThis.crypto.randomUUID();
}

function titleFromContent(content: string): string {
  const t = content.replace(/\s+/g, " ").trim();
  return t.length > 36 ? `${t.slice(0, 36)}…` : t || "新しい会話";
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

function projectIdOrNull(raw: string | null | undefined): string | null {
  return isUuid(raw) ? raw! : null;
}

type Persist = Awaited<ReturnType<typeof getSupabaseWorkUnitPersistence>>;

/**
 * Supabase-backed conversation start. Dev-sample keeps startConversationWorkflow.
 */
export async function startConversationWorkflowLive(
  input: StartConversationInput,
): Promise<StartConversationResult> {
  const session = await resolveAppSession({ userId: input.userId });
  const membership = session.membership;
  const persist = await getSupabaseWorkUnitPersistence();
  const workflowType = input.workflowType;
  const toolId = WORKFLOW_TOOL_MAP[workflowType];
  const content = input.initialMessage?.trim() ?? "";

  if (input.idempotencyKey) {
    const hit = await persist.chat.findIdempotency(input.idempotencyKey);
    if (hit) {
      const runs = await persist.research.listByThread(hit.threadId);
      return {
        ok: true,
        threadId: hit.threadId,
        messageId: hit.messageId || null,
        researchRunId: runs[0]?.id ?? null,
        redirectTo: buildRedirect(hit.threadId, workflowType, Boolean(hit.messageId)),
        workflowType,
        toolId,
      };
    }
  }

  const level: ConfidentialityLevel = input.confidentialityLevel ?? "company";
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
    classificationSignals = classification.matchedSignals.map(String);
    // Domain/topic words are not clearance. Retrieve at the requested AccessContext.
  }

  const title = content ? titleFromContent(content) : WORKFLOW_TITLES[workflowType];

  const thread: StoredThread = {
    id: threadId,
    title,
    orgId: membership.organizationId,
    ownerUserId: membership.userId,
    departmentId: isUuid(membership.departmentId) ? membership.departmentId : null,
    projectId: projectIdOrNull(input.projectId),
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

  await persist.chat.createThread(thread, membership.userId);

  if (content) {
    messageId = newId();
    const message: StoredMessage = {
      id: messageId,
      threadId,
      role: "user",
      content,
      createdAt: now,
      confidentialityLevel: level,
      visibility,
      classificationSource: "rule",
      sensitivitySignals: classificationSignals,
    };
    await persist.chat.appendMessage(message, membership.userId);
  }

  if (input.idempotencyKey) {
    await persist.chat.saveIdempotency(input.idempotencyKey, {
      threadId,
      messageId: messageId ?? "",
    });
  }

  if (input.attachmentIds?.length) {
    // Attachments must already exist via /api/files upload (bytes + metadata).
    // Do not create metadata-only placeholder rows.
    for (const fid of input.attachmentIds) {
      if (!isUuid(fid)) continue;
      const existing = await persist.files.get(fid);
      if (!existing) {
        throw new Error("ATTACHMENT_NOT_FOUND");
      }
    }
  }

  let researchRunId: string | null = null;
  let researchRun: ResearchRun | null = null;
  let artifact: StoredArtifact | null = null;

  if (workflowType === "research" && content && messageId) {
    researchRun = await createAndCompleteResearch(persist, {
      threadId,
      messageId,
      content,
      level,
      visibility,
      projectId: thread.projectId,
      orgId: membership.organizationId,
      userId: membership.userId,
      idempotencyKey: input.idempotencyKey
        ? `research:${input.idempotencyKey}`
        : undefined,
    });
    researchRunId = researchRun.id;
  } else if (
    (workflowType === "document" ||
      workflowType === "code" ||
      workflowType === "prompt") &&
    content &&
    messageId
  ) {
    artifact = await createArtifactLive(persist, {
      threadId,
      messageId,
      content,
      level,
      visibility,
      orgId: membership.organizationId,
      userId: membership.userId,
      departmentId: thread.departmentId,
      projectId: thread.projectId,
      subtype: input.documentSubtype,
    });
  }

  if (content && messageId) {
    await writeAssistantReply(persist, {
      threadId,
      userId: membership.userId,
      level,
      visibility,
      idempotencyKey: `reply:${threadId}:${messageId}`,
      researchRun,
      artifact,
      workflowType,
    });
  }

  if (workflowType === "task" && content && messageId) {
    await createDerivedTaskLive(persist, {
      thread,
      messageId,
      content,
      orgId: membership.organizationId,
      userId: membership.userId,
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

export async function startChatFromHomeLive(
  input: StartChatInput,
): Promise<StartChatResult> {
  const content = input.content.trim();
  if (!content) {
    return {
      ok: false,
      code: "EMPTY",
      message: "内容を入力してください",
      restoreContent: input.content,
    };
  }

  const session = await resolveAppSession({ userId: input.userId });
  const persist = await getSupabaseWorkUnitPersistence();
  const classification = classifySensitiveContent(content);

  if (input.idempotencyKey) {
    const hit = await persist.chat.findIdempotency(input.idempotencyKey);
    if (hit && hit.messageId) {
      return {
        ok: true,
        threadId: hit.threadId,
        messageId: hit.messageId,
        redirectTo: `/assistant?thread=${hit.threadId}&started=1`,
        classification,
      };
    }
  }

  const level = input.requestedLevel;

  if (!canAssignConfidentialityLevel(session.access, level)) {
    return {
      ok: false,
      code: "LEVEL_DENIED",
      message: `選択できる情報区分は「${session.selectableLevels
        .map((l) => CONFIDENTIALITY_LABELS[l])
        .join(" / ")}」までです`,
      restoreContent: content,
      classification,
    };
  }

  const started = await startConversationWorkflowLive({
    workflowType: "general",
    initialMessage: content,
    confidentialityLevel: level,
    idempotencyKey: input.idempotencyKey,
    userId: input.userId,
  });

  if (!started.ok || !started.messageId) {
    return {
      ok: false,
      code: "PERMISSION_DENIED",
      message: started.ok ? "メッセージを保存できませんでした" : started.message,
      restoreContent: content,
      classification,
    };
  }

  return {
    ok: true,
    threadId: started.threadId,
    messageId: started.messageId,
    redirectTo: started.redirectTo,
    classification,
  };
}

export async function listVisibleThreadsLive(): Promise<StoredThread[]> {
  const persist = await getSupabaseWorkUnitPersistence();
  return persist.chat.listThreads();
}

export async function getThreadBundleLive(threadId: string) {
  const persist = await getSupabaseWorkUnitPersistence();
  const thread = await persist.chat.getThread(threadId);
  if (!thread) return null;
  const messages = await persist.chat.listMessages(threadId);
  return { thread, messages };
}

export async function appendUserMessageLive(input: {
  threadId: string;
  content: string;
  userId?: string;
}): Promise<
  | { ok: true; message: StoredMessage; messages: StoredMessage[] }
  | { ok: false; code: "THREAD_NOT_FOUND" | "EMPTY"; message: string }
> {
  const content = input.content.trim();
  if (!content) {
    return { ok: false, code: "EMPTY", message: "内容を入力してください" };
  }

  const session = await resolveAppSession({ userId: input.userId });
  const persist = await getSupabaseWorkUnitPersistence();
  const thread = await persist.chat.getThread(input.threadId);
  if (!thread) {
    return { ok: false, code: "THREAD_NOT_FOUND", message: "会話が見つかりません" };
  }

  const message: StoredMessage = {
    id: newId(),
    threadId: input.threadId,
    role: "user",
    content,
    createdAt: new Date().toISOString(),
    confidentialityLevel: thread.confidentialityLevel,
    visibility: thread.visibility,
  };
  await persist.chat.appendMessage(message, session.membership.userId);
  const messages = await persist.chat.listMessages(input.threadId);
  return { ok: true, message, messages };
}

export async function ensureAssistantReplyLive(input: {
  threadId: string;
  userId?: string;
  idempotencyKey?: string;
}): Promise<
  | {
      ok: true;
      message: StoredMessage;
      created: boolean;
      messages: StoredMessage[];
    }
  | {
      ok: false;
      code: "THREAD_NOT_FOUND" | "NO_USER_MESSAGE";
      message: string;
    }
> {
  const session = await resolveAppSession({ userId: input.userId });
  const persist = await getSupabaseWorkUnitPersistence();
  const thread = await persist.chat.getThread(input.threadId);
  if (!thread) {
    return { ok: false, code: "THREAD_NOT_FOUND", message: "会話が見つかりません" };
  }

  const messages = await persist.chat.listMessages(input.threadId);
  const last = messages[messages.length - 1];
  if (last?.role === "assistant") {
    return { ok: true, message: last, created: false, messages };
  }

  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  if (!lastUser) {
    return {
      ok: false,
      code: "NO_USER_MESSAGE",
      message: "ユーザーのメッセージがありません",
    };
  }

  const replyKey =
    input.idempotencyKey ?? `reply:${input.threadId}:${lastUser.id}`;
  const existingId = await persist.chat.findReplyIdempotency(replyKey);
  if (existingId) {
    const existing = messages.find((m) => m.id === existingId);
    if (existing) {
      return { ok: true, message: existing, created: false, messages };
    }
  }

  const researchRuns = await persist.research.listByThread(input.threadId);
  const artifacts = await persist.artifacts.listByThread(input.threadId);
  await writeAssistantReply(persist, {
    threadId: input.threadId,
    userId: session.membership.userId,
    level: thread.confidentialityLevel,
    visibility: thread.visibility,
    idempotencyKey: replyKey,
    researchRun: researchRuns[0] ?? null,
    artifact: artifacts[0] ?? null,
    workflowType: thread.workflowType,
    userText: lastUser.content,
  });

  const next = await persist.chat.listMessages(input.threadId);
  const assistant = next[next.length - 1];
  if (!assistant || assistant.role !== "assistant") {
    return {
      ok: false,
      code: "NO_USER_MESSAGE",
      message: "応答を作成できませんでした",
    };
  }
  return { ok: true, message: assistant, created: true, messages: next };
}

export async function processWorkflowAfterUserMessageLive(input: {
  threadId: string;
  messageId: string;
  content: string;
  userId?: string;
}): Promise<{ researchRunId: string | null; artifactId: string | null }> {
  const session = await resolveAppSession({ userId: input.userId });
  const persist = await getSupabaseWorkUnitPersistence();
  const thread = await persist.chat.getThread(input.threadId);
  if (!thread) return { researchRunId: null, artifactId: null };

  const workflow: WorkflowType =
    thread.workflowType ??
    (thread.toolId ? ASSISTANT_TOOL_TO_WORKFLOW[thread.toolId] : undefined) ??
    "general";

  if (workflow === "research" || /調べて|調査して|Webで|相場を/.test(input.content)) {
    const existing = (await persist.research.listByThread(input.threadId)).find(
      (r) => r.requestMessageId === input.messageId,
    );
    if (existing) return { researchRunId: existing.id, artifactId: null };

    const run = await createAndCompleteResearch(persist, {
      threadId: input.threadId,
      messageId: input.messageId,
      content: input.content,
      level: thread.confidentialityLevel,
      visibility: thread.visibility,
      projectId: thread.projectId,
      orgId: session.membership.organizationId,
      userId: session.membership.userId,
      idempotencyKey: `research-msg:${input.messageId}`,
    });
    return { researchRunId: run.id, artifactId: null };
  }

  if (
    workflow === "document" ||
    workflow === "code" ||
    workflow === "prompt" ||
    /議事録|Word|Excel|PowerPoint|資料にして|提案資料|文面/.test(input.content)
  ) {
    const art = await createArtifactLive(persist, {
      threadId: input.threadId,
      messageId: input.messageId,
      content: input.content,
      level: thread.confidentialityLevel,
      visibility: thread.visibility,
      orgId: session.membership.organizationId,
      userId: session.membership.userId,
      departmentId: thread.departmentId,
      projectId: thread.projectId,
      subtype: thread.documentSubtype,
    });
    return { researchRunId: null, artifactId: art.id };
  }

  return { researchRunId: null, artifactId: null };
}

export async function createDerivedResourceLive(input: {
  threadId: string;
  messageId?: string;
  kind: InheritedResource["kind"];
  title: string;
  userId?: string;
}): Promise<InheritedResource> {
  const session = await resolveAppSession({ userId: input.userId });
  const persist = await getSupabaseWorkUnitPersistence();
  const thread = await persist.chat.getThread(input.threadId);
  if (!thread) throw new Error("THREAD_NOT_FOUND");

  const label = createInheritedChildLabel(
    {
      confidentialityLevel: thread.confidentialityLevel,
      visibility: thread.visibility,
      ownerUserId: thread.ownerUserId,
      departmentId: thread.departmentId,
      projectId: thread.projectId,
    },
    { threadId: thread.id, messageId: input.messageId },
  );

  const resource: InheritedResource = {
    id: newId(),
    kind: input.kind,
    title: input.title,
    confidentialityLevel: label.confidentialityLevel,
    visibility: label.visibility ?? "private",
    originThreadId: thread.id,
    originMessageId: input.messageId ?? null,
    securityLabelSource: "inherited",
    minimumDerivedLevel: label.minimumDerivedLevel ?? label.confidentialityLevel,
  };

  await persist.derived.create(resource);

  if (input.kind === "task") {
    const now = new Date().toISOString();
    await persist.tasks.create({
      id: resource.id,
      orgId: session.membership.organizationId,
      title: input.title,
      description: null,
      status: "open",
      projectId: thread.projectId,
      createdBy: session.membership.userId,
      confidentialityLevel: resource.confidentialityLevel,
      visibility: resource.visibility,
      originThreadId: thread.id,
      originMessageId: resource.originMessageId,
      createdAt: now,
      updatedAt: now,
    });
  }

  if (input.kind === "artifact") {
    await createArtifactLive(persist, {
      threadId: thread.id,
      messageId: resource.originMessageId ?? newId(),
      content: input.title,
      level: resource.confidentialityLevel,
      visibility: resource.visibility,
      orgId: session.membership.organizationId,
      userId: session.membership.userId,
      departmentId: thread.departmentId,
      projectId: thread.projectId,
    });
  }

  if (input.kind === "research") {
    await createAndCompleteResearch(persist, {
      threadId: thread.id,
      messageId: resource.originMessageId ?? newId(),
      content: input.title,
      level: resource.confidentialityLevel,
      visibility: resource.visibility,
      projectId: thread.projectId,
      orgId: session.membership.organizationId,
      userId: session.membership.userId,
      idempotencyKey: `derived-research:${resource.id}`,
    });
  }

  if (input.kind === "knowledge_candidate") {
    const { createServerSupabaseClient } = await import("@/lib/supabase/server");
    const { captureConversationCandidate } = await import(
      "@/lib/application/knowledge-factory-service"
    );
    const messages = await persist.chat.listMessages(thread.id);
    const assistant =
      [...messages].reverse().find((m) => m.role === "assistant") ?? null;
    const user =
      [...messages].reverse().find((m) => m.role === "user") ?? null;
    const client = await createServerSupabaseClient();
    await captureConversationCandidate(client, {
      access: session.access,
      threadId: thread.id,
      messageId: input.messageId ?? assistant?.id ?? null,
      userQuestion: user?.content ?? input.title,
      assistantAnswer: assistant?.content ?? "",
      evidenceTitles: (assistant?.citations ?? []).map((c) => c.title),
      instruction: input.title || "ナレッジ候補",
      visibility: thread.visibility,
      containsPersonalConversation: thread.visibility === "private",
    });
  }

  return resource;
}

export async function changeThreadLevelLive(input: {
  threadId: string;
  newLevel: ConfidentialityLevel;
  userId?: string;
}): Promise<{ ok: true } | { ok: false; message: string; advice?: string }> {
  const session = await resolveAppSession({
    userId: input.userId,
    threadLevel: input.newLevel,
  });
  const persist = await getSupabaseWorkUnitPersistence();
  const thread = await persist.chat.getThread(input.threadId);
  if (!thread || thread.ownerUserId !== session.membership.userId) {
    return { ok: false, message: "この会話を変更する権限がありません" };
  }
  if (!canAssignConfidentialityLevel(session.access, input.newLevel)) {
    return { ok: false, message: "その情報区分は選択できません" };
  }

  const messages = await persist.chat.listMessages(thread.id);
  const derived = await persist.derived.listByThread(thread.id);
  const childLevels = [
    ...messages.map((m) => m.confidentialityLevel),
    ...derived.map((r) => r.confidentialityLevel),
    thread.minimumDerivedLevel,
  ];
  const lower = canLowerResourceLevel({
    currentLevel: thread.confidentialityLevel,
    newLevel: input.newLevel,
    derivedMinimum: thread.minimumDerivedLevel,
    childLevels,
  });
  if (!lower.allowed) {
    return { ok: false, message: lower.advice, advice: lower.advice };
  }

  const raised =
    compareConfidentiality(input.newLevel, thread.confidentialityLevel) > 0;
  thread.confidentialityLevel = input.newLevel;
  if (raised) {
    thread.minimumDerivedLevel = maxConfidentiality(
      thread.minimumDerivedLevel,
      input.newLevel,
    );
  }
  thread.updatedAt = new Date().toISOString();
  await persist.chat.updateThread(thread);
  return { ok: true };
}

export async function listFilesForThreadLive(threadId: string) {
  const persist = await getSupabaseWorkUnitPersistence();
  return persist.files.listByThread(threadId);
}

export async function attachFileToThreadLive(input: {
  threadId: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  content: Uint8Array;
  userId?: string;
  idempotencyKey?: string;
}): Promise<FileObjectMeta | { ok: false; message: string }> {
  const check = validateFileUpload({
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
  });
  if (!check.ok) return check;
  if (!input.content?.byteLength) {
    return { ok: false, message: "ファイル本体が必要です" };
  }

  const session = await resolveAppSession({ userId: input.userId });
  const persist = await getSupabaseWorkUnitPersistence();
  const thread = await persist.chat.getThread(input.threadId);
  if (!thread) return { ok: false, message: "会話が見つかりません" };

  const fileId =
    input.idempotencyKey && isUuid(input.idempotencyKey)
      ? input.idempotencyKey
      : newId();

  return persist.files.create(
    {
      id: fileId,
      threadId: input.threadId,
      messageId: null,
      name: input.name,
      originalFilename: input.name,
      mimeType: input.mimeType,
      sizeBytes: input.content.byteLength,
      confidentialityLevel: thread.confidentialityLevel,
      visibility: thread.visibility,
      storageMode: "supabase",
      createdAt: new Date().toISOString(),
      ephemeralNotice: null,
      durable: true,
    },
    {
      orgId: session.membership.organizationId,
      createdBy: session.membership.userId,
      content: input.content,
    },
  );
}

export async function reviseArtifactLive(input: {
  artifactId: string;
  instruction: string;
}): Promise<StoredArtifact | null> {
  const persist = await getSupabaseWorkUnitPersistence();
  const art = await persist.artifacts.get(input.artifactId);
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
  return persist.artifacts.update(art);
}

async function writeAssistantReply(
  persist: Persist,
  input: {
    threadId: string;
    userId: string;
    level: ConfidentialityLevel;
    visibility: Visibility;
    idempotencyKey: string;
    researchRun?: ResearchRun | null;
    artifact?: StoredArtifact | null;
    workflowType?: StoredThread["workflowType"];
    userText?: string;
  },
) {
  const existing = await persist.chat.findReplyIdempotency(input.idempotencyKey);
  if (existing) return;

  const messages = await persist.chat.listMessages(input.threadId);
  const lastUser =
    input.userText ??
    [...messages].reverse().find((m) => m.role === "user")?.content ??
    "";

  const session = await resolveAppSession({ userId: input.userId });
  const { generateAssistantAnswer, workflowToAnswerIntent } = await import(
    "@/lib/application/ai-answer-service"
  );

  const researchSummary = input.researchRun
    ? buildResearchAnswer(input.researchRun)
    : null;
  const artifactSummary = input.artifact
    ? [
        `「${input.artifact.title}」の資料作成を進めました。`,
        "",
        input.artifact.formatStatus === "ready"
          ? `Markdown下書きを成果物として保存しました（v${input.artifact.version}）。`
          : `${input.artifact.disabledReason ?? "この形式は未接続です"}。代わりにMarkdown下書きを右ペインに表示しています。`,
        "",
        "同じチャットから修正指示を送るとVersionが増えます。",
      ].join("\n")
    : null;

  const answer = await generateAssistantAnswer({
    access: {
      ...session.access,
      threadConfidentialityLevel: input.level,
      threadVisibility: input.visibility,
    },
    threadId: input.threadId,
    messageId: null,
    userText: lastUser,
    workflowHint: workflowToAnswerIntent(input.workflowType),
    hints: { researchSummary, artifactSummary },
  });

  try {
    const { isKnowledgeCaptureUtterance } = await import("@regapro/knowledge");
    if (isKnowledgeCaptureUtterance(lastUser)) {
      const { createServerSupabaseClient } = await import("@/lib/supabase/server");
      const { captureConversationCandidate } = await import(
        "@/lib/application/knowledge-factory-service"
      );
      const prevAssistant = [...messages]
        .reverse()
        .find((m) => m.role === "assistant");
      const prevUser = [...messages]
        .reverse()
        .find((m) => m.role === "user" && m.content !== lastUser);
      const client = await createServerSupabaseClient();
      await captureConversationCandidate(client, {
        access: session.access,
        threadId: input.threadId,
        messageId: prevAssistant?.id ?? null,
        userQuestion: prevUser?.content ?? lastUser,
        assistantAnswer: prevAssistant?.content ?? answer.text,
        evidenceTitles: (prevAssistant?.citations ?? []).map((c) => c.title),
        instruction: lastUser,
        visibility: input.visibility,
        containsPersonalConversation: input.visibility === "private",
      });
    }
  } catch (err) {
    console.error("[knowledge-factory] capture skipped", err);
  }

  const messageId = newId();
  await persist.chat.appendMessage(
    {
      id: messageId,
      threadId: input.threadId,
      role: "assistant",
      content: answer.text,
      createdAt: new Date().toISOString(),
      confidentialityLevel: input.level,
      visibility: input.visibility,
      classificationSource: answer.model.connected ? "llm" : "template",
      citations: answer.citations.map((c) => ({
        id: c.id,
        title: c.title,
        source: c.sourceType,
        excerpt: c.excerpt,
        uri: c.uri,
        provenance: c.provenance,
        documentId: c.sourceId,
      })),
    },
    input.userId,
  );

  try {
    const { createServerSupabaseClient } = await import("@/lib/supabase/server");
    const { persistMessageCitations } = await import(
      "@/lib/application/citation-persistence"
    );
    const client = await createServerSupabaseClient();
    const persisted = await persistMessageCitations(client, {
      messageId,
      citations: answer.citations,
    });
    const { recordAnswerDiagnostic } = await import("@regapro/ai-runtime");
    recordAnswerDiagnostic({
      intent: answer.intent.intent,
      needInternal: answer.retrievalPlan.needInternalKnowledge,
      needWeb: answer.retrievalPlan.needWeb,
      needDeepResearch: answer.retrievalPlan.needDeepResearch,
      internalCount: answer.retrieval.internalCount,
      webCount: answer.retrieval.webCount,
      researchCount: answer.retrieval.researchCount,
      contextCount: answer.retrieval.contextCount,
      citationCount: answer.citations.length,
      citationPersistCount: persisted,
      sanitizedQueryCount: answer.retrieval.sanitizedQueryCount,
      pagesFetched: answer.retrieval.pagesFetched,
      browserSessions: answer.retrieval.browserSessions ?? 0,
      modelRole: answer.model.role ?? null,
      modelId: answer.model.modelId,
      modelProvider: answer.model.providerId,
      success: true,
      failureStage: null,
      fallbackReason: answer.model.connected ? null : "no_connected_provider",
      providerRequestResult: answer.model.connected ? "ok" : "fallback",
      modelConnected: answer.model.connected,
    });
  } catch (err) {
    console.error("[citations] write skipped", err);
  }

  await persist.chat.saveReplyIdempotency(input.idempotencyKey, messageId);
}

async function createAndCompleteResearch(
  persist: Persist,
  input: {
    threadId: string;
    messageId: string;
    content: string;
    level: ConfidentialityLevel;
    visibility: Visibility;
    projectId: string | null;
    orgId: string;
    userId: string;
    idempotencyKey?: string;
  },
): Promise<ResearchRun> {
  if (input.idempotencyKey) {
    const hit = await persist.research.findByIdempotencyKey(input.idempotencyKey);
    if (hit) return hit;
  }

  const now = new Date().toISOString();
  try {
  const plan = sanitizeExternalQuery({
    request: input.content,
    confidentialityLevel: input.level,
  });
  assertNoSensitiveInExternalQueries(plan);

  const {
    createWebIntelligenceDeps,
    DefaultWebResearchProvider,
    DEFAULT_WEB_BUDGET,
  } = await import("@regapro/web-intelligence");
  const deps = createWebIntelligenceDeps(process.env);
  const connected = deps.search.connected && plan.externalTransmissionAllowed;

  let sources: ResearchRun["sources"] = [];
  let findings: string[] = [];
  let citations: ResearchRun["citations"] = [];
  const isDemo = false;
  const provider: ResearchRun["provider"] = connected ? "web-intelligence" : "http";
  const processingMetadata: Record<string, string> = {
    mode: "supabase",
    webConnected: String(deps.search.connected),
    externalAllowed: String(plan.externalTransmissionAllowed),
    tavily: String(deps.search.connected),
    firecrawl: String(deps.content.connected),
    browserbase: String(deps.browser.connected),
  };
  let errorCode: string | null = null;
  let errorMessage: string | null = null;

  if (connected) {
    const researcher = new DefaultWebResearchProvider(deps);
    const result = await researcher.research({
      plan,
      confidentialityLevel: input.level,
      budget: {
        ...DEFAULT_WEB_BUDGET,
        timeoutMs: 50_000,
        maxQueries: 3,
        maxFetchedPages: 3,
        maxBrowserSessions: 0,
      },
      needPageBodies: true,
      allowBrowserEscalation: false,
    });
    sources = result.sources.map((s) => ({
      id: s.id,
      title: s.title,
      note: s.domain,
    }));
    findings = result.evidence.map((e) => e.claim).filter(Boolean);
    citations = result.sources.map((s) => ({
      id: s.id,
      title: s.citation.title,
      publisher: s.domain,
      url: s.canonicalUrl,
      publishedAt: s.publishedAt,
      retrievedAt: s.retrievedAt,
      excerpt: s.citation.excerpt,
      confidence: Math.min(1, s.relevance),
      confidentialityLevel: "company",
    }));
    if (findings.length === 0 && result.sources.length === 0) {
      findings = ["公開情報は見つかりませんでした。"];
    }
    processingMetadata.pagesFetched = String(result.pagesFetched);
    processingMetadata.queriesUsed = String(result.queriesUsed.length);
    processingMetadata.browserSessions = String(result.browserSessions);

    if (result.sources.length > 0) {
      try {
        const { createServerSupabaseClient } = await import("@/lib/supabase/server");
        const { createKnowledgeCandidateFromResearch } = await import(
          "@/lib/application/knowledge-candidate-service"
        );
        const { resolveAppSession } = await import("@/lib/application/session-access");
        const client = await createServerSupabaseClient();
        const session = await resolveAppSession({});
        await createKnowledgeCandidateFromResearch(client, {
          orgId: input.orgId,
          userId: input.userId,
          access: session.access,
          threadId: input.threadId,
          messageId: input.messageId,
          title: `公開情報の候補 ${new Date().toISOString().slice(0, 10)}`,
          content: result.sources
            .slice(0, 5)
            .map((s) => `${s.title}\n${s.canonicalUrl}\n${s.snippet}`)
            .join("\n\n"),
          confidentialityLevel: "company",
          fromPrivateConversation: input.visibility === "private",
          url: result.sources[0]?.canonicalUrl ?? null,
          retrievedAt: result.sources[0]?.retrievedAt ?? null,
        });
      } catch {
        // Candidate write is optional; research result still stands.
      }
    }
  } else {
    if (!deps.search.connected) {
      errorCode = "WEB_SEARCH_UNCONFIGURED";
      errorMessage = "Web検索が未接続のため、外部調査は実行していません。";
    } else if (!plan.externalTransmissionAllowed) {
      errorCode = "EXTERNAL_QUERY_BLOCKED";
      errorMessage =
        "この依頼では外部へ検索クエリを送れないため、Web調査は実行していません。";
    } else {
      errorCode = "WEB_SEARCH_EMPTY";
      errorMessage = "公開情報は見つかりませんでした。";
    }
    findings = [errorMessage];
  }

  const run: ResearchRun = {
    id: newId(),
    threadId: input.threadId,
    requestMessageId: input.messageId,
    organizationId: input.orgId,
    requestedBy: input.userId,
    confidentialityLevel: input.level,
    visibility: input.visibility,
    projectId: input.projectId,
    status: errorCode ? "failed" : "completed",
    purpose: input.content,
    queries: plan.sanitizedQueries,
    queryPlan: plan,
    sources,
    findings,
    citations,
    resultArtifactId: null,
    startedAt: now,
    completedAt: errorCode ? null : now,
    failedAt: errorCode ? now : null,
    provider,
    isDemo,
    errorCode,
    errorMessage,
    processingMetadata,
    title: input.content.slice(0, 40) || "調査",
    demoNoticeShown: isDemo,
  };

  await persist.research.create(run);
  if (input.idempotencyKey) {
    await persist.research.saveIdempotency(input.idempotencyKey, run.id);
  }
  return run;
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 80) : "WEB_SEARCH_FAILED";
    const failed: ResearchRun = {
      id: newId(),
      threadId: input.threadId,
      requestMessageId: input.messageId,
      organizationId: input.orgId,
      requestedBy: input.userId,
      confidentialityLevel: input.level,
      visibility: input.visibility,
      projectId: input.projectId,
      status: "failed",
      purpose: input.content,
      queries: [],
      queryPlan: null,
      sources: [],
      findings: [`Web検索を実行できませんでした（${message}）。検索したようには装っていません。`],
      citations: [],
      resultArtifactId: null,
      startedAt: now,
      completedAt: null,
      failedAt: now,
      provider: "http",
      isDemo: false,
      errorCode: message,
      errorMessage: message,
      processingMetadata: { mode: "supabase" },
      title: input.content.slice(0, 40) || "調査",
      demoNoticeShown: false,
    };
    await persist.research.create(failed);
    return failed;
  }
}

async function createArtifactLive(
  persist: Persist,
  input: {
    threadId: string;
    messageId: string;
    content: string;
    level: ConfidentialityLevel;
    visibility: Visibility;
    orgId: string;
    userId: string;
    departmentId: string | null;
    projectId: string | null;
    subtype?: "text" | "document" | "presentation";
  },
): Promise<StoredArtifact> {
  const label = createInheritedChildLabel(
    {
      confidentialityLevel: input.level,
      visibility: input.visibility,
      ownerUserId: input.userId,
      departmentId: input.departmentId,
      projectId: input.projectId,
    },
    { threadId: input.threadId, messageId: input.messageId },
  );
  const now = new Date().toISOString();
  const title =
    input.content.replace(/\s+/g, " ").trim().slice(0, 40) || "新しい資料";
  const subtype = input.subtype ?? "document";
  const sections = [
    {
      heading: "概要",
      body: `依頼「${input.content.slice(0, 120)}」に基づく下書きです。`,
    },
    {
      heading: "本文",
      body:
        subtype === "text"
          ? "ここに本文の下書きが入ります。同じチャットから修正依頼できます。"
          : "構成案を同じ会話から調整できます。",
    },
  ];
  const markdownPreview = [
    `# ${title}`,
    "",
    ...sections.flatMap((s) => [`## ${s.heading}`, "", s.body, ""]),
  ].join("\n");

  const artifact: StoredArtifact = {
    id: newId(),
    threadId: input.threadId,
    messageId: input.messageId,
    title,
    format: "markdown",
    formatStatus: "ready",
    disabledReason: null,
    markdownPreview,
    version: 1,
    versions: [{ version: 1, markdownPreview, createdAt: now }],
    confidentialityLevel: label.confidentialityLevel,
    visibility: label.visibility ?? input.visibility,
    projectId: input.projectId,
    createdAt: now,
    updatedAt: now,
    subtype,
  };

  return persist.artifacts.create(artifact, input.orgId, input.userId);
}

async function createDerivedTaskLive(
  persist: Persist,
  input: {
    thread: StoredThread;
    messageId: string;
    content: string;
    orgId: string;
    userId: string;
  },
) {
  const label = createInheritedChildLabel(
    {
      confidentialityLevel: input.thread.confidentialityLevel,
      visibility: input.thread.visibility,
      ownerUserId: input.userId,
      departmentId: input.thread.departmentId,
      projectId: input.thread.projectId,
    },
    { threadId: input.thread.id, messageId: input.messageId },
  );
  const now = new Date().toISOString();
  const taskId = newId();
  await persist.tasks.create({
    id: taskId,
    orgId: input.orgId,
    title: titleFromContent(input.content),
    description: input.content,
    status: "open",
    projectId: input.thread.projectId,
    createdBy: input.userId,
    confidentialityLevel: label.confidentialityLevel,
    visibility: label.visibility ?? input.thread.visibility,
    originThreadId: input.thread.id,
    originMessageId: input.messageId,
    createdAt: now,
    updatedAt: now,
  });
  await persist.derived.create({
    id: taskId,
    kind: "task",
    title: titleFromContent(input.content),
    confidentialityLevel: label.confidentialityLevel,
    visibility: label.visibility ?? input.thread.visibility,
    originThreadId: input.thread.id,
    originMessageId: input.messageId,
    securityLabelSource: "inherited",
    minimumDerivedLevel: label.minimumDerivedLevel ?? label.confidentialityLevel,
  });
}
