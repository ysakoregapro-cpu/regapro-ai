import { Suspense } from "react";
import AssistantPage from "./AssistantClient";

export const metadata = { title: "アシスタント" };

export default function Page() {
  return (
    <Suspense fallback={<div className="py-8 text-[13px] text-text-secondary">読み込み中…</div>}>
      <AssistantPage />
    </Suspense>
  );
}
