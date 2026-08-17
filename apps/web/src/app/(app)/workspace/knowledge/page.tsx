import { listKnowledge } from "@/lib/application/catalog-service";
import { isDevSampleMode } from "@/lib/supabase/env";
import { KnowledgePageHeader } from "@/components/workspace/KnowledgeAdminClient";

export const metadata = { title: "ナレッジ" };

export default async function KnowledgePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const rows = listKnowledge();
  const mode = isDevSampleMode() ? "dev-sample" : "supabase";
  const params = await searchParams;
  return (
    <KnowledgePageHeader
      mode={mode}
      sampleRows={rows}
      initialTab={params.tab}
    />
  );
}
