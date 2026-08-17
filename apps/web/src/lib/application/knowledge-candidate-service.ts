import "server-only";
import { assertNotDirectPublishFromAi } from "@regapro/knowledge";
import type { ConfidentialityLevel } from "@regapro/shared";
import type { AccessContext } from "@regapro/security";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import {
  createKnowledgeSourceAndJob,
  processIngestionJobUntilIdle,
} from "@/lib/application/knowledge-factory-service";

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
    access?: AccessContext;
    threadId: string;
    messageId: string | null;
    title: string;
    content: string;
    confidentialityLevel: ConfidentialityLevel;
    fromPrivateConversation: boolean;
    url?: string | null;
    retrievedAt?: string | null;
  },
): Promise<{ id: string } | null> {
  if (input.fromPrivateConversation) return null;
  assertNotDirectPublishFromAi("ai_answer", "draft");
  if (!input.access) return null;

  const created = await createKnowledgeSourceAndJob(client, {
    orgId: input.orgId,
    userId: input.userId,
    access: input.access,
    originKind: "research",
    title: input.title,
    text: input.content,
    url: input.url ?? null,
    confidentialityLevel: input.confidentialityLevel,
    visibility: "organization",
    originThreadId: input.threadId,
    originMessageId: input.messageId,
    domainKeys: ["company_common"],
  });
  if (!created.duplicate) {
    await processIngestionJobUntilIdle(client, {
      jobId: created.jobId,
      access: input.access,
      maxTicks: 8,
    });
  }
  return { id: created.sourceId };
}
