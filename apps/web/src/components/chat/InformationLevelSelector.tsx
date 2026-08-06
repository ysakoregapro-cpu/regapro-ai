"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Shield } from "lucide-react";
import type { ConfidentialityLevel } from "@regapro/shared";
import {
  CONFIDENTIALITY_HINTS,
  CONFIDENTIALITY_LABELS,
} from "@regapro/shared";
import { cn } from "@/lib/cn";

type Props = {
  value: ConfidentialityLevel;
  selectableLevels: ConfidentialityLevel[];
  locked?: boolean;
  onChange: (level: ConfidentialityLevel) => void | Promise<void>;
  className?: string;
};

export function InformationLevelSelector({
  value,
  selectableLevels,
  locked = false,
  onChange,
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  if (locked || selectableLevels.length <= 1) {
    return (
      <div
        className={cn(
          "inline-flex items-center gap-1 text-[12px] text-text-secondary",
          className,
        )}
        title={CONFIDENTIALITY_HINTS[value]}
      >
        <Shield className="h-3.5 w-3.5 opacity-70" aria-hidden />
        <span>情報区分：{CONFIDENTIALITY_LABELS[value]}</span>
      </div>
    );
  }

  return (
    <div ref={wrapRef} className={cn("relative shrink-0", className)}>
      <button
        type="button"
        className="inline-flex h-8 max-w-full items-center gap-1 rounded-md px-1.5 text-[12px] text-text-secondary hover:bg-surface-raised hover:text-text"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        disabled={busy}
        onClick={() => setOpen((v) => !v)}
      >
        <Shield className="h-3.5 w-3.5 opacity-70" aria-hidden />
        <span className="truncate">情報区分：{CONFIDENTIALITY_LABELS[value]}</span>
        <span aria-hidden>▾</span>
      </button>
      {open ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="情報区分"
          className="absolute right-0 z-[40] mt-1 min-w-[10rem] rounded-[12px] border border-border bg-surface py-1 shadow-[var(--shadow-menu)]"
        >
          {selectableLevels.map((l) => (
            <li key={l} role="option" aria-selected={l === value}>
              <button
                type="button"
                className={cn(
                  "flex w-full flex-col items-start px-3 py-2 text-left text-[12px] hover:bg-surface-raised",
                  l === value && "bg-accent-muted/50",
                )}
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    await onChange(l);
                    setOpen(false);
                  } catch (e) {
                    setError(e instanceof Error ? e.message : "変更できませんでした");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <span className="font-medium">{CONFIDENTIALITY_LABELS[l]}</span>
                <span className="text-[11px] text-text-muted">
                  {CONFIDENTIALITY_HINTS[l]}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? (
        <p role="alert" className="mt-1 max-w-[16rem] text-[11px] text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
