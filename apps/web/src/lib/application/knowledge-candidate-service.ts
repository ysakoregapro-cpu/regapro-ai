import "server-only";
import { assertNotDirectPublishFromAi } from "@regapro/knowledge";
import { confidentialityRank } from "@regapro/shared";
import type { ConfidentialityLevel } from "@regapro/shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<Database, "public", any>;

/**
 * Research / web evidence may become a Knowledge Candidate (draft only).
 * Never auto-publish. Never promote private conversation text.
 */
export async function createKnowledgeCandidateFromResearch(
  client: Client,
  input: {
    orgId: string;
    userId: string;
    threadId: string;
    messageId: string | null;
    title: string;
    content: string;
    confidentialityLevel: ConfidentialityLevel;
    fromPrivateConversation: boolean;
  },
): Promise<{ id: string } | null> {
  if (input.fromPrivateConversation) return null;
  assertNotDirectPublishFromAi("ai_answer", "draft");

  const { data, error } = await client
    .from("knowledge_candidates")
    .insert({
      org_id: input.orgId,
      title: input.title.slice(0, 200),
      content: input.content.slice(0, 8_000),
      suggested_confidentiality_level: confidentialityRank(input.confidentialityLevel),
      suggested_visibility: "organization",
      source_thread_id: input.threadId,
      source_message_ids: input.messageId ? [input.messageId] : [],
      source_user_id: input.userId,
      contains_personal_conversation: false,
      contains_personal_data: false,
      contains_compensation_data: false,
      classification_reasons: ["web_research_candidate"],
      status: "draft",
    })
    .select("id")
    .single();
  if (error || !data) return null;
  return { id: data.id };
}
