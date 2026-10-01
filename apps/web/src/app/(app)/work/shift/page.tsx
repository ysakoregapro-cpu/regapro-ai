import { Suspense } from "react";
import ShiftClient from "./ShiftClient";

export const metadata = { title: "シフト" };

export default function Page() {
  return (
    <Suspense
      fallback={<div className="py-8 text-[13px] text-[var(--color-text)]/70">読み込み中…</div>}
    >
      <ShiftClient />
    </Suspense>
  );
}
