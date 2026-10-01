import { Suspense } from "react";
import WorkRecordsClient from "./WorkRecordsClient";

export const metadata = { title: "勤務実績" };

export default function Page() {
  return (
    <Suspense
      fallback={<div className="py-8 text-[13px] text-[var(--color-text)]/70">読み込み中…</div>}
    >
      <WorkRecordsClient />
    </Suspense>
  );
}
