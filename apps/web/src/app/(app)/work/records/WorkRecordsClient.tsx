"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

type Perms = {
  viewOwn: boolean;
  submit: boolean;
  manage: boolean;
  terms: boolean;
};
type Tab = "records" | "terms";

type StaffRow = { staffId: string; staffNo: string; name: string };
type Location = { id: string; name: string };
type ShiftRow = {
  id: string;
  staffId: string;
  workDate: string;
  startTime: string | null;
  endTime: string | null;
  endDayOffset: number;
  workLocationId: string | null;
  status: string;
};
type WorkRecord = {
  id: string;
  staffId: string;
  workDate: string;
  startTime: string;
  endTime: string;
  endDayOffset: number;
  breakMinutes: number;
  workedMinutes: number;
  transportFeeYen: number;
  workLocationId: string | null;
  sourceShiftId: string | null;
  status: string;
  employmentTermId: string | null;
  hourlyWageSnapshotYen: number | null;
};
type EmploymentTerm = {
  id: string;
  staffId: string;
  hourlyWageYen: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  revokedAt: string | null;
};
type Revision = {
  id: string;
  revisionNo: number;
  eventType: string;
  actorStaffId: string;
  reason: string | null;
  createdAt: string;
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

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

function staffLabel(staff: StaffRow[], id: string): string {
  const row = staff.find((s) => s.staffId === id);
  return row ? `${row.staffNo} ${row.name}` : id.slice(0, 8);
}

export default function WorkRecordsClient() {
  const [perms, setPerms] = useState<Perms | null>(null);
  const [tab, setTab] = useState<Tab>("records");
  const [error, setError] = useState<string | null>(null);
  const [from, setFrom] = useState(() => addDays(tokyoToday(), -14));
  const [to, setTo] = useState(() => tokyoToday());
  const [filterStaffId, setFilterStaffId] = useState("");
  const [records, setRecords] = useState<WorkRecord[]>([]);
  const [terms, setTerms] = useState<EmploymentTerm[]>([]);
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [publishedShifts, setPublishedShifts] = useState<ShiftRow[]>([]);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [form, setForm] = useState({
    workRecordId: "" as string,
    staffId: "",
    workDate: tokyoToday(),
    startTime: "10:00",
    endTime: "19:00",
    endDayOffset: 0,
    breakMinutes: 60,
    transportFeeYen: 0,
    workLocationId: "",
    sourceShiftId: "",
  });
  const [termForm, setTermForm] = useState({
    staffId: "",
    hourlyWageYen: 1200,
    effectiveFrom: tokyoToday(),
    effectiveTo: "",
    closeOpenEnded: true,
  });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const session = await api<{ membership?: { permissions?: string[] } }>(
          "/api/auth/session",
        );
        const keys = new Set(session.membership?.permissions ?? []);
        const next: Perms = {
          viewOwn:
            keys.has("work_record.view_own") ||
            keys.has("work_record.submit") ||
            keys.has("work_record.manage"),
          submit: keys.has("work_record.submit") || keys.has("work_record.manage"),
          manage: keys.has("work_record.manage"),
          terms: keys.has("employment_terms.manage"),
        };
        if (!cancelled) {
          setPerms(next);
          setTab("records");
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "権限取得に失敗しました");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const tabs = useMemo(() => {
    if (!perms) return [] as { id: Tab; label: string }[];
    const list: { id: Tab; label: string }[] = [];
    if (perms.viewOwn) list.push({ id: "records", label: "勤務実績" });
    if (perms.terms) list.push({ id: "terms", label: "雇用条件" });
    return list;
  }, [perms]);

  const loadRecords = useCallback(async () => {
    const q = new URLSearchParams({ from, to });
    if (filterStaffId) q.set("staffId", filterStaffId);
    const data = await api<{ records: WorkRecord[] }>(`/api/work/records?${q}`);
    setRecords(data.records ?? []);
  }, [from, to, filterStaffId]);

  const loadTerms = useCallback(async () => {
    const q = filterStaffId ? `?staffId=${encodeURIComponent(filterStaffId)}` : "";
    const data = await api<{ terms: EmploymentTerm[] }>(`/api/work/employment-terms${q}`);
    setTerms(data.terms ?? []);
  }, [filterStaffId]);

  const loadMeta = useCallback(async () => {
    const [loc, shift] = await Promise.all([
      api<{ locations: Location[] }>("/api/work/locations").catch(() => ({ locations: [] })),
      api<{ shifts: ShiftRow[] }>(
        `/api/work/shifts?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      ).catch(() => ({ shifts: [] })),
    ]);
    setLocations(loc.locations ?? []);
    setPublishedShifts((shift.shifts ?? []).filter((s) => s.status === "published"));
  }, [from, to]);

  const loadStaff = useCallback(async () => {
    const data = await api<{ staff: StaffRow[] }>("/api/work/staff");
    setStaff(data.staff ?? []);
  }, []);

  useEffect(() => {
    if (!perms) return;
    let cancelled = false;
    void (async () => {
      try {
        setError(null);
        if (perms.manage || perms.terms) await loadStaff();
        if (tab === "records") {
          await loadRecords();
          await loadMeta();
        }
        if (tab === "terms") await loadTerms();
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "読み込み失敗");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [perms, tab, loadRecords, loadTerms, loadMeta, loadStaff]);

  async function saveDraft() {
    setError(null);
    try {
      await api("/api/work/records", {
        method: "POST",
        body: JSON.stringify({
          workRecordId: form.workRecordId || undefined,
          staffId: form.staffId || undefined,
          workDate: form.workDate,
          startTime: form.startTime.length === 5 ? `${form.startTime}:00` : form.startTime,
          endTime: form.endTime.length === 5 ? `${form.endTime}:00` : form.endTime,
          endDayOffset: form.endDayOffset as 0 | 1,
          breakMinutes: form.breakMinutes,
          transportFeeYen: form.transportFeeYen,
          workLocationId: form.workLocationId || null,
          sourceShiftId: form.sourceShiftId || null,
        }),
      });
      setForm((f) => ({ ...f, workRecordId: "", sourceShiftId: "" }));
      await loadRecords();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失敗");
    }
  }

  async function confirm(id: string) {
    setError(null);
    try {
      await api(`/api/work/records/${id}/confirm`, { method: "POST", body: "{}" });
      await loadRecords();
    } catch (e) {
      setError(e instanceof Error ? e.message : "確定失敗");
    }
  }

  async function reopen(id: string) {
    setError(null);
    try {
      await api(`/api/work/records/${id}/reopen`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
      setReason("");
      await loadRecords();
    } catch (e) {
      setError(e instanceof Error ? e.message : "差戻し失敗");
    }
  }

  async function voidRecord(id: string) {
    setError(null);
    try {
      await api(`/api/work/records/${id}/void`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
      setReason("");
      await loadRecords();
    } catch (e) {
      setError(e instanceof Error ? e.message : "取消失敗");
    }
  }

  async function showRevisions(id: string) {
    setError(null);
    setActiveId(id);
    try {
      const data = await api<{ revisions: Revision[] }>(
        `/api/work/records/${id}/revisions`,
      );
      setRevisions(data.revisions ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "履歴取得失敗");
    }
  }

  async function saveTerm() {
    setError(null);
    try {
      await api("/api/work/employment-terms", {
        method: "POST",
        body: JSON.stringify({
          staffId: termForm.staffId,
          hourlyWageYen: termForm.hourlyWageYen,
          effectiveFrom: termForm.effectiveFrom,
          effectiveTo: termForm.effectiveTo || null,
          closeOpenEnded: termForm.closeOpenEnded,
        }),
      });
      await loadTerms();
    } catch (e) {
      setError(e instanceof Error ? e.message : "雇用条件保存失敗");
    }
  }

  async function revokeTerm(id: string) {
    setError(null);
    try {
      await api(`/api/work/employment-terms/${id}/revoke`, {
        method: "POST",
        body: JSON.stringify({ reason: reason || "revoked" }),
      });
      setReason("");
      await loadTerms();
    } catch (e) {
      setError(e instanceof Error ? e.message : "失効失敗");
    }
  }

  function prefillFromShift(s: ShiftRow) {
    setForm({
      workRecordId: "",
      staffId: perms?.manage ? s.staffId : "",
      workDate: s.workDate,
      startTime: s.startTime?.slice(0, 5) ?? "10:00",
      endTime: s.endTime?.slice(0, 5) ?? "19:00",
      endDayOffset: s.endDayOffset,
      breakMinutes: 60,
      transportFeeYen: 0,
      workLocationId: s.workLocationId ?? "",
      sourceShiftId: s.id,
    });
  }

  if (!perms) {
    return <div className="py-8 text-[13px] text-[var(--color-text)]/70">読み込み中…</div>;
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 pb-24 sm:pb-6">
      <header className="mb-4">
        <h1 className="text-lg font-semibold text-[var(--color-text)]">勤務実績</h1>
        <p className="mt-1 text-[12px] text-[var(--color-text)]/70">
          実際の勤務時間の正本です。シフトは入力補助のみで、給与計算の根拠にはしません。
        </p>
      </header>

      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-[var(--color-border)]">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`whitespace-nowrap px-3 py-2 text-[13px] ${
              tab === t.id
                ? "border-b-2 border-[var(--color-accent)] font-medium text-[var(--color-accent)]"
                : "text-[var(--color-text)]/70"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error ? (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px]" role="alert">
          {error}
        </div>
      ) : null}

      {tab === "records" ? (
        <section className="space-y-4 text-[13px]">
          <div className="flex flex-wrap gap-2">
            <label className="flex items-center gap-1">
              開始
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="rounded-md border border-[var(--color-border)] px-2 py-1"
              />
            </label>
            <label className="flex items-center gap-1">
              終了
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="rounded-md border border-[var(--color-border)] px-2 py-1"
              />
            </label>
            {perms.manage ? (
              <label className="flex items-center gap-1">
                スタッフ
                <select
                  value={filterStaffId}
                  onChange={(e) => setFilterStaffId(e.target.value)}
                  className="rounded-md border border-[var(--color-border)] px-2 py-1"
                >
                  <option value="">全員</option>
                  {staff.map((s) => (
                    <option key={s.staffId} value={s.staffId}>
                      {s.staffNo} {s.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <button
              type="button"
              onClick={() => void loadRecords()}
              className="rounded-md border border-[var(--color-border)] px-3 py-1"
            >
              絞り込み
            </button>
            <Link href="/work/weekly-pay" className="px-2 py-1 text-[var(--color-accent)] underline">
              週払い申請へ
            </Link>
          </div>

          {perms.submit ? (
            <div className="grid max-w-xl gap-2 rounded-md border border-[var(--color-border)] p-3 sm:grid-cols-2">
              <p className="sm:col-span-2 text-[12px] text-[var(--color-text)]/70">
                公開シフトからの入力補助（シフトは正本ではありません）。シフト外勤務も入力できます。
              </p>
              {publishedShifts.length > 0 ? (
                <label className="flex flex-col gap-1 sm:col-span-2">
                  公開シフトから補助
                  <select
                    value={form.sourceShiftId}
                    onChange={(e) => {
                      const s = publishedShifts.find((x) => x.id === e.target.value);
                      if (s) prefillFromShift(s);
                      else setForm({ ...form, sourceShiftId: "" });
                    }}
                    className="rounded-md border border-[var(--color-border)] px-2 py-1.5"
                  >
                    <option value="">手動入力</option>
                    {publishedShifts.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.workDate} {s.startTime?.slice(0, 5)}〜{s.endTime?.slice(0, 5)}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {perms.manage ? (
                <label className="flex flex-col gap-1 sm:col-span-2">
                  スタッフ
                  <select
                    value={form.staffId}
                    onChange={(e) => setForm({ ...form, staffId: e.target.value })}
                    className="rounded-md border border-[var(--color-border)] px-2 py-1.5"
                  >
                    <option value="">本人</option>
                    {staff.map((s) => (
                      <option key={s.staffId} value={s.staffId}>
                        {s.staffNo} {s.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className="flex flex-col gap-1">
                勤務日
                <input
                  type="date"
                  value={form.workDate}
                  onChange={(e) => setForm({ ...form, workDate: e.target.value })}
                  className="rounded-md border border-[var(--color-border)] px-2 py-1.5"
                />
              </label>
              <label className="flex flex-col gap-1">
                深夜跨ぎ
                <select
                  value={form.endDayOffset}
                  onChange={(e) => setForm({ ...form, endDayOffset: Number(e.target.value) })}
                  className="rounded-md border border-[var(--color-border)] px-2 py-1.5"
                >
                  <option value={0}>なし</option>
                  <option value={1}>翌日終了</option>
                </select>
              </label>
              <label className="flex flex-col gap-1">
                開始
                <input
                  type="time"
                  value={form.startTime}
                  onChange={(e) => setForm({ ...form, startTime: e.target.value })}
                  className="rounded-md border border-[var(--color-border)] px-2 py-1.5"
                />
              </label>
              <label className="flex flex-col gap-1">
                終了
                <input
                  type="time"
                  value={form.endTime}
                  onChange={(e) => setForm({ ...form, endTime: e.target.value })}
                  className="rounded-md border border-[var(--color-border)] px-2 py-1.5"
                />
              </label>
              <label className="flex flex-col gap-1">
                休憩（分）
                <input
                  type="number"
                  min={0}
                  value={form.breakMinutes}
                  onChange={(e) => setForm({ ...form, breakMinutes: Number(e.target.value) })}
                  className="rounded-md border border-[var(--color-border)] px-2 py-1.5"
                />
              </label>
              <label className="flex flex-col gap-1">
                交通費
                <input
                  type="number"
                  min={0}
                  value={form.transportFeeYen}
                  onChange={(e) => setForm({ ...form, transportFeeYen: Number(e.target.value) })}
                  className="rounded-md border border-[var(--color-border)] px-2 py-1.5"
                />
              </label>
              <label className="flex flex-col gap-1 sm:col-span-2">
                勤務地
                <select
                  value={form.workLocationId}
                  onChange={(e) => setForm({ ...form, workLocationId: e.target.value })}
                  className="rounded-md border border-[var(--color-border)] px-2 py-1.5"
                >
                  <option value="">未指定</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={() => void saveDraft()}
                className="rounded-md bg-[var(--color-accent)] px-3 py-2 text-white sm:col-span-2"
              >
                {form.workRecordId ? "draft を更新" : "draft を保存"}
              </button>
            </div>
          ) : null}

          {(perms.manage || perms.submit) && (
            <label className="flex max-w-md flex-col gap-1">
              差戻し・取消の理由
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="rounded-md border border-[var(--color-border)] px-2 py-1.5"
              />
            </label>
          )}

          <ul className="divide-y divide-[var(--color-border)]">
            {records.map((r) => (
              <li key={r.id} className="py-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="font-medium">
                      {r.workDate} · {r.status}
                      {perms.manage ? ` · ${staffLabel(staff, r.staffId)}` : ""}
                    </div>
                    <div className="text-[12px] text-[var(--color-text)]/70">
                      {r.startTime.slice(0, 5)}〜{r.endTime.slice(0, 5)}
                      {r.endDayOffset ? " (+1)" : ""} / 実働 {r.workedMinutes}分
                      {r.hourlyWageSnapshotYen != null
                        ? ` / 確定時給 ${r.hourlyWageSnapshotYen}円`
                        : ""}
                      {r.sourceShiftId ? " / シフト補助あり" : ""}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {r.status === "draft" && perms.submit ? (
                      <>
                        <button
                          type="button"
                          className="text-[var(--color-accent)] underline"
                          onClick={() =>
                            setForm({
                              workRecordId: r.id,
                              staffId: perms.manage ? r.staffId : "",
                              workDate: r.workDate,
                              startTime: r.startTime.slice(0, 5),
                              endTime: r.endTime.slice(0, 5),
                              endDayOffset: r.endDayOffset,
                              breakMinutes: r.breakMinutes,
                              transportFeeYen: r.transportFeeYen,
                              workLocationId: r.workLocationId ?? "",
                              sourceShiftId: r.sourceShiftId ?? "",
                            })
                          }
                        >
                          編集
                        </button>
                        <button
                          type="button"
                          className="text-[var(--color-accent)] underline"
                          onClick={() => void confirm(r.id)}
                        >
                          確定
                        </button>
                      </>
                    ) : null}
                    {r.status === "confirmed" && perms.manage ? (
                      <button
                        type="button"
                        className="text-[var(--color-text)]/70 underline"
                        onClick={() => void reopen(r.id)}
                      >
                        差戻し
                      </button>
                    ) : null}
                    {(r.status === "draft" || r.status === "confirmed") && perms.manage ? (
                      <button
                        type="button"
                        className="text-[var(--color-text)]/70 underline"
                        onClick={() => void voidRecord(r.id)}
                      >
                        取消
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="text-[var(--color-accent)] underline"
                      onClick={() => void showRevisions(r.id)}
                    >
                      改訂履歴
                    </button>
                  </div>
                </div>
                {activeId === r.id && revisions.length > 0 ? (
                  <ul className="mt-2 space-y-1 border-l-2 border-[var(--color-border)] pl-3 text-[12px] text-[var(--color-text)]/70">
                    {revisions.map((rev) => (
                      <li key={rev.id}>
                        #{rev.revisionNo} {rev.eventType} · {rev.createdAt.slice(0, 19)}
                        {rev.reason ? ` · ${rev.reason}` : ""}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
            {records.length === 0 ? (
              <li className="py-6 text-[var(--color-text)]/60">該当する勤務実績はありません。</li>
            ) : null}
          </ul>
        </section>
      ) : null}

      {tab === "terms" ? (
        <section className="space-y-4 text-[13px]">
          <p className="text-[12px] text-[var(--color-text)]/70">
            時給は確定時に snapshot されます。過去の確定済み実績は現在の時給で再計算しません。
          </p>
          <div className="grid max-w-xl gap-2 sm:grid-cols-2">
            <label className="flex flex-col gap-1 sm:col-span-2">
              スタッフ
              <select
                value={termForm.staffId}
                onChange={(e) => setTermForm({ ...termForm, staffId: e.target.value })}
                className="rounded-md border border-[var(--color-border)] px-2 py-1.5"
              >
                <option value="">選択</option>
                {staff.map((s) => (
                  <option key={s.staffId} value={s.staffId}>
                    {s.staffNo} {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              時給（円）
              <input
                type="number"
                min={1}
                value={termForm.hourlyWageYen}
                onChange={(e) =>
                  setTermForm({ ...termForm, hourlyWageYen: Number(e.target.value) })
                }
                className="rounded-md border border-[var(--color-border)] px-2 py-1.5"
              />
            </label>
            <label className="flex flex-col gap-1">
              適用開始
              <input
                type="date"
                value={termForm.effectiveFrom}
                onChange={(e) => setTermForm({ ...termForm, effectiveFrom: e.target.value })}
                className="rounded-md border border-[var(--color-border)] px-2 py-1.5"
              />
            </label>
            <label className="flex flex-col gap-1">
              適用終了（任意）
              <input
                type="date"
                value={termForm.effectiveTo}
                onChange={(e) => setTermForm({ ...termForm, effectiveTo: e.target.value })}
                className="rounded-md border border-[var(--color-border)] px-2 py-1.5"
              />
            </label>
            <label className="flex items-center gap-2 sm:col-span-2">
              <input
                type="checkbox"
                checked={termForm.closeOpenEnded}
                onChange={(e) =>
                  setTermForm({ ...termForm, closeOpenEnded: e.target.checked })
                }
              />
              既存の無期限条件を前日で閉じる
            </label>
            <button
              type="button"
              onClick={() => void saveTerm()}
              className="rounded-md bg-[var(--color-accent)] px-3 py-2 text-white sm:col-span-2"
            >
              雇用条件を登録
            </button>
          </div>
          <ul className="divide-y divide-[var(--color-border)]">
            {terms.map((t) => (
              <li key={t.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:justify-between">
                <div>
                  {staffLabel(staff, t.staffId)} · {t.hourlyWageYen}円
                  <div className="text-[12px] text-[var(--color-text)]/70">
                    {t.effectiveFrom}〜{t.effectiveTo ?? "無期限"}
                    {t.revokedAt ? " · 失効済" : ""}
                  </div>
                </div>
                {!t.revokedAt ? (
                  <button
                    type="button"
                    className="text-[var(--color-text)]/70 underline"
                    onClick={() => void revokeTerm(t.id)}
                  >
                    失効
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
