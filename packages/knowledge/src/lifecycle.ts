import { z } from "zod";

export const KnowledgeLifecycleState = z.enum([
  "draft",
  "review",
  "approved",
  "published",
  "superseded",
  "expired",
  "archived",
]);

export type KnowledgeLifecycleState = z.infer<typeof KnowledgeLifecycleState>;

const TRANSITIONS: Record<KnowledgeLifecycleState, KnowledgeLifecycleState[]> =
  {
    draft: ["review", "archived"],
    review: ["approved", "draft", "archived"],
    approved: ["published", "review", "archived"],
    published: ["superseded", "expired", "archived"],
    superseded: ["archived"],
    expired: ["archived", "review"],
    archived: [],
  };

export function canTransitionKnowledge(
  from: KnowledgeLifecycleState,
  to: KnowledgeLifecycleState,
): boolean {
  return TRANSITIONS[from].includes(to);
}

export function transitionKnowledge(
  from: KnowledgeLifecycleState,
  to: KnowledgeLifecycleState,
): KnowledgeLifecycleState {
  if (!canTransitionKnowledge(from, to)) {
    throw new Error(`Invalid knowledge transition: ${from} -> ${to}`);
  }
  return to;
}

export const KnowledgeCandidateSchema = z.object({
  sourceAnswerId: z.string().uuid(),
  title: z.string().min(1),
  body: z.string().min(1),
  confidence: z.number().min(0).max(1),
  extractedFacts: z.array(z.string()).default([]),
});

export type KnowledgeCandidate = z.infer<typeof KnowledgeCandidateSchema>;

export function createDraftFromCandidate(
  candidate: KnowledgeCandidate,
): { title: string; body: string; status: "draft" } {
  return {
    title: candidate.title,
    body: candidate.body,
    status: "draft",
  };
}

/** AI answers must never be published directly — always draft first. */
export function assertNotDirectPublishFromAi(
  source: "ai_answer" | "human" | "import",
  targetStatus: KnowledgeLifecycleState,
): void {
  if (source === "ai_answer" && targetStatus === "published") {
    throw new Error(
      "AI answers cannot be published directly; require review and approval",
    );
  }
}

export {
  computeContentHash,
  isDuplicateHash,
  sha256Hex,
  normalizeKnowledgeText,
} from "./hash.js";
