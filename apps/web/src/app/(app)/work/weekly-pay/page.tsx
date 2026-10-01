import { Suspense } from "react";
import WeeklyPayClient from "./WeeklyPayClient";

export const metadata = { title: "週払い" };

export default function Page() {
  return (
    <Suspense
      fallback={<div className="py-8 text-[13px] text-[var(--color-text)]/70">読み込み中…</div>}
    >
      <WeeklyPayClient />
    </Suspense>
  );
}
