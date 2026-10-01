"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

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

type Tab = "applications" | "batches" | "transferor" | "ledger";

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

export default function WeeklyPayClient() {
  const [tab, setTab] = useState<Tab>("applications");
  const [error, setError] = useState<string | null>(null);
  const [apps, setApps] = useState<Application[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [transferDate, setTransferDate] = useState("");
  const [batches, setBatches] = useState<Batch[]>([]);
  const [activeBatch, setActiveBatch] = useState<Batch | null>(null);
  const [transferor, setTransferor] = useState<Transferor>(null);
  const [ledger, setLedger] = useState<Settlement[]>([]);
  const [xferForm, setXferForm] = useState({
    consignorCode: "2012345678",
    requesterNameKana: "",
    sourceBankCode: "0038",
    sourceBranchCode: "",
    sourceAccountType: "ordinary",
    sourceAccountNumber: "",
  });

  const loadApps = useCallback(async () => {
    const data = await api<{ applications: Application[] }>(
      "/api/work/weekly-pay/applications?status=approved",
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

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        if (tab === "applications") await loadApps();
        if (tab === "batches") await loadBatches();
        if (tab === "transferor") await loadTransferor();
        if (tab === "ledger") await loadLedger();
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
  }, [tab, loadApps, loadBatches, loadTransferor, loadLedger]);

  const selectedTotal = useMemo(
    () =>
      apps
        .filter((a) => selected.has(a.id))
        .reduce((s, a) => s + a.totalAmountYen, 0),
    [apps, selected],
  );

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

  async function markItemPaid(item: BatchItem) {
    if (!activeBatch) return;
    const paidOn = window.prompt("支払確認日 (YYYY-MM-DD)", new Date().toISOString().slice(0, 10));
    if (!paidOn) return;
    const bankTransactionRef = window.prompt("銀行側取引参照");
    if (!bankTransactionRef) return;
    const evidenceNote = window.prompt("確認証跡（照会画面・明細など）");
    if (!evidenceNote) return;
    setError(null);
    try {
      await api(`/api/work/weekly-pay/payment-batches/${activeBatch.id}/results`, {
        method: "POST",
        body: JSON.stringify({
          results: [
            {
              itemId: item.id,
              outcome: "paid",
              paidOn,
              bankTransactionRef,
              evidenceNote,
            },
          ],
        }),
      });
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

  const tabs: { id: Tab; label: string }[] = [
    { id: "applications", label: "承認済み申請" },
    { id: "batches", label: "支払バッチ" },
    { id: "transferor", label: "振込元設定" },
    { id: "ledger", label: "精算台帳" },
  ];

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 text-[var(--color-text)]">
      <header className="mb-6 border-b border-[var(--color-border)] pb-4">
        <h1 className="text-lg font-semibold">週払い</h1>
        <p className="mt-1 text-[13px] text-[var(--color-text)]/70">
          承認済み申請の振込バッチ作成・総合振込CSV・銀行結果の支払記録
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

      {tab === "applications" ? (
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
            振込指定日は銀行営業日のみ。申請の支払予定日とは別に指定します。CSVダウンロードや銀行アップロードだけでは支払済みになりません。
          </p>
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left">
                <th className="py-2 pr-2" />
                <th className="py-2 pr-2">週</th>
                <th className="py-2 pr-2">支払予定日</th>
                <th className="py-2 pr-2">金額</th>
                <th className="py-2">申請ID</th>
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
              {apps.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-6 text-[var(--color-text)]/60">
                    承認済みで未バッチの申請はありません
                  </td>
                </tr>
              ) : null}
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
                <span>fingerprint {activeBatch.contentFingerprint.slice(0, 12)}…</span>
                <button
                  type="button"
                  className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-white"
                  onClick={() => void downloadCsv(activeBatch.id)}
                >
                  総合振込CSV
                </button>
                <button
                  type="button"
                  className="rounded-md border border-[var(--color-border)] px-3 py-1.5"
                  onClick={() => void markBankSubmitted(activeBatch.id)}
                >
                  銀行アップロード記録
                </button>
              </div>
              <p className="mb-2 text-[12px] text-[var(--color-text)]/70">
                CSV再ダウンロードは同一内容です。支払済みは銀行結果確認後に明細単位で記録します。銀行側の二重アップロードはアプリでは防げません。
              </p>
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr className="border-b border-[var(--color-border)] text-left">
                    <th className="py-2 pr-2">振込先</th>
                    <th className="py-2 pr-2">口座下4桁</th>
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
                        {it.outcome === "pending" || it.outcome === "unknown" ? (
                          <button
                            type="button"
                            className="text-[var(--color-accent)] underline"
                            onClick={() => void markItemPaid(it)}
                          >
                            支払確認
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      ) : null}

      {tab === "transferor" ? (
        <section className="max-w-lg space-y-3 text-[13px]">
          <p className="text-[var(--color-text)]/70">
            ドコモSMTB総合振込の依頼人コード（20ではじまる10桁）と振込元口座。未設定の組織では本番形式CSVを出力できません。架空値のみテストに使用してください。
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
            給与精算向けの確定済み支払台帳（staff / Work Record / 期間 / 支払日・金額）。税計算や配賦比率は含みません。
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
