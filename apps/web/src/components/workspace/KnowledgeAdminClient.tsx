"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { EmptyState, ListRow, PageHeader } from "@/components/ui/primitives";
import { knowledgeReviewErrorMessage } from "@regapro/knowledge/approval-messages";
import {
  reviewFeedbackFromResponse,
  type FactoryReviewResponse,
} from "@/lib/application/knowledge-review-response";

const DOMAIN_OPTIONS = [
  { key: "company_common", label: "全社共通" },
  { key: "sales", label: "営業" },
  { key: "telecom", label: "通信" },
  { key: "recruitment", label: "有料職業紹介" },
  { key: "real_estate", label: "不動産" },
  { key: "staffing", label: "人材" },
  { key: "engineering", label: "エンジニアリング" },
  { key: "management", label: "経営" },
] as const;

const VISIBILITY_OPTIONS = [
  { key: "organization", label: "組織" },
  { key: "department", label: "部門" },
  { key: "project", label: "案件" },
  { key: "participants", label: "関係者" },
  { key: "restricted", label: "制限付き" },
  { key: "private", label: "自分のみ" },
] as const;

const CLEARANCE_OPTIONS = [
  { key: "company", label: "全社（L1）" },
  { key: "people", label: "人事・管理（L2）" },
  { key: "executive", label: "経営戦略（L3）" },
] as const;

type DocRow = {
  id: string;
  title: string;
  status: string;
  visibility: string;
  confidentiality_level: number;
  source_type: string | null;
  updated_at: string;
  published_at: string | null;
};

type InboxRow = {
  id: string;
  title: string;
  summary: string | null;
  candidate_type: string;
  fact_status: string;
  review_status: string;
  conflict_kind: string;
  conflict_reason: string | null;
  domain_keys: string[] | null;
  source_excerpt: string | null;
  source_quality: number | null;
  confidence: number | null;
  suggested_visibility: string | null;
  suggested_confidentiality_level: number;
  supersedes_document_id: string | null;
  created_at: string;
  source_id: string | null;
  extractor_type: string | null;
  extractor_version: string | null;
  extracted_at: string | null;
  is_current: boolean | null;
};

type JobRow = {
  id: string;
  source_id: string;
  status: string;
  total_units: number;
  processed_units: number;
  failed_units: number;
  error_summary: string | null;
  last_error_code: string | null;
  started_at: string | null;
  completed_at: string | null;
  model_calls: number | null;
  estimated_tokens: number | null;
  estimated_cost_usd: number | null;
  cancel_requested: boolean | null;
};

const STATUS_LABEL: Record<string, string> = {
  draft: "下書き",
  review: "レビュー中",
  approved: "承認済み",
  published: "公開",
  archived: "アーカイブ",
  superseded: "更新済み",
};

const REVIEW_TABS = [
  { id: "new", label: "新規" },
  { id: "duplicate", label: "重複" },
  { id: "conflict", label: "矛盾" },
  { id: "possible_update", label: "更新候補" },
  { id: "approved", label: "承認済み" },
  { id: "rejected", label: "却下" },
] as const;

type FactoryTab = "ingest" | "qa" | "review" | "jobs" | "published";

