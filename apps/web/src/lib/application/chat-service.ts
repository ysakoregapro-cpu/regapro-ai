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
  type ClassificationResult,
} from "@regapro/security";
import {
  CURRENT_MEMBERSHIP,
  SAMPLE_MEMBERSHIPS,
  getPublicProfile,
  resolveSessionAccess,
} from "@/lib/data/dev-sample/memberships";
import { isDevSampleMode } from "@/lib/supabase/env";
import {
  buildResearchAnswer,
  completeResearchDemo,
  getResearchRun,
  listResearchRunsForThread,
} from "@/lib/application/research-service";
import { listArtifactsForThread } from "@/lib/application/artifact-service";

function newId(): string {
  return globalThis.crypto.randomUUID();
}

export type StoredMessageCitation = {
  id: string;
  title: string;
  source: string;
  excerpt?: string | null;
  uri?: string | null;
  provenance?: "internal" | "web";
  chunkId?: string | null;
  documentId?: string | null;
};

export type StoredMessage = {
  id: string;
  threadId: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
  confidentialityLevel: ConfidentialityLevel;
  visibility: Visibility;
  classificationConfidence?: number;
  classificationSource?: string;
  sensitivitySignals?: string[];
  /** Reloaded from message_citations in supabase mode (and in-memory for sample). */
  citations?: StoredMessageCitation[];
};

export type StoredThread = {
  id: string;
  title: string;
  orgId: string;
  ownerUserId: string;
  departmentId: string | null;
  projectId: string | null;
  confidentialityLevel: ConfidentialityLevel;
  visibility: Visibility;
  securityLabelSource: string;
  minimumDerivedLevel: ConfidentialityLevel;
  containsSensitiveContent: boolean;
  updatedAt: string;
  createdAt: string;
  /** Conversation workflow started from home / TopBar / tools */
  workflowType?:
    | "general"
    | "research"
    | "document"
    | "file_review"
    | "code"
    | "prompt"
    | "task";
  documentSubtype?: "text" | "document" | "presentation";
  toolId?: string | null;
};

export type InheritedResource = {
  id: string;
  kind: "task" | "artifact" | "research" | "prompt" | "knowledge_candidate";
  title: string;
  confidentialityLevel: ConfidentialityLevel;
  visibility: Visibility;
  originThreadId: string;
  originMessageId: string | null;
  securityLabelSource: string;
  minimumDerivedLevel: ConfidentialityLevel;
};

type Store = {
  threads: Map<string, StoredThread>;
  messages: Map<string, StoredMessage[]>;
  participants: Map<string, Set<string>>;
  idempotency: Map<string, { threadId: string; messageId: string }>;
  /** Prevents duplicate assistant replies for the same user message */
  replyIdempotency: Map<string, string>;
  resources: InheritedResource[];
  auditLogs: { id: string; action: string; at: string; meta: Record<string, string> }[];
};

const globalStore = globalThis as unknown as { __regaproChatStore?: Store };

function store(): Store {
  if (!globalStore.__regaproChatStore) {
    globalStore.__regaproChatStore = {
      threads: new Map(),
      messages: new Map(),
      participants: new Map(),
      idempotency: new Map(),
      replyIdempotency: new Map(),
      resources: [],
      auditLogs: [],
    };
    seedThreads(globalStore.__regaproChatStore);
  } else if (!globalStore.__regaproChatStore.replyIdempotency) {
    // Hot-reload / older shape
    globalStore.__regaproChatStore.replyIdempotency = new Map();
  }
  return globalStore.__regaproChatStore;
}

