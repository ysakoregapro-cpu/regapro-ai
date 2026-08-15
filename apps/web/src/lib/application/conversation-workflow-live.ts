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
    classificationSignals = classification.matchedSignals.map(String);
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
    if (
      compareConfidentiality(classification.suggestedLevel, level) > 0 &&
      canAssignConfidentialityLevel(session.access, classification.suggestedLevel)
    ) {
      level = maxConfidentiality(level, classification.suggestedLevel);
    }
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

  let level = input.requestedLevel;

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

  if (
    compareConfidentiality(classification.suggestedLevel, level) > 0 &&
    !input.confirmRaise
  ) {
    if (
      !canAssignConfidentialityLevel(
        session.access,
        classification.suggestedLevel,
      )
    ) {
      return {
        ok: false,
        code: "PERMISSION_DENIED",
        message:
          "この内容は現在の権限では扱えません。所属の管理者へ相談してください。",
        restoreContent: content,
        classification,
        suggestedLevel: classification.suggestedLevel,
      };
    }
    return {
      ok: false,
      code: "NEEDS_CONFIRMATION",
      message:
        classification.suggestedLevel === "executive"
          ? `給与・評価等の経営情報を含む可能性があります。情報区分を「${CONFIDENTIALITY_LABELS.executive}」へ変更して続けますか？`
          : `人事情報を含む可能性があります。情報区分を「${CONFIDENTIALITY_LABELS.people}」へ変更して続けますか？`,
      restoreContent: content,
      classification,
      suggestedLevel: classification.suggestedLevel,
    };
  }

  if (input.confirmRaise && classification.suggestedLevel) {
    level = maxConfidentiality(level, classification.suggestedLevel);
    if (!canAssignConfidentialityLevel(session.access, level)) {
      return {
        ok: false,
        code: "PERMISSION_DENIED",
        message:
          "この内容は現在の権限では扱えません。所属の管理者へ相談してください。",
        restoreContent: content,
        classification,
      };
    }
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
    await persistMessageCitations(client, {
      messageId,
      citations: answer.citations,
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

  const plan = sanitizeExternalQuery({
    request: input.content,
    confidentialityLevel: input.level,
  });
  assertNoSensitiveInExternalQueries(plan);

  const now = new Date().toISOString();
  const run: ResearchRun = {
    id: newId(),
    threadId: input.threadId,
    requestMessageId: input.messageId,
    organizationId: input.orgId,
    requestedBy: input.userId,
    confidentialityLevel: input.level,
    visibility: input.visibility,
    projectId: input.projectId,
    status: "completed",
    purpose: input.content,
    queries: plan.sanitizedQueries,
    queryPlan: plan,
    sources: plan.sanitizedQueries.map((q, i) => ({
      id: newId(),
      title: `確認用候補 ${i + 1}`,
      note: `Query計画のみ（実取得なし）: ${q}`,
    })),
    findings: [
      "公開情報では表示方法に差がある（確認用）",
      "社内手順との突合が次の確認事項になる（確認用）",
    ],
    citations: [
      {
        id: newId(),
        title: "確認用の調査メモ",
        publisher: "デモデータ",
        url: null,
        publishedAt: null,
        retrievedAt: now,
        excerpt:
          "現在は確認用データで調査フローを表示しています。実際のWeb検索はまだ接続されていません。",
        confidence: 0.35,
        confidentialityLevel: input.level,
      },
    ],
    resultArtifactId: null,
    startedAt: now,
    completedAt: now,
    failedAt: null,
    provider: "demo",
    isDemo: true,
    errorCode: null,
    errorMessage: null,
    processingMetadata: { mode: "supabase", note: "fake browsing disabled" },
    title: input.content.slice(0, 40) || "調査",
    demoNoticeShown: true,
  };

  await persist.research.create(run);
  if (input.idempotencyKey) {
    await persist.research.saveIdempotency(input.idempotencyKey, run.id);
  }
  return run;
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
