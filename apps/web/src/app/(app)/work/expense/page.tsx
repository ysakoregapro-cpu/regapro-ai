import { Suspense } from "react";
import ExpenseClient from "./ExpenseClient";

export const metadata = { title: "経費" };

export default function Page() {
  return (
    <Suspense
      fallback={<div className="py-8 text-[13px] text-[var(--color-text)]/70">読み込み中…</div>}
    >
      <ExpenseClient />
    </Suspense>
  );
}
