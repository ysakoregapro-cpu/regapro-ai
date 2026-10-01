"use client";

import { useCallback, useEffect, useState } from "react";

type Perms = { view: boolean; manage: boolean };

type SalesCase = {
  id: string;
  occurredOn: string;
  title: string;
  totalAmountYen: number;
  status: string;
  allocations: Array<{ staffId: string; amountYen: number; shareRateBps: number }>;
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

export default function SalesClient() {
  const [perms, setPerms] = useState<Perms | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cases, setCases] = useState<SalesCase[]>([]);
  const [staffId, setStaffId] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const session = await api<{ membership?: { permissions?: string[]; staffId?: string } }>(
          "/api/auth/session",
        );
        const keys = new Set(session.membership?.permissions ?? []);
        if (!cancelled) {
          setPerms({
            view: keys.has("sales.view_own") || keys.has("sales.manage"),
            manage: keys.has("sales.manage"),
          });
          if (session.membership?.staffId) setStaffId(session.membership.staffId);
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
    const data = await api<{ cases: SalesCase[] }>("/api/work/sales/cases");
    setCases(data.cases ?? []);
  }, []);

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

  async function createSample() {
    if (!staffId) {
      setError("担当者が特定できません");
      return;
    }
    try {
      setError(null);
      await api("/api/work/sales/cases", {
        method: "POST",
        body: JSON.stringify({
          staffId,
          occurredOn: tokyoToday(),
          title: "案件売上",
          totalAmountYen: 100000,
          allocations: [{ staffId, shareRateBps: 10000, amountYen: 100000 }],
        }),
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "登録に失敗しました");
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
        <h1 className="text-lg font-semibold">売上</h1>
        <dl className="mt-2 grid gap-1 text-[13px] text-[var(--color-text)]/80 sm:grid-cols-3">
          <div>
            <dt className="font-medium">今やること</dt>
            <dd>{perms.manage ? "案件登録・按分確認" : "自分の按分を確認"}</dd>
          </div>
          <div>
            <dt className="font-medium">対象と状態</dt>
            <dd>personal_sales_cases（active）</dd>
          </div>
          <div>
            <dt className="font-medium">次の操作</dt>
            <dd>{perms.manage ? "案件を登録" : "一覧を更新"}</dd>
          </div>
        </dl>
      </header>

      {error ? (
        <p className="mb-4 text-[13px] text-red-700" role="alert">
          {error}
        </p>
      ) : null}

      {perms.manage ? (
        <button
          type="button"
          className="mb-4 rounded-md bg-[#0F766E] px-4 py-2 text-[13px] text-white"
          onClick={() => void createSample()}
        >
          案件を登録（単独按分）
        </button>
      ) : null}

      <ul className="divide-y divide-[var(--color-border)] border border-[var(--color-border)] rounded-md bg-[var(--color-surface)]">
        {cases.length === 0 ? (
          <li className="px-3 py-4 text-[13px] text-[var(--color-text)]/70">該当なし</li>
        ) : (
          cases.map((c) => (
            <li key={c.id} className="px-3 py-3 text-[13px]">
              <div className="flex flex-wrap gap-2">
                <span className="font-medium">{c.occurredOn}</span>
                <span>{c.title}</span>
                <span>{c.totalAmountYen.toLocaleString()}円</span>
                <span className="text-[var(--color-text)]/70">{c.status}</span>
              </div>
              <ul className="mt-1 text-[12px] text-[var(--color-text)]/75">
                {c.allocations.map((a) => (
                  <li key={`${c.id}-${a.staffId}`}>
                    {a.staffId.slice(0, 8)}… {a.amountYen.toLocaleString()}円 (
                    {(a.shareRateBps / 100).toFixed(1)}%)
                  </li>
                ))}
              </ul>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
