import type { ConfidentialityLevel, Visibility } from "@regapro/shared";
import {
  assertNoSensitiveInExternalQueries,
  sanitizeExternalQuery,
  type QueryPlan,
} from "@/lib/application/external-query-sanitizer";
import { CURRENT_MEMBERSHIP } from "@/lib/data/dev-sample/memberships";

export type ResearchStatus =
  | "draft"
  | "queued"
  | "searching"
  | "reading"
  | "synthesizing"
  | "completed"
  | "failed"
  | "cancelled";

export const RESEARCH_PROGRESS_LABELS: Record<ResearchStatus, string> = {
  draft: "調査を準備しています",
  queued: "調査を準備しています",
  searching: "情報を探しています",
  reading: "ページを読み取っています",
  synthesizing: "情報を整理しています",
  completed: "回答を作成しています",
  failed: "調査を完了できませんでした",
  cancelled: "調査を取り消しました",
};

export type ResearchCitation = {
  id: string;
  title: string;
  publisher: string;
  url: string | null;
  publishedAt: string | null;
  retrievedAt: string;
  excerpt: string;
  confidence: number;
  confidentialityLevel: ConfidentialityLevel;
};

export type ResearchRun = {
  id: string;
  threadId: string;
  requestMessageId: string | null;
  organizationId: string;
  requestedBy: string;
  confidentialityLevel: ConfidentialityLevel;
  visibility: Visibility;
  projectId: string | null;
  status: ResearchStatus;
  purpose: string;
  queries: string[];
  queryPlan: QueryPlan | null;
  sources: { id: string; title: string; note: string }[];
  findings: string[];
  citations: ResearchCitation[];
  resultArtifactId: string | null;
  startedAt: string;
  completedAt: string | null;
  failedAt: string | null;
  provider: "demo" | "searxng" | "http";
  isDemo: boolean;
  errorCode: string | null;
  errorMessage: string | null;
  processingMetadata: Record<string, string>;
  title: string;
  demoNoticeShown: boolean;
};

type Store = {
  runs: Map<string, ResearchRun>;
  byThread: Map<string, string[]>;
  idempotency: Map<string, string>;
};

const g = globalThis as unknown as { __regaproResearchStore?: Store };

function store(): Store {
  if (!g.__regaproResearchStore) {
    g.__regaproResearchStore = {
      runs: new Map(),
      byThread: new Map(),
      idempotency: new Map(),
    };
    seed(g.__regaproResearchStore);
  }
  return g.__regaproResearchStore;
}

function newId() {
  return globalThis.crypto.randomUUID();
}

function seed(s: Store) {
  const id = "research-seed-1";
  const run: ResearchRun = {
    id,
    threadId: "thread-1",
    requestMessageId: "msg-1",
    organizationId: "org-regapro",
    requestedBy: "user-tanaka",
    confidentialityLevel: "company",
    visibility: "private",
    projectId: "proj-recruit",
    status: "completed",
    purpose: "職業紹介手数料の相場調査",
    queries: ["有料職業紹介 手数料 相場"],
    queryPlan: null,
    sources: [
      {
        id: "src-1",
        title: "公開ガイドライン要約（確認用）",
        note: "デモ用メタデータ",
      },
    ],
    findings: [
      "公開情報では手数料の表示方法に業界差がある",
      "社内手順との突合が次の確認事項になる",
    ],
    citations: [
      {
        id: "cite-demo-1",
        title: "確認用の公開資料メモ",
        publisher: "デモデータ",
        url: null,
        publishedAt: null,
        retrievedAt: "2026-08-04T18:00:00+09:00",
        excerpt: "実際のWeb取得は行っていません。",
        confidence: 0.4,
        confidentialityLevel: "company",
      },
    ],
    resultArtifactId: null,
    startedAt: "2026-08-04T17:00:00+09:00",
    completedAt: "2026-08-04T18:00:00+09:00",
    failedAt: null,
    provider: "demo",
    isDemo: true,
    errorCode: null,
    errorMessage: null,
    processingMetadata: { mode: "dev-sample" },
    title: "職業紹介手数料の相場調査",
    demoNoticeShown: true,
  };
  s.runs.set(id, run);
  s.byThread.set("thread-1", [id]);
}