function seedThreads(s: Store) {
  const seeds: StoredThread[] = [
    {
      id: "thread-1",
      title: "求人選定の状況整理",
      orgId: "org-regapro",
      ownerUserId: "user-tanaka",
      departmentId: "dept-sales",
      projectId: "proj-recruit",
      confidentialityLevel: "company",
      visibility: "private",
      securityLabelSource: "user",
      minimumDerivedLevel: "company",
      containsSensitiveContent: false,
      createdAt: "2026-08-06T09:10:00+09:00",
      updatedAt: "2026-08-06T09:20:00+09:00",
    },
    {
      id: "thread-sakawa-private",
      title: "個人相談：キャリアの方向",
      orgId: "org-regapro",
      ownerUserId: "user-sakawa",
      departmentId: "dept-sales",
      projectId: null,
      confidentialityLevel: "company",
      visibility: "private",
      securityLabelSource: "user",
      minimumDerivedLevel: "company",
      containsSensitiveContent: false,
      createdAt: "2026-08-05T20:00:00+09:00",
      updatedAt: "2026-08-05T20:30:00+09:00",
    },
  ];
  for (const t of seeds) {
    s.threads.set(t.id, t);
    s.participants.set(t.id, new Set([t.ownerUserId]));
  }
  s.messages.set("thread-1", [
    {
      id: "msg-1",
      threadId: "thread-1",
      role: "user",
      content: "A社向け求人選定の現状をまとめて。担当は森藤さん。",
      createdAt: "2026-08-06T09:10:00+09:00",
      confidentialityLevel: "company",
      visibility: "private",
    },
    {
      id: "msg-2",
      threadId: "thread-1",
      role: "assistant",
      content:
        "有料職業紹介プロジェクトの社内情報から整理しました。\n\n- 候補A：現場経験が厚いがリモート希望\n- 候補B：条件一致度が高い\n- 候補C：即日出勤可だが年齢条件の確認が必要\n\n森藤さんへの確認タスク案を用意できます。",
      createdAt: "2026-08-06T09:12:00+09:00",
      confidentialityLevel: "company",
      visibility: "private",
    },
  ]);
  s.messages.set("thread-sakawa-private", [
    {
      id: "msg-sakawa-1",
      threadId: "thread-sakawa-private",
      role: "user",
      content: "最近、不動産の案件が忙しくて相談したいことがあります。",
      createdAt: "2026-08-05T20:05:00+09:00",
      confidentialityLevel: "company",
      visibility: "private",
    },
  ]);
}

export type StartChatInput = {
  content: string;
  requestedLevel: ConfidentialityLevel;
  confirmRaise?: boolean;
  idempotencyKey?: string;
  userId?: string;
};

export type StartChatResult =
  | {
      ok: true;
      threadId: string;
      messageId: string;
      redirectTo: string;
      classification: ClassificationResult;
    }
  | {
      ok: false;
      code:
        | "EMPTY"
        | "LEVEL_DENIED"
        | "NEEDS_CONFIRMATION"
        | "PERMISSION_DENIED";
      message: string;
      classification?: ClassificationResult;
      suggestedLevel?: ConfidentialityLevel;
      restoreContent: string;
    };

function titleFromContent(content: string): string {
  const t = content.replace(/\s+/g, " ").trim();
  return t.length > 36 ? `${t.slice(0, 36)}…` : t || "新しい会話";
}

export function startChatFromHome(input: StartChatInput): StartChatResult {
  const content = input.content.trim();
  if (!content) {
    return {
      ok: false,
      code: "EMPTY",
      message: "内容を入力してください",
      restoreContent: input.content,
    };
  }

  const session = resolveSessionAccess({ userId: input.userId });
  const s = store();

  if (input.idempotencyKey) {
    const hit = s.idempotency.get(input.idempotencyKey);
    if (hit) {
      return {
        ok: true,
        threadId: hit.threadId,
        messageId: hit.messageId,
        redirectTo: `/assistant?thread=${hit.threadId}&started=1`,
        classification: classifySensitiveContent(content),
      };
    }
  }

  const classification = classifySensitiveContent(content);
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

  const now = new Date().toISOString();
  const threadId = newId();
  const messageId = newId();
  const membership = session.membership;

  const thread: StoredThread = {
    id: threadId,
    title: titleFromContent(content),
    orgId: membership.organizationId,
    ownerUserId: membership.userId,
    departmentId: membership.departmentId,
    projectId: null,
    confidentialityLevel: level,
    visibility: "private",
    securityLabelSource: "user",
    minimumDerivedLevel: level,
    containsSensitiveContent: classification.suggestedLevel !== "company",
    createdAt: now,
    updatedAt: now,
  };

  const message: StoredMessage = {
    id: messageId,
    threadId,
    role: "user",
    content,
    createdAt: now,
    confidentialityLevel: level,
    visibility: "private",
    classificationConfidence: classification.confidence,
    classificationSource: "rule",
    sensitivitySignals: classification.matchedSignals,
  };

  s.threads.set(threadId, thread);
  s.messages.set(threadId, [message]);
  s.participants.set(threadId, new Set([membership.userId]));
  if (input.idempotencyKey) {
    s.idempotency.set(input.idempotencyKey, { threadId, messageId });
  }
  s.auditLogs.push({
    id: newId(),
    action: "chat.thread_created",
    at: now,
    meta: {
      threadId,
      level,
      // do not store full message body
    },
  });

  return {
    ok: true,
    threadId,
    messageId,
    redirectTo: `/assistant?thread=${threadId}&started=1`,
    classification,
  };
}