export function KnowledgeAdminClient({
  mode,
  initialTab = "ingest",
}: {
  mode: "dev-sample" | "supabase";
  initialTab?: FactoryTab;
}) {
  const [tab, setTab] = useState<FactoryTab>(initialTab);
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [inbox, setInbox] = useState<InboxRow[]>([]);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [reviewFilter, setReviewFilter] = useState<string>("new");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [expert, setExpert] = useState("");
  const [url, setUrl] = useState("");
  const [domainKey, setDomainKey] = useState("company_common");
  const [clearanceLevel, setClearanceLevel] = useState("company");
  const [visibility, setVisibility] = useState("organization");
  const [sourceDate, setSourceDate] = useState("");
  const [authoritativeSeed, setAuthoritativeSeed] = useState(false);
  const [reviewQuery, setReviewQuery] = useState("");
  const [reviewDomain, setReviewDomain] = useState("");
  const [reviewCurrent, setReviewCurrent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");
  const [pending, startTransition] = useTransition();
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  const refreshDocs = useCallback(() => {
    startTransition(async () => {
      const res = await fetch("/api/knowledge");
      if (!res.ok) return;
      const json = (await res.json()) as { documents?: DocRow[] };
      setDocs(json.documents ?? []);
    });
  }, []);

  const refreshInbox = useCallback(() => {
    startTransition(async () => {
      const params = new URLSearchParams({
        view: "inbox",
        status: reviewFilter,
      });
      if (reviewQuery.trim()) params.set("q", reviewQuery.trim());
      if (reviewDomain) params.set("domain", reviewDomain);
      if (reviewCurrent) params.set("current", reviewCurrent);
      const res = await fetch(`/api/knowledge/factory?${params.toString()}`);
      if (!res.ok) {
        setError("レビュー一覧を取得できませんでした");
        return;
      }
      const json = (await res.json()) as { inbox?: InboxRow[] };
      setInbox(json.inbox ?? []);
      setSelected(new Set());
    });
  }, [reviewFilter, reviewQuery, reviewDomain, reviewCurrent]);

  const refreshJobs = useCallback(() => {
    startTransition(async () => {
      const res = await fetch("/api/knowledge/factory?view=jobs");
      if (!res.ok) return;
      const json = (await res.json()) as { jobs?: JobRow[] };
      setJobs(json.jobs ?? []);
    });
  }, []);

  useEffect(() => {
    if (mode !== "supabase") return;
    refreshDocs();
  }, [mode, refreshDocs]);

  useEffect(() => {
    if (mode !== "supabase") return;
    if (tab === "review") refreshInbox();
    if (tab === "jobs") refreshJobs();
  }, [mode, tab, refreshInbox, refreshJobs]);

  function ingest(payload: Record<string, unknown>) {
    startTransition(async () => {
      setError(null);
      setNotice(null);
      const res = await fetch("/api/knowledge/factory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json()) as { error?: string; duplicate?: boolean };
      if (!res.ok) {
        setError(json.error ?? "取り込みに失敗しました");
        return;
      }
      setNotice(json.duplicate ? "同一内容は既に取り込まれています" : "候補を作成しました。レビューから確認してください。");
      setTitle("");
      setBody("");
      setQuestion("");
      setAnswer("");
      setExpert("");
      setUrl("");
      refreshJobs();
    });
  }

  async function review(id: string, reviewAction: string, extra?: Record<string, unknown>) {
    if (reviewBusy) {
      setError(knowledgeReviewErrorMessage("ALREADY_IN_FLIGHT"));
      return;
    }
    setReviewBusy(true);
    setReviewingId(id);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/knowledge/factory", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "review",
          candidateId: id,
          reviewAction,
          ...extra,
        }),
      });
      let json: FactoryReviewResponse = {};
      try {
        json = (await res.json()) as FactoryReviewResponse;
      } catch {
        json = {};
      }
      const feedback = reviewFeedbackFromResponse({
        httpOk: res.ok,
        body: json,
        kind: "individual",
        action: reviewAction,
      });
      setError(feedback.error);
      setNotice(feedback.notice);
      if (!res.ok) return;
      refreshInbox();
      refreshDocs();
    } catch (err) {
      setError(
        knowledgeReviewErrorMessage(err instanceof Error ? err.message : "failed"),
      );
    } finally {
      setReviewBusy(false);
      setReviewingId(null);
    }
  }

  async function batch(reviewAction: "approve" | "reject") {
    const ids = [...selected];
    if (ids.length === 0) {
      setError(knowledgeReviewErrorMessage("NO_SELECTION"));
      setNotice(null);
      return;
    }
    if (reviewBusy) {
      setError(knowledgeReviewErrorMessage("ALREADY_IN_FLIGHT"));
      return;
    }
    setReviewBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/knowledge/factory", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "batch_review",
          candidateIds: ids,
          reviewAction,
        }),
      });
      let json: FactoryReviewResponse = {};
      try {
        json = (await res.json()) as FactoryReviewResponse;
      } catch {
        json = {};
      }
      const feedback = reviewFeedbackFromResponse({
        httpOk: res.ok,
        body: json,
        kind: "batch",
        action: reviewAction,
      });
      setError(feedback.error);
      setNotice(feedback.notice);
      if (!res.ok) return;
      refreshInbox();
      refreshDocs();
    } catch (err) {
      setError(
        knowledgeReviewErrorMessage(err instanceof Error ? err.message : "failed"),
      );
    } finally {
      setReviewBusy(false);
    }
  }

  function jobAction(jobId: string, action: "process" | "pause" | "resume" | "retry_failed" | "cancel") {
    startTransition(async () => {
      await fetch("/api/knowledge/factory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, jobId }),
      });
      refreshJobs();
    });
  }

  function previewFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    startTransition(async () => {
      setError(null);
      setNotice(null);
      const form = new FormData();
      form.set("preview", "1");
      for (const file of Array.from(list)) form.append("files", file);
      const res = await fetch("/api/knowledge/factory", {
        method: "POST",
        body: form,
      });
      const json = (await res.json()) as {
        error?: string;
        previews?: Array<{
          filename: string;
          title: string;
          text: string;
          limitation: string | null;
          charCount: number;
        }>;
      };
      if (!res.ok) {
        setError(json.error ?? "ファイルを読み取れませんでした");
        return;
      }
      const first = json.previews?.[0];
      if (!first) {
        setError("ファイルを読み取れませんでした");
        return;
      }
      if (!title.trim()) setTitle(first.title);
      if (first.text) setBody(first.text);
      const extra = (json.previews?.length ?? 1) - 1;
      if (first.limitation && !first.text) {
        setError(`${first.filename}: 本文を抽出できませんでした（${first.limitation}）`);
        return;
      }
      setNotice(
        extra > 0
          ? `${first.filename} から本文を読みました。大量投入は CLI を使ってください。`
          : `${first.filename} から本文を読みました。領域と閲覧権限を確認して取り込んでください。`,
      );
    });
  }

  function createDraft() {
    startTransition(async () => {
      setError(null);
      const res = await fetch("/api/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, body }),
      });
      if (!res.ok) {
        setError("作成に失敗しました。権限と入力を確認してください。");
        return;
      }
      setTitle("");
      setBody("");
      refreshDocs();
    });
  }

  function advance(doc: DocRow) {
    const next =
      doc.status === "draft"
        ? "review"
        : doc.status === "review"
          ? "approved"
          : doc.status === "approved"
            ? "published"
            : null;
    if (!next) return;
    startTransition(async () => {
      setError(null);
      const res = await fetch("/api/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "transition",
          documentId: doc.id,
          from: doc.status,
          to: next,
        }),
      });
      if (!res.ok) {
        setError("状態変更に失敗しました");
        return;
      }
      refreshDocs();
    });
  }

  if (mode === "dev-sample") {
    return null;
  }

  const fieldClass =
    "mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-[14px] text-text";
  const labelClass = "block text-[12px] text-text-secondary";

  return (
    <div className="space-y-6">
      <nav className="flex flex-wrap gap-3 border-b border-border pb-2 text-[13px]">
        {(
          [
            ["ingest", "取り込む"],
            ["qa", "Q&Aを追加"],
            ["review", "レビュー"],
            ["jobs", "処理状況"],
            ["published", "公開ナレッジ"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={
              tab === id
                ? "font-medium text-accent"
                : "text-text-secondary hover:text-text"
            }
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>

      {error ? (
        <p className="text-[12px] text-red-700" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="text-[12px] text-text-secondary" aria-live="polite">
          {notice}
        </p>
      ) : null}

      {tab === "ingest" ? (
        <section className="space-y-3">
          <h2 className="text-[14px] font-medium text-text">テキスト・URL・ファイル</h2>
          <p className="text-[12px] text-text-secondary">
            原文を保持したまま候補を作ります。公開はレビュー後です。領域は検索対象、閲覧権限は誰が見られるかで、別々に選びます。大量投入は CLI を使います。
          </p>
          <label className={labelClass}>
            ファイル（txt / md / PDF / DOCX / XLSX / CSV）
            <input
              className="mt-1 block text-[13px]"
              type="file"
              accept=".txt,.md,.csv,.pdf,.docx,.xlsx,text/plain,text/markdown,text/csv,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => {
                previewFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
          <label className={labelClass}>
            タイトル
            <input className={fieldClass} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
          </label>
          <label className={labelClass}>
            本文
            <textarea
              className={`${fieldClass} min-h-[120px]`}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </label>
          <label className={labelClass}>
            領域（検索・参照対象）
            <select className={fieldClass} value={domainKey} onChange={(e) => setDomainKey(e.target.value)}>
              {DOMAIN_OPTIONS.map((d) => (
                <option key={d.key} value={d.key}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            閲覧権限（機密区分）
            <select
              className={fieldClass}
              value={clearanceLevel}
              onChange={(e) => setClearanceLevel(e.target.value)}
            >
              {CLEARANCE_OPTIONS.map((d) => (
                <option key={d.key} value={d.key}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            公開範囲
            <select className={fieldClass} value={visibility} onChange={(e) => setVisibility(e.target.value)}>
              {VISIBILITY_OPTIONS.map((d) => (
                <option key={d.key} value={d.key}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            情報の日付（任意）
            <input
              type="date"
              className={fieldClass}
              value={sourceDate}
              onChange={(e) => setSourceDate(e.target.value)}
            />
          </label>
          <label className="flex items-center gap-2 text-[13px] text-text">
            <input
              type="checkbox"
              checked={authoritativeSeed}
              onChange={(e) => setAuthoritativeSeed(e.target.checked)}
            />
            現在確定している会社情報（シード）。1件が1候補になり、レビューは省略しません。
          </label>
          <button
            type="button"
            className="rounded-md bg-accent px-4 py-2 text-[14px] text-white disabled:opacity-50"
            disabled={pending || !title.trim() || !body.trim()}
            onClick={() =>
              ingest({
                originKind: authoritativeSeed ? "authoritative_seed" : "paste",
                importMode: authoritativeSeed ? "structured" : "source",
                title,
                text: body,
                domainKeys: [domainKey],
                confidentialityLevel: clearanceLevel,
                visibility,
                sourceDate: sourceDate || undefined,
              })
            }
          >
            候補として取り込む
          </button>
          <label className={labelClass}>
            URL
            <input
              className={fieldClass}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://"
            />
          </label>
          <button
            type="button"
            className="text-[13px] text-accent underline-offset-2 hover:underline disabled:opacity-50"
            disabled={pending || !url.trim()}
            onClick={() =>
              ingest({
                originKind: "url",
                title: title || url,
                url,
                domainKeys: [domainKey],
                confidentialityLevel: clearanceLevel,
                visibility,
              })
            }
          >
            URLから取り込む
          </button>
        </section>
      ) : null}

      {tab === "qa" ? (
        <section className="space-y-3">
          <h2 className="text-[14px] font-medium text-text">Q&Aを追加</h2>
          <p className="text-[12px] text-text-secondary">
            原文の質問と回答は残します。人物名は情報源として保持できます。公開はレビュー後です。
          </p>
          <label className={labelClass}>
            質問
            <textarea
              className={`${fieldClass} min-h-[72px]`}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
            />
          </label>
          <label className={labelClass}>
            回答
            <textarea
              className={`${fieldClass} min-h-[120px]`}
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
            />
          </label>
          <label className={labelClass}>
            専門家 / 情報源（任意）
            <input className={fieldClass} value={expert} onChange={(e) => setExpert(e.target.value)} />
          </label>
          <label className={labelClass}>
            領域（検索・参照対象）
            <select className={fieldClass} value={domainKey} onChange={(e) => setDomainKey(e.target.value)}>
              {DOMAIN_OPTIONS.map((d) => (
                <option key={d.key} value={d.key}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            閲覧権限（機密区分）
            <select
              className={fieldClass}
              value={clearanceLevel}
              onChange={(e) => setClearanceLevel(e.target.value)}
            >
              {CLEARANCE_OPTIONS.map((d) => (
                <option key={d.key} value={d.key}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            公開範囲
            <select className={fieldClass} value={visibility} onChange={(e) => setVisibility(e.target.value)}>
              {VISIBILITY_OPTIONS.map((d) => (
                <option key={d.key} value={d.key}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            情報の日付（任意）
            <input
              type="date"
              className={fieldClass}
              value={sourceDate}
              onChange={(e) => setSourceDate(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="rounded-md bg-accent px-4 py-2 text-[14px] text-white disabled:opacity-50"
            disabled={pending || !question.trim() || !answer.trim()}
            onClick={() =>
              ingest({
                originKind: "qa",
                importMode: "qa",
                title: question.slice(0, 120),
                question,
                answer,
                expertName: expert || undefined,
                domainKeys: [domainKey],
                confidentialityLevel: clearanceLevel,
                visibility,
                sourceDate: sourceDate || undefined,
              })
            }
          >
            Q&Aを候補にする
          </button>
        </section>
      ) : null}

      {tab === "review" ? (
        <section className="space-y-3">
          <h2 className="text-[14px] font-medium text-text">レビュー</h2>
          <p className="text-[12px] text-text-secondary" aria-live="polite">
            {reviewBusy ? "公開しています…" : null}
          </p>
          <div className="flex flex-wrap gap-2 text-[12px]">
            {REVIEW_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                className={
                  reviewFilter === t.id
                    ? "rounded-md bg-accent px-2 py-1 text-white"
                    : "rounded-md border border-border px-2 py-1"
                }
                onClick={() => setReviewFilter(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <input
              className={fieldClass}
              placeholder="タイトル検索"
              value={reviewQuery}
              onChange={(e) => setReviewQuery(e.target.value)}
            />
            <select className={fieldClass} value={reviewDomain} onChange={(e) => setReviewDomain(e.target.value)}>
              <option value="">すべての領域</option>
              {DOMAIN_OPTIONS.map((d) => (
                <option key={d.key} value={d.key}>
                  {d.label}
                </option>
              ))}
            </select>
            <select className={fieldClass} value={reviewCurrent} onChange={(e) => setReviewCurrent(e.target.value)}>
              <option value="">現在 / 過去</option>
              <option value="true">現在</option>
              <option value="false">過去</option>
            </select>
          </div>
          {reviewFilter === "new" || reviewFilter === "possible_update" ? (
            <button
              type="button"
              className="text-[13px] text-accent underline-offset-2 hover:underline disabled:opacity-50"
              disabled={reviewBusy || selected.size === 0}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                void batch("approve");
              }}
            >
              {reviewBusy ? "公開しています…" : "選択を一括承認（矛盾は対象外）"}
            </button>
          ) : null}
          {inbox.length === 0 ? (
            <EmptyState title="該当する候補はありません" description="" />
          ) : (
            inbox.map((row) => (
              <ListRow key={row.id}>
                <label className="mt-1 shrink-0">
                  <input
                    type="checkbox"
                    checked={selected.has(row.id)}
                    onChange={(e) => {
                      const next = new Set(selected);
                      if (e.target.checked) next.add(row.id);
                      else next.delete(row.id);
                      setSelected(next);
                    }}
                    aria-label="選択"
                  />
                </label>
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="truncate text-[14px] font-medium">{row.title}</p>
                  <p className="text-[12px] text-text-secondary">
                    {row.candidate_type} · {row.fact_status} · {row.conflict_kind}
                    {row.conflict_reason ? `（${row.conflict_reason}）` : ""} ·{" "}
                    {(row.domain_keys ?? []).join(", ")}
                    {row.source_quality != null ? ` · 品質 ${row.source_quality}` : ""}
                    {row.is_current === false ? " · 過去" : " · 現在"}
                  </p>
                  <p className="text-[12px] text-text-secondary">
                    抽出 {row.extracted_at ? new Date(row.extracted_at).toLocaleString("ja-JP") : "—"}
                    {row.extractor_version ? ` · ${row.extractor_version}` : ""}
                  </p>
                  {row.source_excerpt ? (
                    <p className="text-[12px] text-text-secondary">原文: {row.source_excerpt.slice(0, 240)}</p>
                  ) : null}
                  {row.summary ? (
                    <p className="text-[12px]">{row.summary.slice(0, 280)}</p>
                  ) : null}
                  {row.supersedes_document_id ? (
                    <p className="text-[12px] text-text-secondary">
                      既存ナレッジの更新候補です。古い事実は残し、必要なら置き換えを指定してください。
                    </p>
                  ) : null}
                  {row.review_status === "new" ||
                  row.review_status === "possible_update" ||
                  row.review_status === "conflict" ||
                  row.review_status === "duplicate" ? (
                    <div className="flex flex-wrap gap-3 pt-1 text-[13px]">
                      {row.conflict_kind === "conflict" ? (
                        <button
                          type="button"
                          className="text-accent underline-offset-2 hover:underline disabled:opacity-50"
                          disabled={reviewBusy}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            void review(row.id, "supersede");
                          }}
                        >
                          {reviewBusy && reviewingId === row.id ? "公開しています…" : "置き換えて承認"}
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="text-accent underline-offset-2 hover:underline disabled:opacity-50"
                          disabled={reviewBusy}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            void review(row.id, "approve");
                          }}
                        >
                          {reviewBusy && reviewingId === row.id ? "公開しています…" : "承認して公開"}
                        </button>
                      )}
                      <button
                        type="button"
                        className="text-accent underline-offset-2 hover:underline disabled:opacity-50"
                        disabled={reviewBusy || !editTitle.trim()}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          void review(row.id, "edit_approve", {
                            title: editTitle || row.title,
                            content: editBody || row.summary,
                          });
                        }}
                      >
                        編集して承認
                      </button>
                      <button
                        type="button"
                        className="text-text-secondary underline-offset-2 hover:underline disabled:opacity-50"
                        disabled={reviewBusy}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          void review(row.id, "mark_duplicate");
                        }}
                      >
                        重複
                      </button>
                      <button
                        type="button"
                        className="text-text-secondary underline-offset-2 hover:underline disabled:opacity-50"
                        disabled={reviewBusy}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          void review(row.id, "reject");
                        }}
                      >
                        却下
                      </button>
                    </div>
                  ) : null}
                </div>
              </ListRow>
            ))
          )}
          <div className="space-y-2 border-t border-border pt-3">
            <p className="text-[12px] text-text-secondary">編集して承認する場合の上書き（任意）</p>
            <input
              className={fieldClass}
              placeholder="タイトル"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
            />
            <textarea
              className={`${fieldClass} min-h-[72px]`}
              placeholder="本文"
              value={editBody}
              onChange={(e) => setEditBody(e.target.value)}
            />
          </div>
        </section>
      ) : null}

      {tab === "jobs" ? (
        <section className="space-y-2">
          <h2 className="text-[14px] font-medium text-text">処理状況</h2>
          {jobs.length === 0 ? (
            <EmptyState title="処理中の取り込みはありません" description="" />
          ) : (
            jobs.map((job) => (
              <ListRow key={job.id}>
                <div className="min-w-0 flex-1">
                  <p className="text-[14px]">
                    {job.processed_units} / {job.total_units} 分割
                  </p>
                  <p className="text-[12px] text-text-secondary">
                    {job.status}
                    {job.failed_units ? ` · 失敗 ${job.failed_units}` : ""}
                    {job.error_summary ? ` · ${job.error_summary}` : ""}
                    {job.model_calls ? ` · 推定呼び出し ${job.model_calls}` : ""}
                    {job.estimated_cost_usd
                      ? ` · 推定コスト $${Number(job.estimated_cost_usd).toFixed(4)}`
                      : ""}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {job.status === "processing" || job.status === "pending" || job.status === "paused" ? (
                    <button
                      type="button"
                      className="text-[13px] text-accent underline-offset-2 hover:underline"
                      disabled={pending}
                      onClick={() => jobAction(job.id, job.status === "paused" ? "resume" : "process")}
                    >
                      {job.status === "paused" ? "再開" : "続きを処理"}
                    </button>
                  ) : null}
                  {job.status === "processing" || job.status === "pending" ? (
                    <button
                      type="button"
                      className="text-[13px] text-text-secondary underline-offset-2 hover:underline"
                      disabled={pending}
                      onClick={() => jobAction(job.id, "pause")}
                    >
                      一時停止
                    </button>
                  ) : null}
                  {job.status === "failed" || (job.failed_units ?? 0) > 0 ? (
                    <button
                      type="button"
                      className="text-[13px] text-accent underline-offset-2 hover:underline"
                      disabled={pending}
                      onClick={() => jobAction(job.id, "retry_failed")}
                    >
                      失敗を再試行
                    </button>
                  ) : null}
                  {job.status === "pending" || job.status === "processing" || job.status === "paused" ? (
                    <button
                      type="button"
                      className="text-[13px] text-text-secondary underline-offset-2 hover:underline"
                      disabled={pending}
                      onClick={() => jobAction(job.id, "cancel")}
                    >
                      未処理を取消
                    </button>
                  ) : null}
                </div>
              </ListRow>
            ))
          )}
        </section>
      ) : null}

      {tab === "published" ? (
        <>
          <section className="space-y-3">
            <h2 className="text-[14px] font-medium text-text">手動で下書きを追加</h2>
            <p className="text-[12px] text-text-secondary">
              下書き → レビュー → 承認 → 公開の順。公開時に検索用チャンクを生成します。
            </p>
            <label className={labelClass}>
              タイトル
              <input
                className={fieldClass}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={200}
              />
            </label>
            <label className={labelClass}>
              本文
              <textarea
                className={`${fieldClass} min-h-[120px]`}
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            </label>
            <button
              type="button"
              className="rounded-md bg-accent px-4 py-2 text-[14px] text-white disabled:opacity-50"
              disabled={pending || !title.trim() || !body.trim()}
              onClick={createDraft}
            >
              下書きを作成
            </button>
          </section>
          <section className="space-y-2">
            <h2 className="text-[14px] font-medium text-text">管理中のナレッジ</h2>
            {docs.length === 0 ? (
              <EmptyState title="まだナレッジがありません" description="取り込みまたは下書きから追加してください。" />
            ) : (
              docs.map((d) => (
                <ListRow key={d.id}>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-medium">{d.title}</p>
                    <p className="text-[12px] text-text-secondary">
                      {STATUS_LABEL[d.status] ?? d.status} · {d.visibility} · L
                      {d.confidentiality_level}
                    </p>
                  </div>
                  {d.status === "draft" || d.status === "review" || d.status === "approved" ? (
                    <button
                      type="button"
                      className="shrink-0 text-[13px] text-accent underline-offset-2 hover:underline disabled:opacity-50"
                      disabled={pending}
                      onClick={() => advance(d)}
                    >
                      {d.status === "draft"
                        ? "レビューへ"
                        : d.status === "review"
                          ? "承認する"
                          : "公開する"}
                    </button>
                  ) : null}
                </ListRow>
              ))
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}

export function KnowledgePageHeader({
  mode,
  sampleRows,
}: {
  mode: "dev-sample" | "supabase";
  sampleRows: readonly {
    id: string;
    title: string;
    category: string;
    business: string;
  }[];
}) {
  return (
    <div className="space-y-6">
      <PageHeader
        title="ナレッジ"
        description={
          mode === "dev-sample"
            ? "承認済みナレッジの一覧です"
            : "資料・Q&A・会話から候補を作り、レビュー後に検索へ公開します。"
        }
      />
      {mode === "dev-sample" ? (
        sampleRows.length === 0 ? (
          <EmptyState title="表示できるナレッジはありません" description="" />
        ) : (
          sampleRows.map((k) => (
            <ListRow key={k.id}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-medium">{k.title}</p>
                <p className="text-[12px] text-text-secondary">
                  {k.category} · {k.business}
                </p>
              </div>
            </ListRow>
          ))
        )
      ) : (
        <KnowledgeAdminClient mode={mode} />
      )}
    </div>
  );
}
