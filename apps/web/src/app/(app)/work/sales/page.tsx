import { Suspense } from "react";
import SalesClient from "./SalesClient";

export const metadata = { title: "売上" };

export default function Page() {
  return (
    <Suspense
      fallback={<div className="py-8 text-[13px] text-[var(--color-text)]/70">読み込み中…</div>}
    >
      <SalesClient />
    </Suspense>
  );
}