export function createResearchRun(input: {
  threadId: string;
  requestMessageId: string | null;
  purpose: string;
  confidentialityLevel: ConfidentialityLevel;
  visibility: Visibility;
  projectId?: string | null;
  requestedBy?: string;
  idempotencyKey?: string;
}): ResearchRun {
  const s = store();
  if (input.idempotencyKey) {
    const existingId = s.idempotency.get(input.idempotencyKey);
    if (existingId) {
      const existing = s.runs.get(existingId);
      if (existing) return existing;
    }
  }

  const plan = sanitizeExternalQuery({
    request: input.purpose,
    confidentialityLevel: input.confidentialityLevel,
  });
  assertNoSensitiveInExternalQueries(plan);

  const now = new Date().toISOString();
  const run: ResearchRun = {
    id: newId(),
    threadId: input.threadId,
    requestMessageId: input.requestMessageId,
    organizationId: CURRENT_MEMBERSHIP.organizationId,
    requestedBy: input.requestedBy ?? CURRENT_MEMBERSHIP.userId,
    confidentialityLevel: input.confidentialityLevel,
    visibility: input.visibility,
    projectId: input.projectId ?? null,
    status: "queued",
    purpose: input.purpose,
    queries: plan.sanitizedQueries,
    queryPlan: plan,
    sources: [],
    findings: [],
    citations: [],
    resultArtifactId: null,
    startedAt: now,
    completedAt: null,
    failedAt: null,
    provider: "demo",
    isDemo: true,
    errorCode: null,
    errorMessage: null,
    processingMetadata: { mode: "dev-sample" },
    title: input.purpose.slice(0, 40) || "詳細調査",
    demoNoticeShown: false,
  };

  s.runs.set(run.id, run);
  const list = s.byThread.get(input.threadId) ?? [];
  list.push(run.id);
  s.byThread.set(input.threadId, list);
  if (input.idempotencyKey) s.idempotency.set(input.idempotencyKey, run.id);
  return run;
}

/** Advances demo research through deterministic stages and fills sample findings. */
export function advanceResearchRun(runId: string): ResearchRun | null {
  const s = store();
  const run = s.runs.get(runId);
  if (!run || run.status === "completed" || run.status === "failed") return run ?? null;

  const order: ResearchStatus[] = [
    "queued",
    "searching",
    "reading",
    "synthesizing",
    "completed",
  ];
  const idx = order.indexOf(run.status);
  const next = order[Math.min(idx + 1, order.length - 1)] ?? "completed";
  run.status = next;

  if (next === "searching" && run.sources.length === 0) {
    run.sources = run.queries.map((q, i) => ({
      id: `src-${run.id}-${i}`,
      title: `確認用候補 ${i + 1}`,
      note: `Query計画のみ（実取得なし）: ${q}`,
    }));
  }
  if (next === "reading") {
    run.findings = [
      "公開可能な一般論として、条件提示の透明性が比較軸になる",
      "社内の標準手順との差分確認が必要",
    ];
  }
  if (next === "completed") {
    run.completedAt = new Date().toISOString();
    run.citations = [
      {
        id: `cite-${run.id}`,
        title: "確認用の調査メモ",
        publisher: "デモデータ",
        url: null,
        publishedAt: null,
        retrievedAt: run.completedAt,
        excerpt:
          "現在は確認用データで調査フローを表示しています。実際のWeb検索はまだ接続されていません。",
        confidence: 0.35,
        confidentialityLevel: run.confidentialityLevel,
      },
    ];
    run.demoNoticeShown = true;
  }
  return run;
}

export function completeResearchDemo(runId: string): ResearchRun | null {
  const run = store().runs.get(runId);
  if (!run) return null;
  while (run.status !== "completed" && run.status !== "failed") {
    advanceResearchRun(runId);
  }
  return run;
}

export function getResearchRun(id: string) {
  return store().runs.get(id) ?? null;
}

export function listResearchRunsForThread(threadId: string) {
  const ids = store().byThread.get(threadId) ?? [];
  return ids
    .map((id) => store().runs.get(id))
    .filter((r): r is ResearchRun => Boolean(r));
}

export function listResearchLibrary() {
  return [...store().runs.values()].sort((a, b) =>
    (b.completedAt ?? b.startedAt).localeCompare(a.completedAt ?? a.startedAt),
  );
}

export function buildResearchAnswer(run: ResearchRun): string {
  const lines = [
    `「${run.purpose}」の調査フロー結果です。`,
    "",
    ...run.findings.map((f) => `・${f}`),
  ];
  if (run.isDemo) {
    lines.push(
      "",
      "現在は確認用データで調査フローを表示しています。実際のWeb検索はまだ接続されていません。",
    );
  }
  return lines.join("\n");
}

export function __resetResearchStoreForTests() {
  delete (globalThis as { __regaproResearchStore?: Store }).__regaproResearchStore;
}

export function progressLabel(status: ResearchStatus): string {
  if (status === "completed") return "完了";
  return RESEARCH_PROGRESS_LABELS[status];
}
