"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Perms = { submit: boolean; view: boolean; manage: boolean };
type Tab = "mine" | "review";

type Category = { id: string; code: string; name: string };
type Application = {
  id: string;
  staffId: string;
  status: string;
  applicationType: string;
  categoryId: string;
  amountYen: number;
  expenseDate: string;
  description: string;
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.ok === false) {
    throw new Error(json.message ?? `HTTP ${res.status}`);
  }
  return json as T;
}

function tokyoToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tokyo" });
}

export default function ExpenseClient() {
  const [perms, setPerms] = useState<Perms | null>(null);
  const [tab, setTab] = useState<Tab>("mine");
  const [error, setError] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [returnReason, setReturnReason] = useState("");
  const [form, setForm] = useState({
    applicationType: "after" as "advance" | "after",
    categoryId: "",
    amountYen: "",
    expenseDate: tokyoToday(),
    description: "",
  });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const session = await api<{ membership?: { permissions?: string[] } }>("/api/auth/session");
        const keys = new Set(session.membership?.permissions ?? []);
        const next: Perms = {
          submit: keys.has("expense.submit") || keys.has("expense.manage"),
          view: keys.has("expense.view_own") || keys.has("expense.submit") || keys.has("expense.manage"),
          manage: keys.has("expense.manage"),
        };
        if (!cancelled) {
          setPerms(next);
          setTab(next.manage ? "review" : "mine");
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "権限の取得に失敗しました");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback(async () => {
    const cats = await api<{ categories: Category[] }>("/api/work/expense/categories");
    setCategories(cats.categories ?? []);
    if (!form.categoryId && cats.categories?.[0]) {
      setForm((f) => ({ ...f, categoryId: cats.categories[0].id }));
    }
    const q = tab === "review" ? "?status=pending" : "";
    const data = await api<{ applications: Application[] }>(`/api/work/expense/applications${q}`);
    setApplications(data.applications ?? []);
  }, [tab, form.categoryId]);

  useEffect(() => {
    if (!perms?.view) return;
    let cancelled = false;
    void (async () => {
      try {
        setError(null);
        await load();
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "読み込み失敗");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [perms, load]);

  const categoryName = useMemo(() => {
    const map = new Map(categories.map((c) => [c.id, c.name]));
    return (id: string) => map.get(id) ?? id.slice(0, 8);
  }, [categories]);

  async function saveDraft() {
    const amount = Number(form.amountYen);
    if (!Number.isInteger(amount) || amount <= 0) {
      setError("金額を入力してください");
      return;
    }
    try {
      setError(null);
      await api("/api/work/expense/applications", {
        method: "POST",
        body: JSON.stringify({
          applicationType: form.applicationType,
          categoryId: form.categoryId,
          amountYen: amount,
          expenseDate: form.expenseDate,
          description: form.description,
        }),
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存に失敗しました");
    }
  }

  async function submit(id: string) {
    try {
      setError(null);
      await api(`/api/work/expense/applications/${id}/submit`, { method: "POST" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "提出に失敗しました");
    }
  }

  async function approve(id: string) {
    try {
      setError(null);
      await api(`/api/work/expense/applications/${id}/approve`, { method: "POST" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "承認に失敗しました");
    }
  }

  async function returnApp(id: string) {
    if (returnReason.trim().length < 3) {
      setError("差戻し理由を入力してください");
      return;
    }
    try {
      setError(null);
      await api(`/api/work/expense/applications/${id}/return`, {
        method: "POST",
        body: JSON.stringify({ reason: returnReason }),
      });
      setReturnReason("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "差戻しに失敗しました");
    }
  }

  if (!perms) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-6 text-[13px] text-[var(--color-text)]/70">
        読み込み中…
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 text-[var(--color-text)]">
      <header className="mb-6 border-b border-[var(--color-border)] pb-4">
        <h1 className="text-lg font-semibold text-[var(--color-text)]">経費</h1>
        <dl className="mt-2 grid gap-1 text-[13px] text-[var(--color-text)]/80 sm:grid-cols-3">
          <div>
            <dt className="font-medium text-[var(--color-text)]">今やること</dt>
            <dd>{tab === "review" ? "承認待ちの確認" : "下書きの作成・提出"}</dd>
          </div>
          <div>
            <dt className="font-medium text-[var(--color-text)]">対象と状態</dt>
            <dd>{tab === "review" ? "pending 申請" : "自分の draft / returned"}</dd>
          </div>
          <div>
            <dt className="font-medium text-[var(--color-text)]">次の操作</dt>
            <dd>{tab === "review" ? "承認または差戻し" : "保存して提出"}</dd>
          </div>
        </dl>
      </header>

      <nav className="mb-4 flex flex-wrap gap-2 text-[13px]" aria-label="経費セクション">
        {perms.submit ? (
          <button
            type="button"
            onClick={() => setTab("mine")}
            className={
              tab === "mine"
                ? "rounded-md bg-[#0F766E] px-3 py-2 text-white"
                : "rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2"
            }
          >
            自分の申請
          </button>
        ) : null}
        {perms.manage ? (
          <button
            type="button"
            onClick={() => setTab("review")}
            className={
              tab === "review"
                ? "rounded-md bg-[#0F766E] px-3 py-2 text-white"
                : "rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2"
            }
          >
            承認待ち
          </button>
        ) : null}
      </nav>

      {error ? (
        <p className="mb-4 text-[13px] text-red-700" role="alert">
          {error}
        </p>
      ) : null}

      {tab === "mine" && perms.submit ? (
        <section className="mb-8 border-b border-[var(--color-border)] pb-6">
          <h2 className="mb-3 text-[14px] font-medium">新規下書き</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-[13px]">
              区分
              <select
                className="mt-1 w-full rounded-md border border-[var(--color-border)] px-2 py-2"
                value={form.applicationType}
                onChange={(e) =>
                  setForm({ ...form, applicationType: e.target.value as "advance" | "after" })
                }
              >
                <option value="after">事後精算</option>
                <option value="advance">事前申請</option>
              </select>
            </label>
            <label className="text-[13px]">
              カテゴリ
              <select
                className="mt-1 w-full rounded-md border border-[var(--color-border)] px-2 py-2"
                value={form.categoryId}
                onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
              >
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[13px]">
              日付
              <input
                type="date"
                className="mt-1 w-full rounded-md border border-[var(--color-border)] px-2 py-2"
                value={form.expenseDate}
                onChange={(e) => setForm({ ...form, expenseDate: e.target.value })}
              />
            </label>
            <label className="text-[13px]">
              金額（円）
              <input
                type="number"
                className="mt-1 w-full rounded-md border border-[var(--color-border)] px-2 py-2"
                value={form.amountYen}
                onChange={(e) => setForm({ ...form, amountYen: e.target.value })}
              />
            </label>
            <label className="text-[13px] sm:col-span-2">
              内容
              <input
                type="text"
                className="mt-1 w-full rounded-md border border-[var(--color-border)] px-2 py-2"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </label>
          </div>
          <button
            type="button"
            onClick={() => void saveDraft()}
            className="mt-4 rounded-md bg-[#0F766E] px-4 py-2 text-[13px] text-white"
          >
            下書き保存
          </button>
        </section>
      ) : null}

      <section>
        <h2 className="mb-2 text-[14px] font-medium">
          {tab === "review" ? "承認待ち一覧" : "申請一覧"}
        </h2>
        <ul className="divide-y divide-[var(--color-border)] border border-[var(--color-border)] rounded-md bg-[var(--color-surface)]">
          {applications.length === 0 ? (
            <li className="px-3 py-4 text-[13px] text-[var(--color-text)]/70">該当なし</li>
          ) : (
            applications.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-2 px-3 py-3 text-[13px]">
                <span className="font-medium">{a.expenseDate}</span>
                <span>{categoryName(a.categoryId)}</span>
                <span>{a.amountYen.toLocaleString()}円</span>
                <span className="text-[var(--color-text)]/70">{a.status}</span>
                <span className="flex-1 truncate">{a.description}</span>
                {tab === "mine" && (a.status === "draft" || a.status === "returned") ? (
                  <button
                    type="button"
                    className="text-[#0F766E] underline"
                    onClick={() => void submit(a.id)}
                  >
                    提出
                  </button>
                ) : null}
                {tab === "review" && a.status === "pending" ? (
                  <>
                    <button
                      type="button"
                      className="rounded-md bg-[#0F766E] px-2 py-1 text-white"
                      onClick={() => void approve(a.id)}
                    >
                      承認
                    </button>
                    <button
                      type="button"
                      className="rounded-md border border-[var(--color-border)] px-2 py-1"
                      onClick={() => void returnApp(a.id)}
                    >
                      差戻し
                    </button>
                  </>
                ) : null}
              </li>
            ))
          )}
        </ul>
        {tab === "review" && perms.manage ? (
          <label className="mt-3 block text-[13px]">
            差戻し理由（差戻しボタンとセット）
            <input
              type="text"
              className="mt-1 w-full rounded-md border border-[var(--color-border)] px-2 py-2"
              value={returnReason}
              onChange={(e) => setReturnReason(e.target.value)}
            />
          </label>
        ) : null}
      </section>
    </div>
  );
}