export function listVisibleThreads(userId = CURRENT_MEMBERSHIP.userId) {
  const s = store();
  const session = resolveSessionAccess({ userId });
  return [...s.threads.values()]
    .filter((t) => {
      if (t.ownerUserId === userId) return true;
      if (s.participants.get(t.id)?.has(userId)) return true;
      if (t.visibility === "private") return false;
      return canAssignConfidentialityLevel(
        session.access,
        t.confidentialityLevel,
      );
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getThread(threadId: string, userId = CURRENT_MEMBERSHIP.userId) {
  const s = store();
  const t = s.threads.get(threadId);
  if (!t) return null;
  if (t.visibility === "private" && t.ownerUserId !== userId) {
    const session = resolveSessionAccess({
      userId,
      auditMode: false,
    });
    if (
      !session.permissions.includes("conversation:audit") ||
      !session.access.auditMode
    ) {
      return null;
    }
  }
  return t;
}

export function getThreadMessages(
  threadId: string,
  userId = CURRENT_MEMBERSHIP.userId,
) {
  if (!getThread(threadId, userId)) return [];
  return store().messages.get(threadId) ?? [];
}

export function changeThreadLevel(input: {
  threadId: string;
  newLevel: ConfidentialityLevel;
  userId?: string;
}): { ok: true } | { ok: false; message: string; advice?: string } {
  const userId = input.userId ?? CURRENT_MEMBERSHIP.userId;
  const s = store();
  const thread = s.threads.get(input.threadId);
  if (!thread || thread.ownerUserId !== userId) {
    return { ok: false, message: "この会話を変更する権限がありません" };
  }
  const session = resolveSessionAccess({
    userId,
    threadLevel: thread.confidentialityLevel,
  });
  if (!canAssignConfidentialityLevel(session.access, input.newLevel)) {
    return { ok: false, message: "その情報区分は選択できません" };
  }

  const messages = s.messages.get(thread.id) ?? [];
  const childLevels = [
    ...messages.map((m) => m.confidentialityLevel),
    ...s.resources
      .filter((r) => r.originThreadId === thread.id)
      .map((r) => r.confidentialityLevel),
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
    for (const m of messages) {
      m.confidentialityLevel = maxConfidentiality(
        m.confidentialityLevel,
        input.newLevel,
      );
    }
    for (const r of s.resources) {
      if (r.originThreadId === thread.id) {
        r.confidentialityLevel = maxConfidentiality(
          r.confidentialityLevel,
          input.newLevel,
        );
        r.minimumDerivedLevel = r.confidentialityLevel;
      }
    }
  }
  thread.updatedAt = new Date().toISOString();
  s.auditLogs.push({
    id: newId(),
    action: raised ? "chat.level_raised" : "chat.level_changed",
    at: thread.updatedAt,
    meta: { threadId: thread.id, level: input.newLevel },
  });
  return { ok: true };
}

export function createDerivedResource(input: {
  threadId: string;
  messageId?: string;
  kind: InheritedResource["kind"];
  title: string;
  userId?: string;
}) {
  const thread = getThread(input.threadId, input.userId);
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
  store().resources.push(resource);
  return resource;
}

export function extractPublicThread(input: {
  sourceThreadId: string;
  title: string;
  content: string;
  userId?: string;
}) {
  // Does not lower the source — creates a separate company-level resource path.
  const started = startChatFromHome({
    content: input.content,
    requestedLevel: "company",
    confirmRaise: false,
    userId: input.userId,
  });
  if (!started.ok) return started;
  const s = store();
  const t = s.threads.get(started.threadId);
  if (t) {
    t.title = input.title;
    s.auditLogs.push({
      id: newId(),
      action: "chat.extracted_public_thread",
      at: new Date().toISOString(),
      meta: {
        sourceThreadId: input.sourceThreadId,
        newThreadId: started.threadId,
      },
    });
  }
  return started;
}

export function searchAccessible(query: string, userId = CURRENT_MEMBERSHIP.userId) {
  const q = query.trim().toLowerCase();
  const session = resolveSessionAccess({ userId });
  const s = store();
  const hits: {
    id: string;
    kind: string;
    title: string;
    snippet: string;
    confidentialityLevel: ConfidentialityLevel;
    visibility: Visibility;
    accessReason: string;
    sourceType: string;
    sourceId: string;
  }[] = [];

  if (!q) return hits;

  for (const t of s.threads.values()) {
    const isOwn = t.ownerUserId === userId;
    const isParticipant = s.participants.get(t.id)?.has(userId);
    if (t.visibility === "private" && !isOwn && !isParticipant) {
      continue; // never return other private chats in normal search
    }
    if (
      compareConfidentiality(
        t.confidentialityLevel,
        session.maximumConfidentialityLevel,
      ) > 0
    ) {
      continue;
    }
    if (!t.title.toLowerCase().includes(q)) continue;
    hits.push({
      id: t.id,
      kind: "チャット",
      title: t.title,
      snippet: isOwn ? "自分の会話" : "参加中の会話",
      confidentialityLevel: t.confidentialityLevel,
      visibility: t.visibility,
      accessReason: isOwn ? "owner" : "participant",
      sourceType: "chat_thread",
      sourceId: t.id,
    });
  }

  return hits;
}

export function answerAboutColleague(
  question: string,
  subjectUserId: string,
  userId = CURRENT_MEMBERSHIP.userId,
): string {
  const profile = getPublicProfile(subjectUserId);
  if (!profile) return "該当する社員情報が見つかりませんでした。";

  if (/相談|最近.*何を|どう考え/.test(question)) {
    return "他の社員の非公開の相談内容は参照できません。公開されている担当業務や参加プロジェクトについては案内できます。";
  }
  if (/実給与|実際の給与|賞与額/.test(question)) {
    const session = resolveSessionAccess({ userId });
    if (session.maximumConfidentialityLevel !== "executive") {
      return "個別の報酬情報は、必要な権限がないためお答えできません。";
    }
    return "個別の実給与は、権限があってもこの画面からは回答しません。適切な手続きで確認してください。";
  }
  if (/適正給与|市場|平均給与/.test(question)) {
    return `${profile.name}さんの担当業務（${profile.publicDuties}）を踏まえると、市場の一般論として同業の公開求人を参照する調査が可能です。実給与は使いません。`;
  }
  return `${profile.name}さんは${profile.departmentLabel}の${profile.title}です。担当：${profile.publicDuties}。参加プロジェクト：${profile.publicProjects.join("、") || "—"}。`;
}

export function listAuditLogs() {
  return store().auditLogs;
}

export function listDerivedResources(threadId: string) {
  return store().resources.filter((r) => r.originThreadId === threadId);
}

/**
 * Template / rule-based reply for offline providers.
 * States only what was actually done — never claims Web/knowledge search ran.
 */
export function craftDemoAssistantReply(
  userText: string,
  ctx?: {
    threadId?: string;
    workflowType?: StoredThread["workflowType"];
  },
): {
  content: string;
  citations: { id: string; title: string; source: string }[];
} {
  if (
    ctx?.threadId &&
    (ctx.workflowType === "research" || /調べて|調査/.test(userText))
  ) {
    const runs = listResearchRunsForThread(ctx.threadId);
    const run = runs[runs.length - 1];
    if (run) {
      if (run.status !== "completed") completeResearchDemo(run.id);
      const fresh = getResearchRun(run.id) ?? run;
      return {
        content: buildResearchAnswer(fresh),
        citations: fresh.citations.map((c) => ({
          id: c.id,
          title: c.title,
          source: c.publisher,
        })),
      };
    }
  }

  if (
    ctx?.workflowType === "document" ||
    /議事録|文面|資料にして/.test(userText)
  ) {
    const arts = ctx?.threadId ? listArtifactsForThread(ctx.threadId) : [];
    const art = arts[arts.length - 1];
    if (art) {
      const statusLine =
        art.formatStatus === "ready"
          ? `Markdown下書きを成果物として保存しました（v${art.version}）。`
          : `${art.disabledReason ?? "この形式は未接続です"}。代わりにMarkdown下書きを右ペインに表示しています。`;
      return {
        content: [
          `「${art.title}」の資料作成を進めました。`,
          "",
          statusLine,
          "",
          "同じチャットから修正指示を送るとVersionが増えます。",
        ].join("\n"),
        citations: [],
      };
    }
  }

  // Colleague lore is fixture-only — never answer from SAMPLE_MEMBERSHIPS in supabase mode.
  if (isDevSampleMode()) {
    const subject = findColleagueMention(userText);
    if (subject && /相談|最近.*何を|どう考え|実給与|実際の給与/.test(userText)) {
      return {
        content: answerAboutColleague(userText, subject.userId),
        citations: [],
      };
    }

    if (subject && /業務|担当|どんな仕事/.test(userText)) {
      return {
        content: answerAboutColleague(userText, subject.userId),
        citations: [],
      };
    }
  }

  const short =
    userText.replace(/\s+/g, " ").trim().slice(0, 40) +
    (userText.length > 40 ? "…" : "");

  const modeLine = isDevSampleMode()
    ? "いまは確認用のデータで動いています。社内検索やWeb調査がまだ接続されていないため、外部の情報源を参照してはいません。"
    : "会話は組織データへ保存されています。社内検索やWeb調査バックエンドは未接続のため、外部の情報源を参照してはいません。";

  return {
    content: [
      `「${short}」という依頼を受け付けました。`,
      "",
      modeLine,
      "",
      "そのまま進められること:",
      "・タスクとして登録する",
      "・文面や資料の下書き方針を指定する",
      "・関連するプロジェクトを指定して詳しく依頼する",
    ].join("\n"),
    citations: [],
  };
}

function findColleagueMention(text: string) {
  for (const m of SAMPLE_MEMBERSHIPS) {
    const family = m.name.split(/\s+/)[0];
    if (family && text.includes(family)) return m;
  }
  return null;
}

/**
 * Creates or returns the assistant reply for the latest user message.
 * Idempotent per (threadId, userMessageId). Safe to call on reload with started=1.
 * Routes through AI Answer Runtime (honest fallback when models/search disconnect).
 */
export async function ensureAssistantReply(input: {
  threadId: string;
  userId?: string;
  idempotencyKey?: string;
}): Promise<{
  ok: true;
  message: StoredMessage;
  created: boolean;
  messages: StoredMessage[];
} | {
  ok: false;
  code: "THREAD_NOT_FOUND" | "NO_USER_MESSAGE";
  message: string;
}> {
  const userId = input.userId ?? CURRENT_MEMBERSHIP.userId;
  const thread = getThread(input.threadId, userId);
  if (!thread) {
    return { ok: false, code: "THREAD_NOT_FOUND", message: "会話が見つかりません" };
  }

  const s = store();
  const messages = [...(s.messages.get(input.threadId) ?? [])];
  const last = messages[messages.length - 1];
  if (last?.role === "assistant") {
    return { ok: true, message: last, created: false, messages };
  }

  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  if (!lastUser) {
    return { ok: false, code: "NO_USER_MESSAGE", message: "ユーザーのメッセージがありません" };
  }

  const replyKey =
    input.idempotencyKey ?? `reply:${input.threadId}:${lastUser.id}`;
  const existingId = s.replyIdempotency.get(replyKey);
  if (existingId) {
    const existing = messages.find((m) => m.id === existingId);
    if (existing) {
      return { ok: true, message: existing, created: false, messages };
    }
  }

  const { access } = resolveSessionAccess({
    userId,
    threadLevel: thread.confidentialityLevel,
    threadVisibility: thread.visibility,
    participantThreadIds:
      thread.ownerUserId === userId ? [thread.id] : [],
  });

  const runs = listResearchRunsForThread(input.threadId);
  const run = runs[runs.length - 1] ?? null;
  const arts = listArtifactsForThread(input.threadId);
  const art = arts[arts.length - 1] ?? null;

  const hints = {
    researchSummary: run ? buildResearchAnswer(run) : null,
    artifactSummary: art
      ? [
          `「${art.title}」の資料作成を進めました。`,
          "",
          art.formatStatus === "ready"
            ? `Markdown下書きを成果物として保存しました（v${art.version}）。`
            : `${art.disabledReason ?? "この形式は未接続です"}。代わりにMarkdown下書きを右ペインに表示しています。`,
          "",
          "同じチャットから修正指示を送るとVersionが増えます。",
        ].join("\n")
      : null,
  };

  const { generateSampleAssistantAnswer, workflowToAnswerIntent } = await import(
    "@/lib/application/ai-answer-sample"
  );

  // Preserve colleague/dev-sample lore only via craftDemo when no workflow resource.
  let content: string;
  let citations: StoredMessageCitation[] | undefined;
  if (hints.researchSummary || hints.artifactSummary) {
    const answer = await generateSampleAssistantAnswer({
      access,
      threadId: input.threadId,
      messageId: lastUser.id,
      userText: lastUser.content,
      workflowHint: workflowToAnswerIntent(thread.workflowType),
      hints,
    });
    content = answer.text;
    citations = answer.citations.map((c) => ({
      id: c.id,
      title: c.title,
      source: c.sourceType,
      excerpt: c.excerpt,
      documentId: c.sourceId,
    }));
  } else if (isDevSampleMode() && findColleagueMention(lastUser.content)) {
    content = craftDemoAssistantReply(lastUser.content, {
      threadId: input.threadId,
      workflowType: thread.workflowType,
    }).content;
  } else {
    const answer = await generateSampleAssistantAnswer({
      access,
      threadId: input.threadId,
      messageId: lastUser.id,
      userText: lastUser.content,
      workflowHint: workflowToAnswerIntent(thread.workflowType),
      hints,
    });
    content = answer.text;
    citations = answer.citations.map((c) => ({
      id: c.id,
      title: c.title,
      source: c.sourceType,
      excerpt: c.excerpt,
      documentId: c.sourceId,
    }));
  }

  const assistantMsg: StoredMessage = {
    id: newId(),
    threadId: input.threadId,
    role: "assistant",
    content,
    createdAt: new Date().toISOString(),
    confidentialityLevel: thread.confidentialityLevel,
    visibility: thread.visibility,
    classificationSource: "template",
    citations,
  };

  const next = [...messages, assistantMsg];
  s.messages.set(input.threadId, next);
  s.replyIdempotency.set(replyKey, assistantMsg.id);
  s.replyIdempotency.set(`reply:${input.threadId}:${lastUser.id}`, assistantMsg.id);
  thread.updatedAt = assistantMsg.createdAt;
  s.auditLogs.push({
    id: newId(),
    action: "chat.assistant_reply",
    at: assistantMsg.createdAt,
    meta: { threadId: input.threadId, messageId: assistantMsg.id },
  });

  return { ok: true, message: assistantMsg, created: true, messages: next };
}

export function getThreadBundle(threadId: string, userId = CURRENT_MEMBERSHIP.userId) {
  const thread = getThread(threadId, userId);
  if (!thread) return null;
  return {
    thread,
    messages: getThreadMessages(threadId, userId),
  };
}

export function appendUserMessage(input: {
  threadId: string;
  content: string;
  userId?: string;
}):
  | { ok: true; message: StoredMessage; messages: StoredMessage[] }
  | { ok: false; code: "THREAD_NOT_FOUND" | "EMPTY"; message: string } {
  const content = input.content.trim();
  if (!content) {
    return { ok: false, code: "EMPTY", message: "内容を入力してください" };
  }
  const userId = input.userId ?? CURRENT_MEMBERSHIP.userId;
  const thread = getThread(input.threadId, userId);
  if (!thread) {
    return { ok: false, code: "THREAD_NOT_FOUND", message: "会話が見つかりません" };
  }
  const s = store();
  const message: StoredMessage = {
    id: newId(),
    threadId: input.threadId,
    role: "user",
    content,
    createdAt: new Date().toISOString(),
    confidentialityLevel: thread.confidentialityLevel,
    visibility: thread.visibility,
  };
  const next = [...(s.messages.get(input.threadId) ?? []), message];
  s.messages.set(input.threadId, next);
  thread.updatedAt = message.createdAt;
  return { ok: true, message, messages: next };
}

/** Test helper — reset in-memory store between cases. */
export function __resetChatStoreForTests() {
  delete (globalThis as { __regaproChatStore?: Store }).__regaproChatStore;
}
