import { listKnowledge } from "@/lib/application/catalog-service";
import { isDevSampleMode } from "@/lib/supabase/env";
import { KnowledgePageHeader } from "@/components/workspace/KnowledgeAdminClient";

export const metadata = { title: "ナレッジ" };

export default function KnowledgePage() {
  const rows = listKnowledge();
  const mode = isDevSampleMode() ? "dev-sample" : "supabase";
  return <KnowledgePageHeader mode={mode} sampleRows={rows} />;
}
