"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Perms = { viewOwn: boolean; request: boolean; manage: boolean };
type Tab = "schedule" | "request" | "inbox" | "manage" | "locations";

type Location = { id: string; code: string; name: string };
type StaffRow = { staffId: string; staffNo: string; name: string };
type ShiftRow = {
  id: string;
  staffId: string;
  workDate: string;
  startTime: string | null;
  endTime: string | null;
  endDayOffset: number;
  workLocationId: string | null;
  status: string;
  note: string | null;
};
type RequestDate = {
  id: string;
  workDate: string;
  preferenceType: string;
  startTime: string | null;
  endTime: string | null;
  workLocationId: string | null;
  note: string | null;
};
type ShiftRequest = {
  id: string;
  staffId: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  version: number;
  submittedAt: string | null;
  dates: RequestDate[];
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

export default function ShiftClient() {
  const [perms, setPerms] = useState<Perms | null>(null);
  const [tab, setTab] = useState<Tab>("schedule");
  const [error, setError] = useState<string | null>(null);
  const [from, setFrom] = useState(() => addDays(tokyoToday(), -7));
  const [to, setTo] = useState(() => addDays(tokyoToday(), 21));
  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  const [requests, setRequests] = useState<ShiftRequest[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [periodStart, setPeriodStart] = useState(() => tokyoToday());
  const [periodEnd, setPeriodEnd] = useState(() => addDays(tokyoToday(), 6));
  const [dateRows, setDateRows] = useState<
    Array<{
      workDate: string;
      preferenceType: "hope_work" | "hope_off";
      startTime: string;
      endTime: string;
      workLocationId: string;
      note: string;
    }>
  >([{ workDate: tokyoToday(), preferenceType: "hope_work", startTime: "10:00", endTime: "19:00", workLocationId: "", note: "" }]);
  const [shiftForm, setShiftForm] = useState({
    id: "" as string,
    staffId: "",
    workDate: tokyoToday(),
    startTime: "10:00",
    endTime: "19:00",
    endDayOffset: 0,
    workLocationId: "",
    note: "",
  });
  const [locForm, setLocForm] = useState({ code: "", name: "", addressText: "" });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const session = await api<{ membership?: { permissions?: string[] } }>(
          "/api/auth/session",
        );
        const keys = new Set(session.membership?.permissions ?? []);
        const next: Perms = {
          viewOwn: keys.has("shift.view_own") || keys.has("shift.manage"),
          request: keys.has("shift.request") || keys.has("shift.manage"),
          manage: keys.has("shift.manage"),
        };
        if (!cancelled) {
          setPerms(next);
          if (next.manage) setTab("manage");
          else if (next.request) setTab("request");
          else setTab("schedule");
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
    if (perms.viewOwn) list.push({ id: "schedule", label: "勤務予定" });
    if (perms.request) list.push({ id: "request", label: "希望提出" });
    if (perms.manage) {
      list.push({ id: "inbox", label: "希望一覧" });
      list.push({ id: "manage", label: "シフト管理" });
      list.push({ id: "locations", label: "勤務地" });
    }
    return list;
  }, [perms]);

  const loadShifts = useCallback(async (staffId?: string) => {
    const q = new URLSearchParams({ from, to });
    if (staffId) q.set("staffId", staffId);
    const data = await api<{ shifts: ShiftRow[] }>(`/api/work/shifts?${q}`);
    setShifts(data.shifts ?? []);
  }, [from, to]);

  const loadRequests = useCallback(async () => {
    const q = new URLSearchParams();
    if (periodStart) q.set("periodStart", periodStart);
    if (periodEnd) q.set("periodEnd", periodEnd);
    const data = await api<{ requests: ShiftRequest[] }>(
      `/api/work/shift-requests?${q}`,
    );
    setRequests(data.requests ?? []);
  }, [periodStart, periodEnd]);

  const loadLocations = useCallback(async () => {
    const data = await api<{ locations: Location[] }>("/api/work/locations");
    setLocations(data.locations ?? []);
  }, []);

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
        await loadLocations();
        if (tab === "schedule" || tab === "manage") await loadShifts();
        if (tab === "request" || tab === "inbox") await loadRequests();
        if (perms.manage && (tab === "manage" || tab === "inbox")) await loadStaff();
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "読み込み失敗");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [perms, tab, loadShifts, loadRequests, loadLocations, loadStaff]);

  async function saveRequestDraft() {
    setError(null);
    try {
      await api("/api/work/shift-requests", {
        method: "POST",
        body: JSON.stringify({
          periodStart,
          periodEnd,
          dates: dateRows.map((r) => ({
            workDate: r.workDate,
            preferenceType: r.preferenceType,
            startTime: r.preferenceType === "hope_work" && r.startTime ? r.startTime : null,
            endTime: r.preferenceType === "hope_work" && r.endTime ? r.endTime : null,
            workLocationId: r.workLocationId || null,
            note: r.note || null,
          })),
        }),
      });
      await loadRequests();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失敗");
    }
  }

  async function submitRequest(id: string) {
    setError(null);
    try {
      await api(`/api/work/shift-requests/${id}/submit`, { method: "POST", body: "{}" });
      await loadRequests();
    } catch (e) {
      setError(e instanceof Error ? e.message : "提出失敗");
    }
  }

  async function cancelRequest(id: string) {
    setError(null);
    try {
      await api(`/api/work/shift-requests/${id}/cancel`, { method: "POST", body: "{}" });
      await loadRequests();
    } catch (e) {
      setError(e instanceof Error ? e.message : "取消失敗");
    }
  }

  async function saveShift() {
    setError(null);
    try {
      const body = {
        staffId: shiftForm.staffId,
        workDate: shiftForm.workDate,
        startTime: shiftForm.startTime || null,
        endTime: shiftForm.endTime || null,
        endDayOffset: shiftForm.endDayOffset as 0 | 1,
        workLocationId: shiftForm.workLocationId || null,
        note: shiftForm.note || null,
      };
      if (shiftForm.id) {
        await api(`/api/work/shifts/${shiftForm.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            workDate: body.workDate,
            startTime: body.startTime,
            endTime: body.endTime,
            endDayOffset: body.endDayOffset,
            workLocationId: body.workLocationId,
            note: body.note,
          }),
        });
      } else {
        await api("/api/work/shifts", { method: "POST", body: JSON.stringify(body) });
      }
      setShiftForm((f) => ({ ...f, id: "", note: "" }));
      await loadShifts();
    } catch (e) {
      setError(e instanceof Error ? e.message : "シフト保存失敗");
    }
  }

  async function publish(id: string) {
    setError(null);
    try {
      await api(`/api/work/shifts/${id}/publish`, { method: "POST", body: "{}" });
      await loadShifts();
    } catch (e) {
      setError(e instanceof Error ? e.message : "公開失敗");
    }
  }

  async function cancelShift(id: string) {
    setError(null);
    try {
      await api(`/api/work/shifts/${id}/cancel`, { method: "POST", body: "{}" });
      await loadShifts();
    } catch (e) {
      setError(e instanceof Error ? e.message : "取消失敗");
    }
  }

  async function saveLocation() {
    setError(null);
    try {
      await api("/api/work/locations", {
        method: "POST",
        body: JSON.stringify({
          code: locForm.code,
          name: locForm.name,
          addressText: locForm.addressText || null,
        }),
      });
      setLocForm({ code: "", name: "", addressText: "" });
      await loadLocations();
    } catch (e) {
      setError(e instanceof Error ? e.message : "勤務地保存失敗");
    }
  }

  if (!perms) {
    return <div className="py-8 text-[13px] text-[var(--color-text)]/70">読み込み中…</div>;
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 pb-24 sm:pb-6">
      <header className="mb-4 border-b border-[var(--color-border)] pb-4">
        <h1 className="text-lg font-semibold text-[var(--color-text)]">シフト</h1>
        <dl className="mt-2 grid gap-1 text-[12px] text-[var(--color-text)]/80 sm:grid-cols-3">
          <div>
            <dt className="font-medium text-[var(--color-text)]">今やること</dt>
            <dd>{tab === "request" ? "希望シフト提出" : tab === "manage" ? "シフト編成" : "公開シフト確認"}</dd>
          </div>
          <div>
            <dt className="font-medium text-[var(--color-text)]">対象と状態</dt>
            <dd>shift_requests / published shifts</dd>
          </div>
          <div>
            <dt className="font-medium text-[var(--color-text)]">次の操作</dt>
            <dd>{tab === "request" ? "期間を選んで保存" : "一覧から更新"}</dd>
          </div>
        </dl>
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

      {(tab === "schedule" || tab === "manage") && (
        <div className="mb-3 flex flex-wrap gap-2 text-[13px]">
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
          <button
            type="button"
            onClick={() => void loadShifts()}
            className="rounded-md border border-[var(--color-border)] px-3 py-1"
          >
            絞り込み
          </button>
        </div>
      )}

      {tab === "schedule" ? (
        <section>
          <ul className="divide-y divide-[var(--color-border)] text-[13px]">
            {shifts
              .filter((s) => s.status === "published")
              .map((s) => (
                <li key={s.id} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="font-medium">{s.workDate}</div>
                    <div className="text-[var(--color-text)]/70">
                      {s.startTime?.slice(0, 5) ?? "—"}〜{s.endTime?.slice(0, 5) ?? "—"}
                      {s.endDayOffset ? " (+1日)" : ""}
                      {s.workLocationId
                        ? ` / ${locations.find((l) => l.id === s.workLocationId)?.name ?? "勤務地"}`
                        : ""}
                    </div>
                  </div>
                  <span className="text-[12px] text-[var(--color-text)]/60">公開済み</span>
                </li>
              ))}
            {shifts.filter((s) => s.status === "published").length === 0 ? (
              <li className="py-6 text-[var(--color-text)]/60">公開された勤務予定はありません。</li>
            ) : null}
          </ul>
        </section>
      ) : null}

      {tab === "request" ? (
        <section className="space-y-4 text-[13px]">
          <div className="flex flex-wrap gap-2">
            <label className="flex flex-col gap-1">
              期間開始
              <input
                type="date"
                value={periodStart}
                onChange={(e) => setPeriodStart(e.target.value)}
                className="rounded-md border border-[var(--color-border)] px-2 py-1.5"
              />
            </label>
            <label className="flex flex-col gap-1">
              期間終了
              <input
                type="date"
                value={periodEnd}
                onChange={(e) => setPeriodEnd(e.target.value)}
                className="rounded-md border border-[var(--color-border)] px-2 py-1.5"
              />
            </label>
          </div>
          {dateRows.map((row, idx) => (
            <div key={idx} className="grid gap-2 border-b border-[var(--color-border)] pb-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1">
                日付
                <input
                  type="date"
                  value={row.workDate}
                  onChange={(e) => {
                    const next = [...dateRows];
                    next[idx] = { ...row, workDate: e.target.value };
                    setDateRows(next);
                  }}
                  className="rounded-md border border-[var(--color-border)] px-2 py-1.5"
                />
              </label>
              <label className="flex flex-col gap-1">
                希望
                <select
                  value={row.preferenceType}
                  onChange={(e) => {
                    const next = [...dateRows];
                    next[idx] = {
                      ...row,
                      preferenceType: e.target.value as "hope_work" | "hope_off",
                    };
                    setDateRows(next);
                  }}
                  className="rounded-md border border-[var(--color-border)] px-2 py-1.5"
                >
                  <option value="hope_work">勤務希望</option>
                  <option value="hope_off">休み希望</option>
                </select>
              </label>
              {row.preferenceType === "hope_work" ? (
                <>
                  <label className="flex flex-col gap-1">
                    開始
                    <input
                      type="time"
                      value={row.startTime}
                      onChange={(e) => {
                        const next = [...dateRows];
                        next[idx] = { ...row, startTime: e.target.value };
                        setDateRows(next);
                      }}
                      className="rounded-md border border-[var(--color-border)] px-2 py-1.5"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    終了
                    <input
                      type="time"
                      value={row.endTime}
                      onChange={(e) => {
                        const next = [...dateRows];
                        next[idx] = { ...row, endTime: e.target.value };
                        setDateRows(next);
                      }}
                      className="rounded-md border border-[var(--color-border)] px-2 py-1.5"
                    />
                  </label>
                </>
              ) : null}
              <label className="flex flex-col gap-1 sm:col-span-2">
                勤務地
                <select
                  value={row.workLocationId}
                  onChange={(e) => {
                    const next = [...dateRows];
                    next[idx] = { ...row, workLocationId: e.target.value };
                    setDateRows(next);
                  }}
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
              <label className="flex flex-col gap-1 sm:col-span-2">
                備考
                <input
                  value={row.note}
                  onChange={(e) => {
                    const next = [...dateRows];
                    next[idx] = { ...row, note: e.target.value };
                    setDateRows(next);
                  }}
                  className="rounded-md border border-[var(--color-border)] px-2 py-1.5"
                />
              </label>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-md border border-[var(--color-border)] px-3 py-2"
              onClick={() =>
                setDateRows((rows) => [
                  ...rows,
                  {
                    workDate: periodStart,
                    preferenceType: "hope_work",
                    startTime: "10:00",
                    endTime: "19:00",
                    workLocationId: "",
                    note: "",
                  },
                ])
              }
            >
              日付を追加
            </button>
            <button
              type="button"
              onClick={() => void saveRequestDraft()}
              className="rounded-md bg-[var(--color-accent)] px-3 py-2 text-white"
            >
              draft 保存
            </button>
          </div>
          <h2 className="pt-2 font-medium">自分の希望履歴</h2>
          <ul className="divide-y divide-[var(--color-border)]">
            {requests.map((r) => (
              <li key={r.id} className="py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    {r.periodStart}〜{r.periodEnd} / {r.status} / v{r.version}
                    <div className="text-[12px] text-[var(--color-text)]/60">
                      {r.dates.length}日 · {r.submittedAt ? `提出 ${r.submittedAt.slice(0, 10)}` : "未提出"}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {r.status === "draft" ? (
                      <button
                        type="button"
                        className="text-[var(--color-accent)] underline"
                        onClick={() => void submitRequest(r.id)}
                      >
                        提出
                      </button>
                    ) : null}
                    {r.status === "draft" || r.status === "submitted" ? (
                      <button
                        type="button"
                        className="text-[var(--color-text)]/70 underline"
                        onClick={() => void cancelRequest(r.id)}
                      >
                        取消
                      </button>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {tab === "inbox" ? (
        <section className="text-[13px]">
          <ul className="divide-y divide-[var(--color-border)]">
            {requests
              .filter((r) => r.status === "submitted")
              .map((r) => (
                <li key={r.id} className="py-3">
                  <div className="font-medium">
                    {staffLabel(staff, r.staffId)} · {r.periodStart}〜{r.periodEnd}
                  </div>
                  <ul className="mt-1 space-y-1 text-[12px] text-[var(--color-text)]/70">
                    {r.dates.map((d) => (
                      <li key={d.id}>
                        {d.workDate} {d.preferenceType === "hope_work" ? "勤務" : "休み"}
                        {d.startTime ? ` ${d.startTime.slice(0, 5)}〜${d.endTime?.slice(0, 5) ?? ""}` : ""}
                        {d.note ? ` · ${d.note}` : ""}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            {requests.filter((r) => r.status === "submitted").length === 0 ? (
              <li className="py-6 text-[var(--color-text)]/60">提出済みの希望はありません。</li>
            ) : null}
          </ul>
        </section>
      ) : null}

      {tab === "manage" ? (
        <section className="space-y-4 text-[13px]">
          <div className="grid max-w-xl gap-2 sm:grid-cols-2">
            <label className="flex flex-col gap-1 sm:col-span-2">
              スタッフ
              <select
                value={shiftForm.staffId}
                onChange={(e) => setShiftForm({ ...shiftForm, staffId: e.target.value })}
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
              日付
              <input
                type="date"
                value={shiftForm.workDate}
                onChange={(e) => setShiftForm({ ...shiftForm, workDate: e.target.value })}
                className="rounded-md border border-[var(--color-border)] px-2 py-1.5"
              />
            </label>
            <label className="flex flex-col gap-1">
              深夜跨ぎ
              <select
                value={shiftForm.endDayOffset}
                onChange={(e) =>
                  setShiftForm({ ...shiftForm, endDayOffset: Number(e.target.value) })
                }
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
                value={shiftForm.startTime}
                onChange={(e) => setShiftForm({ ...shiftForm, startTime: e.target.value })}
                className="rounded-md border border-[var(--color-border)] px-2 py-1.5"
              />
            </label>
            <label className="flex flex-col gap-1">
              終了
              <input
                type="time"
                value={shiftForm.endTime}
                onChange={(e) => setShiftForm({ ...shiftForm, endTime: e.target.value })}
                className="rounded-md border border-[var(--color-border)] px-2 py-1.5"
              />
            </label>
            <label className="flex flex-col gap-1 sm:col-span-2">
              勤務地
              <select
                value={shiftForm.workLocationId}
                onChange={(e) => setShiftForm({ ...shiftForm, workLocationId: e.target.value })}
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
            <label className="flex flex-col gap-1 sm:col-span-2">
              備考
              <input
                value={shiftForm.note}
                onChange={(e) => setShiftForm({ ...shiftForm, note: e.target.value })}
                className="rounded-md border border-[var(--color-border)] px-2 py-1.5"
              />
            </label>
            <button
              type="button"
              onClick={() => void saveShift()}
              className="rounded-md bg-[var(--color-accent)] px-3 py-2 text-white sm:col-span-2"
            >
              {shiftForm.id ? "draft を更新" : "draft を作成"}
            </button>
          </div>
          <ul className="divide-y divide-[var(--color-border)]">
            {shifts.map((s) => (
              <li key={s.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="font-medium">
                    {s.workDate} · {staffLabel(staff, s.staffId)} · {s.status}
                  </div>
                  <div className="text-[12px] text-[var(--color-text)]/70">
                    {s.startTime?.slice(0, 5) ?? "—"}〜{s.endTime?.slice(0, 5) ?? "—"}
                    {s.endDayOffset ? " (+1)" : ""}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {s.status === "draft" ? (
                    <>
                      <button
                        type="button"
                        className="text-[var(--color-accent)] underline"
                        onClick={() =>
                          setShiftForm({
                            id: s.id,
                            staffId: s.staffId,
                            workDate: s.workDate,
                            startTime: s.startTime?.slice(0, 5) ?? "",
                            endTime: s.endTime?.slice(0, 5) ?? "",
                            endDayOffset: s.endDayOffset,
                            workLocationId: s.workLocationId ?? "",
                            note: s.note ?? "",
                          })
                        }
                      >
                        編集
                      </button>
                      <button
                        type="button"
                        className="text-[var(--color-accent)] underline"
                        onClick={() => void publish(s.id)}
                      >
                        公開
                      </button>
                    </>
                  ) : null}
                  {s.status !== "cancelled" ? (
                    <button
                      type="button"
                      className="text-[var(--color-text)]/70 underline"
                      onClick={() => void cancelShift(s.id)}
                    >
                      取消
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {tab === "locations" ? (
        <section className="max-w-md space-y-3 text-[13px]">
          <ul className="divide-y divide-[var(--color-border)]">
            {locations.map((l) => (
              <li key={l.id} className="py-2">
                {l.code} · {l.name}
              </li>
            ))}
          </ul>
          <label className="flex flex-col gap-1">
            コード
            <input
              value={locForm.code}
              onChange={(e) => setLocForm({ ...locForm, code: e.target.value })}
              className="rounded-md border border-[var(--color-border)] px-2 py-1.5"
            />
          </label>
          <label className="flex flex-col gap-1">
            名称
            <input
              value={locForm.name}
              onChange={(e) => setLocForm({ ...locForm, name: e.target.value })}
              className="rounded-md border border-[var(--color-border)] px-2 py-1.5"
            />
          </label>
          <label className="flex flex-col gap-1">
            住所（任意）
            <input
              value={locForm.addressText}
              onChange={(e) => setLocForm({ ...locForm, addressText: e.target.value })}
              className="rounded-md border border-[var(--color-border)] px-2 py-1.5"
            />
          </label>
          <button
            type="button"
            onClick={() => void saveLocation()}
            className="rounded-md bg-[var(--color-accent)] px-3 py-2 text-white"
          >
            勤務地を追加
          </button>
        </section>
      ) : null}
    </div>
  );
}
