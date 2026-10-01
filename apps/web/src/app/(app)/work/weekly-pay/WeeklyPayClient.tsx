"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Perms = {
  submit: boolean;
  review: boolean;
  pay: boolean;
  manage: boolean;
};

type Application = {
  id: string;
  staffId: string;
  weekStart: string;
  weekEnd: string;
  paymentDate: string;
  status: string;
  totalAmountYen: number;
};

type Batch = {
  id: string;
  status: string;
  bankTransferDate: string;
  scheduledPaymentDate: string | null;
  itemCount: number;
  totalAmountYen: number;
  contentFingerprint: string;
  exportCount: number;
  items?: BatchItem[];
};

type BatchItem = {
  id: string;
  applicationId: string;
  staffId: string;
  amountYen: number;
  accountNumberLast4: string;
  accountHolderKana: string;
  bankCode: string;
  branchCode: string;
  outcome: string;
  weekStart: string;
};

type Transferor = {
  consignorCode: string;
  requesterNameKana: string;
  sourceBankCode: string;
  sourceBranchCode: string;
  sourceAccountType: string;
  sourceAccountNumberLast4: string;
} | null;

type Settlement = {
  id: string;
  applicationId: string;
  amountYen: number;
  paidOn: string;
  weekStart: string;
  weekEnd: string;
};

type BankAccount = {
  id: string;
  bankName: string;
  branchName: string;
  accountType: string;
  accountNumberLast4: string;
  accountHolderKana: string;
  status: string;
};

type Tab =
  | "mine"
  | "bank"
  | "review"
  | "approved"
  | "batches"
  | "transferor"
  | "ledger";

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.ok === false) {
    throw new Error(json.message ?? `HTTP ${res.status}`);
  }
  return json as T;
}

function canRecordResults(status: string): boolean {
  return status === "bank_submitted" || status === "settling";
}

