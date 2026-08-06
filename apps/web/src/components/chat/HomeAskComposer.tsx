"use client";

import { useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ConfidentialityLevel } from "@regapro/shared";
import {
  CONFIDENTIALITY_HINTS,
  CONFIDENTIALITY_LABELS,
} from "@regapro/shared";
import { cn } from "@/lib/cn";

type Props = {
  selectableLevels: ConfidentialityLevel[];
  defaultLevel?: ConfidentialityLevel;
  /** sales: no dropdown */
  locked?: boolean;
};

export function HomeAskComposer({
  selectableLevels,
  defaultLevel = "company",
  locked = false,
}: Props) {
  const router = useRouter();
  const inputId = useId();
  const levelId = useId();
  const [content, setContent] = useState("");
  const [level, setLevel] = useState<ConfidentialityLevel>(defaultLevel);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{
    message: string;
    suggestedLevel: ConfidentialityLevel;
  } | null>(null);
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const showLevelControl = !locked && selectableLevels.length > 1;

  const levelOptions = useMemo(
    () => selectableLevels.map((l) => ({ value: l, label: CONFIDENTIALITY_LABELS[l] })),
    [selectableLevels],
  );

  async function submit(opts?: { confirmRaise?: boolean; raiseTo?: ConfidentialityLevel }) {
    setPending(true);
    setError(null);
    try {
      const requestedLevel = opts?.raiseTo ?? level;
      const res = await fetch("/api/chat/start", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          content,
          requestedLevel,
          confirmRaise: opts?.confirmRaise === true,
          idempotencyKey,
        }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        redirectTo?: string;
        code?: string;
        message?: string;
        suggestedLevel?: ConfidentialityLevel;
        restoreContent?: string;
      };

      if (data.restoreContent != null) setContent(data.restoreContent);

      if (!data.ok) {
        if (data.code === "NEEDS_CONFIRMATION" && data.suggestedLevel) {
          setConfirm({
            message: data.message ?? "情報区分の確認が必要です",
            suggestedLevel: data.suggestedLevel,
          });
          return;
        }
        setError(data.message ?? "開始できませんでした");
        return;
      }

      if (data.redirectTo) {
        router.push(data.redirectTo);
      }
    } catch {
      setError("通信に失敗しました。入力内容は保持されています。");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="border-b border-border pb-6">
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!pending) void submit();
        }}
      >
        <label htmlFor={inputId} className="sr-only">
          依頼内容
        </label>
        <input
          id={inputId}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          disabled={pending}
          placeholder="何を進めますか？　例）明日までに森藤さんへ求人選定を確認"
          className="h-11 w-full rounded-md border border-border bg-surface px-3 text-[14px] outline-none placeholder:text-text-muted focus:border-accent disabled:opacity-60"
        />

        <div className="flex flex-wrap items-center gap-2">
          {locked || !showLevelControl ? (
            <p className="text-[11px] text-text-muted">
              情報区分：{CONFIDENTIALITY_LABELS[level]}
            </p>
          ) : (
            <div className="flex items-center gap-1.5">
              <label htmlFor={levelId} className="text-[11px] text-text-secondary">
                情報区分
              </label>
              <select
                id={levelId}
                value={level}
                onChange={(e) => setLevel(e.target.value as ConfidentialityLevel)}
                className="h-8 rounded-md border border-border bg-surface px-2 text-[12px] text-text-secondary"
                aria-describedby={`${levelId}-hint`}
              >
                {levelOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <span id={`${levelId}-hint`} className="sr-only">
                {CONFIDENTIALITY_HINTS[level]}
              </span>
            </div>
          )}
          <button
            type="submit"
            disabled={pending || !content.trim()}
            className={cn(
              "ml-auto h-8 rounded-md bg-accent px-3 text-[12px] font-medium text-accent-fg",
              "disabled:opacity-50",
            )}
          >
            {pending ? "開始中…" : "会話を開始"}
          </button>
        </div>
      </form>

      {error ? (
        <p role="alert" className="mt-2 text-[12px] text-danger">
          {error}
        </p>
      ) : null}

      {confirm ? (
        <div
          role="dialog"
          aria-modal="true"
          className="mt-3 rounded-[10px] border border-border bg-surface p-3"
        >
          <p className="text-[13px] leading-relaxed">{confirm.message}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="h-8 rounded-md bg-accent px-3 text-[12px] text-accent-fg"
              disabled={pending}
              onClick={() =>
                void submit({
                  confirmRaise: true,
                  raiseTo: confirm.suggestedLevel,
                })
              }
            >
              変更して続ける
            </button>
            <button
              type="button"
              className="h-8 rounded-md border border-border px-3 text-[12px]"
              onClick={() => setConfirm(null)}
            >
              内容を修正する
            </button>
            <button
              type="button"
              className="h-8 rounded-md px-3 text-[12px] text-text-secondary"
              onClick={() => {
                setConfirm(null);
              }}
            >
              キャンセル
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
