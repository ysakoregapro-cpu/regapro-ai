"use client";

import { useEffect, useState, useTransition } from "react";
import { PageHeader } from "@/components/ui/primitives";

type LedgerResponse = {
  ok: boolean;
  uniqueCurrentN?: number;
  uniqueByEntity?: Record<
    string,
    { n: number; byStatus: Record<string, number>; byPurpose: Record<string, number> }
  >;
  approvedIdentityN?: number;
  approvedBySystem?: Record<string, number>;
  batches?: Array<{
    idPrefix: string;
    sourceSystem: string;
    entityKind: string;
    status: string;
    dryRun: boolean;
    batchPurpose: string | null;
    totalRecords: number | null;
    matchedRecords: number | null;
    failedRecords: number | null;
    createdAt: string;
    labelPrefix: string;
  }>;
  notes?: string[];
  error?: string;
};

export default function MigrationLedgerPage() {
  const [data, setData] = useState<LedgerResponse | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    startTransition(async () => {
      const res = await fetch("/api/work/migration/ledger");
      const json = (await res.json()) as LedgerResponse;
      setData(json);
    });
  }, []);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title="取込台帳"
        description="検証 batch と出典一意状態を分けて確認します"
      />

      {pending && !data ? (
        <p className="text-[14px] text-text-secondary">読み込み中…</p>
      ) : null}

      {data && !data.ok ? (
        <p className="text-[14px] text-red-700" role="alert">
          台帳を表示できません。権限またはスキーマを確認してください。
        </p>
      ) : null}

      {data?.ok ? (
        <>
          <section className="space-y-2 border-b border-border pb-4">
            <h2 className="text-[15px] font-medium text-text">出典の現在状態</h2>
            <p className="text-[14px] text-text-secondary">
              一意レコード数: {data.uniqueCurrentN ?? 0} ／ 承認済み対応:{" "}
              {data.approvedIdentityN ?? 0}
            </p>
            <ul className="space-y-1 text-[14px]">
              {Object.entries(data.uniqueByEntity ?? {}).map(([k, v]) => (
                <li key={k} className="flex flex-wrap gap-x-4 gap-y-1">
                  <span className="min-w-[12rem] font-mono text-[13px]">{k}</span>
                  <span>{v.n} 件</span>
                  <span className="text-text-secondary">
                    status {JSON.stringify(v.byStatus)}
                  </span>
                  <span className="text-text-secondary">
                    purpose {JSON.stringify(v.byPurpose)}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-[13px] text-text-secondary">
              承認 by system: {JSON.stringify(data.approvedBySystem ?? {})}
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-[15px] font-medium text-text">最近の batch</h2>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-[13px]">
                <thead>
                  <tr className="border-b border-border text-text-secondary">
                    <th className="py-2 pr-3 font-medium">id</th>
                    <th className="py-2 pr-3 font-medium">purpose</th>
                    <th className="py-2 pr-3 font-medium">entity</th>
                    <th className="py-2 pr-3 font-medium">status</th>
                    <th className="py-2 pr-3 font-medium">totals</th>
                    <th className="py-2 font-medium">created</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.batches ?? []).map((b) => (
                    <tr key={b.idPrefix + b.createdAt} className="border-b border-border">
                      <td className="py-2 pr-3 font-mono">{b.idPrefix}</td>
                      <td className="py-2 pr-3">{b.batchPurpose ?? "—"}</td>
                      <td className="py-2 pr-3">
                        {b.sourceSystem}/{b.entityKind}
                      </td>
                      <td className="py-2 pr-3">
                        {b.status}
                        {b.dryRun ? " (dry)" : ""}
                      </td>
                      <td className="py-2 pr-3">
                        t{b.totalRecords ?? 0}/m{b.matchedRecords ?? 0}/f
                        {b.failedRecords ?? 0}
                      </td>
                      <td className="py-2 whitespace-nowrap text-text-secondary">
                        {b.createdAt?.slice(0, 19) ?? ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <ul className="list-disc space-y-1 pl-5 text-[13px] text-text-secondary">
            {(data.notes ?? []).map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
