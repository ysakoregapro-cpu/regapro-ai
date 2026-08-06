import { Suspense } from "react";
import { WorkspaceSubnav } from "@/components/workspace/WorkspaceSubnav";
import { PageHeader } from "@/components/ui/primitives";
import { ResearchLibraryClient } from "@/components/workspace/ResearchLibraryClient";

export const metadata = { title: "調査" };

export default function ResearchPage() {
  return (
    <div>
      <WorkspaceSubnav />
      <PageHeader
        title="調査"
        description="調査結果を後から確認・管理します"
      />
      <div className="mt-4">
        <Suspense fallback={<p className="text-[13px] text-text-secondary">読み込み中…</p>}>
          <ResearchLibraryClient />
        </Suspense>
      </div>
    </div>
  );
}
