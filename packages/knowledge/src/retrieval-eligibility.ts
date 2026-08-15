import { z } from "zod";
import {
  transitionKnowledge,
  type KnowledgeLifecycleState,
} from "./lifecycle.js";

export const KnowledgeRetrievalEligibility = z.enum([
  "organization_retrieval",
  "private_memory_only",
  "review_queue_only",
  "excluded",
]);

export type KnowledgeRetrievalEligibility = z.infer<
  typeof KnowledgeRetrievalEligibility
>;

/**
 * Normal AI answers only retrieve `organization_retrieval`.
 * Candidates / raw / private / audit stay out of this path.
 */
export function eligibilityForKnowledgeDocument(input: {
  status: KnowledgeLifecycleState | string;
  containsPersonalConversation: boolean;
  visibility: string;
  sourceType?: string | null;
}): KnowledgeRetrievalEligibility {
  if (input.containsPersonalConversation) return "excluded";
  if (input.sourceType === "conversation_audit") return "excluded";
  if (input.visibility === "private") return "private_memory_only";

  switch (input.status) {
    case "published":
      return "organization_retrieval";
    case "draft":
    case "review":
    case "approved":
      return "review_queue_only";
    default:
      return "excluded";
  }
}

export function assertPublishPath(from: KnowledgeLifecycleState): void {
  if (from !== "approved") {
    throw new Error(`Cannot publish from ${from}; require approved → published`);
  }
  transitionKnowledge("approved", "published");
}

/** States that must never enter normal InternalKnowledgeRetriever. */
export const EXCLUDED_FROM_ORG_RETRIEVAL = [
  "draft",
  "review",
  "approved",
  "superseded",
  "expired",
  "archived",
] as const;