export default function WeeklyPayClient() {
  const [perms, setPerms] = useState<Perms | null>(null);
  const [tab, setTab] = useState<Tab>("mine");
  const [error, setError] = useState<string | null>(null);
  const [apps, setApps] = useState<Application[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [transferDate, setTransferDate] = useState("");
  const [batches, setBatches] = useState<Batch[]>([]);
  const [activeBatch, setActiveBatch] = useState<Batch | null>(null);
  const [transferor, setTransferor] = useState<Transferor>(null);
  const [ledger, setLedger] = useState<Settlement[]>([]);
  const [banks, setBanks] = useState<BankAccount[]>([]);
  const [returnReason, setReturnReason] = useState("");
  const [resultForm, setResultForm] = useState<{
    itemId: string;
    outcome: "paid" | "failed" | "unknown";
    paidOn: string;
    bankTransactionRef: string;
    evidenceNote: string;
    failureReason: string;
  } | null>(null);
  const [xferForm, setXferForm] = useState({
    consignorCode: "",
    requesterNameKana: "",
    sourceBankCode: "",
    sourceBranchCode: "",
    sourceAccountType: "ordinary",
    sourceAccountNumber: "",
  });
  const [bankForm, setBankForm] = useState({
    bankName: "",
    bankCode: "",
    branchName: "",
    branchCode: "",
    accountType: "ordinary",
    accountNumber: "",
    accountHolderKana: "",
  });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const session = await api<{
          membership?: { permissions?: string[] };
        }>("/api/auth/session");
        const keys = new Set(session.membership?.permissions ?? []);
        const next: Perms = {
          submit: keys.has("weekly_pay.submit") || keys.has("weekly_pay.manage"),
          review: keys.has("weekly_pay.review") || keys.has("weekly_pay.manage"),
          pay: keys.has("weekly_pay.pay") || keys.has("weekly_pay.manage"),
          manage: keys.has("weekly_pay.manage"),
        };
        if (!cancelled) {
          setPerms(next);
          if (next.pay) setTab("approved");
          else if (next.review) setTab("review");
          else setTab("mine");
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "権限の取得に失敗しました");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const tabs = useMemo(() => {
    if (!perms) return [] as { id: Tab; label: string }[];
    const list: { id: Tab; label: string }[] = [];
    if (perms.submit) {
      list.push({ id: "mine", label: "自分の申請" });
      list.push({ id: "bank", label: "振込口座" });
    }
    if (perms.review) list.push({ id: "review", label: "承認・差戻し" });
    if (perms.pay) {
      list.push({ id: "approved", label: "承認済み→バッチ" });
      list.push({ id: "batches", label: "支払バッチ" });
      list.push({ id: "transferor", label: "振込元設定" });
    }
    if (perms.submit || perms.pay) list.push({ id: "ledger", label: "精算台帳" });
    return list;
  }, [perms]);

  const loadApps = useCallback(async (status?: string) => {
    const q = status ? `?status=${encodeURIComponent(status)}` : "";
    const data = await api<{ applications: Application[] }>(
      `/api/work/weekly-pay/applications${q}`,
    );
    setApps(data.applications ?? []);
  }, []);

  const loadBatches = useCallback(async () => {
    const data = await api<{ batches: Batch[] }>("/api/work/weekly-pay/payment-batches");
    setBatches(data.batches ?? []);
  }, []);

  const loadTransferor = useCallback(async () => {
    const data = await api<{ settings: Transferor }>(
      "/api/work/weekly-pay/transferor-settings",
    );
    setTransferor(data.settings);
  }, []);

  const loadLedger = useCallback(async () => {
    const data = await api<{ entries: Settlement[] }>(
      "/api/work/weekly-pay/settlement-ledger",
    );
    setLedger(data.entries ?? []);
  }, []);

  const loadBanks = useCallback(async () => {
    const data = await api<{ bankAccounts: BankAccount[] }>(
      "/api/work/weekly-pay/bank-accounts",
    );
    setBanks(data.bankAccounts ?? []);
  }, []);

  useEffect(() => {
    if (!perms) return;
    let cancelled = false;
    const run = async () => {
      try {
        if (tab === "mine") await loadApps();
        if (tab === "review") await loadApps("submitted");
        if (tab === "approved") await loadApps("approved");
        if (tab === "batches") await loadBatches();
        if (tab === "transferor") await loadTransferor();
        if (tab === "ledger") await loadLedger();
        if (tab === "bank") await loadBanks();
        if (!cancelled) setError(null);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "読み込みに失敗しました");
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [tab, perms, loadApps, loadBatches, loadTransferor, loadLedger, loadBanks]);

  const selectedTotal = useMemo(
    () =>
      apps
        .filter((a) => selected.has(a.id))
        .reduce((s, a) => s + a.totalAmountYen, 0),
    [apps, selected],
  );

  async function submitApp(id: string) {
    setError(null);
    try {
      await api(`/api/work/weekly-pay/applications/${id}/submit`, { method: "POST" });
      await loadApps();
    } catch (e) {
      setError(e instanceof Error ? e.message : "提出に失敗しました");
    }
  }

  async function approveApp(id: string) {
    setError(null);
    try {
      await api(`/api/work/weekly-pay/applications/${id}/approve`, { method: "POST" });
      await loadApps("submitted");
    } catch (e) {
      setError(e instanceof Error ? e.message : "承認に失敗しました");
    }
  }

  async function returnApp(id: string) {
    if (!returnReason.trim()) {
      setError("差戻し理由を入力してください");
      return;
    }
    setError(null);
    try {
      await api(`/api/work/weekly-pay/applications/${id}/return`, {
        method: "POST",
        body: JSON.stringify({ reason: returnReason.trim() }),
      });
      setReturnReason("");
      await loadApps("submitted");
    } catch (e) {
      setError(e instanceof Error ? e.message : "差戻しに失敗しました");
    }
  }

  async function createBatch() {
    setError(null);
    try {
      await api("/api/work/weekly-pay/payment-batches", {
        method: "POST",
        body: JSON.stringify({
          applicationIds: [...selected],
          bankTransferDate: transferDate,
        }),
      });
      setSelected(new Set());
      setTab("batches");
    } catch (e) {
      setError(e instanceof Error ? e.message : "バッチ作成に失敗しました");
    }
  }

  async function openBatch(id: string) {
    setError(null);
    try {
      const data = await api<{ batch: Batch }>(`/api/work/weekly-pay/payment-batches/${id}`);
      setActiveBatch(data.batch);
      setResultForm(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "バッチ取得に失敗しました");
    }
  }

  async function downloadCsv(id: string) {
    setError(null);
    try {
      const res = await fetch(`/api/work/weekly-pay/payment-batches/${id}/csv`);
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.message ?? `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download =
        res.headers.get("Content-Disposition")?.match(/filename="(.+)"/)?.[1] ??
        "soufuri.csv";
      a.click();
      URL.revokeObjectURL(url);
      await openBatch(id);
      await loadBatches();
    } catch (e) {
      setError(e instanceof Error ? e.message : "CSV出力に失敗しました");
    }
  }

  async function markBankSubmitted(id: string) {
    setError(null);
    try {
      await api(`/api/work/weekly-pay/payment-batches/${id}/bank-submission`, {
        method: "POST",
        body: JSON.stringify({
          note: "銀行へアップロード済み（アプリは二重アップロードを防止しません）",
        }),
      });
      await openBatch(id);
      await loadBatches();
    } catch (e) {
      setError(e instanceof Error ? e.message : "記録に失敗しました");
    }
  }

  async function submitResult() {
    if (!activeBatch || !resultForm) return;
    setError(null);
    try {
      await api(`/api/work/weekly-pay/payment-batches/${activeBatch.id}/results`, {
        method: "POST",
        body: JSON.stringify({
          results: [
            {
              itemId: resultForm.itemId,
              outcome: resultForm.outcome,
              paidOn: resultForm.outcome === "paid" ? resultForm.paidOn : undefined,
              bankTransactionRef: resultForm.bankTransactionRef || undefined,
              evidenceNote: resultForm.evidenceNote,
              failureReason: resultForm.failureReason || undefined,
            },
          ],
        }),
      });
      setResultForm(null);
      await openBatch(activeBatch.id);
      await loadBatches();
    } catch (e) {
      setError(e instanceof Error ? e.message : "支払記録に失敗しました");
    }
  }

  async function saveTransferor() {
    setError(null);
    try {
      await api("/api/work/weekly-pay/transferor-settings", {
        method: "POST",
        body: JSON.stringify(xferForm),
      });
      await loadTransferor();
    } catch (e) {
      setError(e instanceof Error ? e.message : "振込元設定の保存に失敗しました");
    }
  }

  async function saveBank() {
    setError(null);
    try {
      await api("/api/work/weekly-pay/bank-accounts", {
        method: "POST",
        body: JSON.stringify(bankForm),
      });
      setBankForm({
        bankName: "",
        bankCode: "",
        branchName: "",
        branchCode: "",
        accountType: "ordinary",
        accountNumber: "",
        accountHolderKana: "",
      });
      await loadBanks();
    } catch (e) {
      setError(e instanceof Error ? e.message : "口座の保存に失敗しました");
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
        <h1 className="text-lg font-semibold">週払い</h1>
        <p className="mt-1 text-[13px] text-[var(--color-text)]/70">
          申請・承認・総合振込CSV・銀行結果の支払記録（役割に応じた操作）
        </p>
      </header>

      <nav className="mb-4 flex flex-wrap gap-2 text-[13px]" aria-label="週払いセクション">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={
              tab === t.id
                ? "rounded-md bg-[var(--color-accent)] px-3 py-2 text-white"
                : "rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2"
            }
          >
            {t.label}
          </button>
        ))}
      </nav>

      {error ? (
        <div
          className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px]"
          role="alert"
        >
          {error}
        </div>
      ) : null}

      {tab === "mine" ? (
        <section>
          <p className="mb-3 text-[12px] text-[var(--color-text)]/70">
            本人の申請一覧。draft は提出、差戻し後は再申請できます。支払状態は台帳タブでも確認できます。
          </p>
          <AppTable
            apps={apps}
            actions={(a) =>
              a.status === "draft" || a.status === "returned" ? (
                <button
                  type="button"
                  className="text-[var(--color-accent)] underline"
                  onClick={() => void submitApp(a.id)}
                >
                  提出
                </button>
              ) : (
                <span className="text-[var(--color-text)]/60">{a.status}</span>
              )
            }
          />
        </section>
      ) : null}

      {tab === "bank" ? (
        <section className="max-w-lg space-y-3 text-[13px]">
          <p className="text-[var(--color-text)]/70">
            振込先口座（下4桁のみ表示）。申請時点の snapshot が使われ、後からの変更は承認済み申請には影響しません。
          </p>
          <ul className="space-y-2">
            {banks.map((b) => (
              <li key={b.id} className="border-b border-[var(--color-border)] py-2">
                {b.bankName} {b.branchName} / ****{b.accountNumberLast4} / {b.status}
              </li>
            ))}
          </ul>
          {(
            [
              ["bankName", "銀行名"],
              ["bankCode", "銀行コード"],
              ["branchName", "支店名"],
              ["branchCode", "支店コード"],
              ["accountNumber", "口座番号"],
              ["accountHolderKana", "名義（カナ）"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex flex-col gap-1">
              {label}
              <input
                value={bankForm[key]}
                onChange={(e) => setBankForm({ ...bankForm, [key]: e.target.value })}
                className="rounded-md border border-[var(--color-border)] px-2 py-1.5"
              />
            </label>
          ))}
          <button
            type="button"
            onClick={() => void saveBank()}
            className="rounded-md bg-[var(--color-accent)] px-3 py-2 text-white"
          >
            口座を保存
          </button>
        </section>
      ) : null}

      {tab === "review" ? (
        <section className="space-y-3">
          <label className="flex max-w-md flex-col gap-1 text-[13px]">
            差戻し理由
            <input
              value={returnReason}
              onChange={(e) => setReturnReason(e.target.value)}
              className="rounded-md border border-[var(--color-border)] px-2 py-1.5"
            />
          </label>
          <AppTable
            apps={apps}
            actions={(a) => (
              <span className="inline-flex gap-3">
                <button
                  type="button"
                  className="text-[var(--color-accent)] underline"
                  onClick={() => void approveApp(a.id)}
                >
                  承認
                </button>
                <button
                  type="button"
                  className="underline"
                  onClick={() => void returnApp(a.id)}
                >
                  差戻し
                </button>
              </span>
            )}
          />
        </section>
      ) : null}

      {tab === "approved" ? (
        <section>
          <div className="mb-3 flex flex-wrap items-end gap-3 text-[13px]">
            <label className="flex flex-col gap-1">
              銀行振込指定日
              <input
                type="date"
                value={transferDate}
                onChange={(e) => setTransferDate(e.target.value)}
                className="rounded-md border border-[var(--color-border)] px-2 py-1.5"
              />
            </label>
            <div>
              選択 {selected.size} 件 / ¥{selectedTotal.toLocaleString("ja-JP")}
            </div>
            <button
              type="button"
              disabled={selected.size === 0 || !transferDate}
              onClick={() => void createBatch()}
              className="rounded-md bg-[var(--color-accent)] px-3 py-2 text-white disabled:opacity-40"
            >
              バッチ確定
            </button>
          </div>
          <p className="mb-2 text-[12px] text-[var(--color-text)]/70">
            振込指定日は銀行営業日のみ。CSVや銀行アップロードだけでは支払済みになりません。
          </p>
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left">
                <th className="py-2 pr-2" />
                <th className="py-2 pr-2">週</th>
                <th className="py-2 pr-2">支払予定日</th>
                <th className="py-2 pr-2">金額</th>
                <th className="py-2">申請</th>
              </tr>
            </thead>
            <tbody>
              {apps.map((a) => (
                <tr key={a.id} className="border-b border-[var(--color-border)]/70">
                  <td className="py-2 pr-2">
                    <input
                      type="checkbox"
                      checked={selected.has(a.id)}
                      onChange={(e) => {
                        const next = new Set(selected);
                        if (e.target.checked) next.add(a.id);
                        else next.delete(a.id);
                        setSelected(next);
                      }}
                      aria-label={`申請 ${a.id} を選択`}
                    />
                  </td>
                  <td className="py-2 pr-2">
                    {a.weekStart}〜{a.weekEnd}
                  </td>
                  <td className="py-2 pr-2">{a.paymentDate}</td>
                  <td className="py-2 pr-2">¥{a.totalAmountYen.toLocaleString("ja-JP")}</td>
                  <td className="py-2 font-mono text-[12px]">{a.id.slice(0, 8)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {tab === "batches" ? (
        <section className="space-y-4">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left">
                <th className="py-2 pr-2">振込指定日</th>
                <th className="py-2 pr-2">状態</th>
                <th className="py-2 pr-2">件数</th>
                <th className="py-2 pr-2">合計</th>
                <th className="py-2">操作</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.id} className="border-b border-[var(--color-border)]/70">
                  <td className="py-2 pr-2">{b.bankTransferDate}</td>
                  <td className="py-2 pr-2">{b.status}</td>
                  <td className="py-2 pr-2">{b.itemCount}</td>
                  <td className="py-2 pr-2">¥{b.totalAmountYen.toLocaleString("ja-JP")}</td>
                  <td className="py-2">
                    <button
                      type="button"
                      className="text-[var(--color-accent)] underline"
                      onClick={() => void openBatch(b.id)}
                    >
                      詳細
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {activeBatch ? (
            <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
              <div className="mb-3 flex flex-wrap items-center gap-3 text-[13px]">
                <strong>バッチ {activeBatch.id.slice(0, 8)}</strong>
                <span>{activeBatch.status}</span>
                <button
                  type="button"
                  className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-white"
                  onClick={() => void downloadCsv(activeBatch.id)}
                >
                  総合振込CSV
                </button>
                <button
                  type="button"
                  disabled={activeBatch.status !== "exported" && activeBatch.status !== "bank_submitted"}
                  className="rounded-md border border-[var(--color-border)] px-3 py-1.5 disabled:opacity-40"
                  onClick={() => void markBankSubmitted(activeBatch.id)}
                >
                  銀行アップロード記録
                </button>
              </div>
              <p className="mb-2 text-[12px] text-[var(--color-text)]/70">
                支払確認は銀行提出後のみ。銀行側の二重アップロードはアプリでは防げません。
              </p>
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr className="border-b border-[var(--color-border)] text-left">
                    <th className="py-2 pr-2">振込先</th>
                    <th className="py-2 pr-2">下4桁</th>
                    <th className="py-2 pr-2">金額</th>
                    <th className="py-2 pr-2">結果</th>
                    <th className="py-2">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {(activeBatch.items ?? []).map((it) => (
                    <tr key={it.id} className="border-b border-[var(--color-border)]/70">
                      <td className="py-2 pr-2">
                        {it.bankCode}-{it.branchCode} {it.accountHolderKana}
                      </td>
                      <td className="py-2 pr-2">****{it.accountNumberLast4}</td>
                      <td className="py-2 pr-2">¥{it.amountYen.toLocaleString("ja-JP")}</td>
                      <td className="py-2 pr-2">{it.outcome}</td>
                      <td className="py-2">
                        {canRecordResults(activeBatch.status) &&
                        (it.outcome === "pending" || it.outcome === "unknown") ? (
                          <button
                            type="button"
                            className="text-[var(--color-accent)] underline"
                            onClick={() =>
                              setResultForm({
                                itemId: it.id,
                                outcome: "paid",
                                paidOn: new Date().toISOString().slice(0, 10),
                                bankTransactionRef: "",
                                evidenceNote: "",
                                failureReason: "",
                              })
                            }
                          >
                            結果記録
                          </button>
                        ) : (
                          <span className="text-[var(--color-text)]/50">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {resultForm && activeBatch ? (
                <div className="mt-4 space-y-2 border-t border-[var(--color-border)] pt-4 text-[13px]">
                  <h2 className="font-medium">支払結果の記録</h2>
                  {(() => {
                    const it = (activeBatch.items ?? []).find((x) => x.id === resultForm.itemId);
                    return it ? (
                      <p>
                        {it.accountHolderKana} ****{it.accountNumberLast4} / ¥
                        {it.amountYen.toLocaleString("ja-JP")}
                      </p>
                    ) : null;
                  })()}
                  <label className="flex flex-col gap-1">
                    結果
                    <select
                      value={resultForm.outcome}
                      onChange={(e) =>
                        setResultForm({
                          ...resultForm,
                          outcome: e.target.value as "paid" | "failed" | "unknown",
                        })
                      }
                      className="rounded-md border border-[var(--color-border)] px-2 py-1.5"
                    >
                      <option value="paid">支払済み</option>
                      <option value="failed">失敗</option>
                      <option value="unknown">結果不明</option>
                    </select>
                  </label>
                  {resultForm.outcome === "paid" ? (
                    <label className="flex flex-col gap-1">
                      支払確認日
                      <input
                        type="date"
                        value={resultForm.paidOn}
                        onChange={(e) =>
                          setResultForm({ ...resultForm, paidOn: e.target.value })
                        }
                        className="rounded-md border border-[var(--color-border)] px-2 py-1.5"
                      />
                    </label>
                  ) : null}
                  <label className="flex flex-col gap-1">
                    銀行側取引参照
                    <input
                      value={resultForm.bankTransactionRef}
                      onChange={(e) =>
                        setResultForm({ ...resultForm, bankTransactionRef: e.target.value })
                      }
                      className="rounded-md border border-[var(--color-border)] px-2 py-1.5"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    確認証跡
                    <textarea
                      value={resultForm.evidenceNote}
                      onChange={(e) =>
                        setResultForm({ ...resultForm, evidenceNote: e.target.value })
                      }
                      rows={3}
                      className="rounded-md border border-[var(--color-border)] px-2 py-1.5"
                    />
                  </label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="rounded-md bg-[var(--color-accent)] px-3 py-2 text-white"
                      onClick={() => void submitResult()}
                    >
                      記録する
                    </button>
                    <button
                      type="button"
                      className="rounded-md border border-[var(--color-border)] px-3 py-2"
                      onClick={() => setResultForm(null)}
                    >
                      キャンセル
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {tab === "transferor" ? (
        <section className="max-w-lg space-y-3 text-[13px]">
          <p className="text-[var(--color-text)]/70">
            銀行から割り当てられた振込依頼人コード（20ではじまる10桁）と振込元口座。未設定では本番形式CSVを出せません。初期値の架空コードは入れません。
          </p>
          {transferor ? (
            <p>
              現在: 依頼人 {transferor.consignorCode} / 口座下4桁 ****
              {transferor.sourceAccountNumberLast4}
            </p>
          ) : (
            <p className="text-amber-800">未設定 — CSV出力はブロックされます</p>
          )}
          {(
            [
              ["consignorCode", "振込依頼人コード"],
              ["requesterNameKana", "振込依頼人名（半角カナ）"],
              ["sourceBankCode", "仕向銀行番号"],
              ["sourceBranchCode", "仕向支店番号"],
              ["sourceAccountNumber", "依頼人口座番号（7桁）"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex flex-col gap-1">
              {label}
              <input
                value={xferForm[key]}
                onChange={(e) => setXferForm({ ...xferForm, [key]: e.target.value })}
                className="rounded-md border border-[var(--color-border)] px-2 py-1.5"
                autoComplete="off"
              />
            </label>
          ))}
          <button
            type="button"
            onClick={() => void saveTransferor()}
            className="rounded-md bg-[var(--color-accent)] px-3 py-2 text-white"
          >
            保存
          </button>
        </section>
      ) : null}

      {tab === "ledger" ? (
        <section>
          <p className="mb-2 text-[12px] text-[var(--color-text)]/70">
            確定済み支払台帳（staff / Work Record / 期間 / 支払日・金額）。税計算や配賦は含みません。
          </p>
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left">
                <th className="py-2 pr-2">支払日</th>
                <th className="py-2 pr-2">対象週</th>
                <th className="py-2 pr-2">金額</th>
                <th className="py-2">申請</th>
              </tr>
            </thead>
            <tbody>
              {ledger.map((e) => (
                <tr key={e.id} className="border-b border-[var(--color-border)]/70">
                  <td className="py-2 pr-2">{e.paidOn}</td>
                  <td className="py-2 pr-2">
                    {e.weekStart}〜{e.weekEnd}
                  </td>
                  <td className="py-2 pr-2">¥{e.amountYen.toLocaleString("ja-JP")}</td>
                  <td className="py-2 font-mono text-[12px]">{e.applicationId.slice(0, 8)}</td>
                </tr>
              ))}
              {ledger.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-6 text-[var(--color-text)]/60">
                    支払記録はまだありません
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </section>
      ) : null}
    </div>
  );
}

function AppTable({
  apps,
  actions,
}: {
  apps: Application[];
  actions: (a: Application) => React.ReactNode;
}) {
  return (
    <table className="w-full border-collapse text-[13px]">
      <thead>
        <tr className="border-b border-[var(--color-border)] text-left">
          <th className="py-2 pr-2">週</th>
          <th className="py-2 pr-2">状態</th>
          <th className="py-2 pr-2">金額</th>
          <th className="py-2">操作</th>
        </tr>
      </thead>
      <tbody>
        {apps.map((a) => (
          <tr key={a.id} className="border-b border-[var(--color-border)]/70">
            <td className="py-2 pr-2">
              {a.weekStart}〜{a.weekEnd}
            </td>
            <td className="py-2 pr-2">{a.status}</td>
            <td className="py-2 pr-2">¥{a.totalAmountYen.toLocaleString("ja-JP")}</td>
            <td className="py-2">{actions(a)}</td>
          </tr>
        ))}
        {apps.length === 0 ? (
          <tr>
            <td colSpan={4} className="py-6 text-[var(--color-text)]/60">
              該当する申請はありません
            </td>
          </tr>
        ) : null}
      </tbody>
    </table>
  );
}
