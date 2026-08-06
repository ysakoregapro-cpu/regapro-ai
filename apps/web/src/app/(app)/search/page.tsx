import { Suspense } from "react";
import SearchClient from "./SearchClient";

export const metadata = { title: "検索" };

export default function Page() {
  return (
    <Suspense fallback={<div className="py-8 text-[13px] text-text-secondary">読み込み中…</div>}>
      <SearchClient />
    </Suspense>
  );
}
