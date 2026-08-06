import {
  buildLlmContextSources,
  effectiveSearchCeiling,
  filterResourcesByAccess,
  type AccessContext,
} from "@regapro/security";
import type { ConfidentialityLevel, Visibility } from "@regapro/shared";
import { listKnowledge } from "@/lib/application/catalog-service";
import { resolveSessionAccess } from "@/lib/data/dev-sample/memberships";
import {
  getThread,
  searchAccessible,
} from "@/lib/application/chat-service";

export type ContextSource = {
  id: string;
  text: string;
  confidentialityLevel: ConfidentialityLevel;
  visibility: Visibility;
  title: string;
  sourceType: string;
};

/**
 * Builds LLM context only from AccessContext-filtered sources.
 * Never pulls unauthorized rows and then masks them.
 */
export function buildAssistantContext(input: {
  userId: string;
  threadId: string;
  query: string;
}): {
  access: AccessContext;
  ceiling: ConfidentialityLevel;
  sources: ContextSource[];
  rejectedIds: string[];
} {
  const thread = getThread(input.threadId, input.userId);
  if (!thread) {
    throw new Error("THREAD_NOT_FOUND");
  }

  const { access } = resolveSessionAccess({
    userId: input.userId,
    threadLevel: thread.confidentialityLevel,
    threadVisibility: thread.visibility,
    participantThreadIds: thread.ownerUserId === input.userId ? [thread.id] : [],
  });

  const ceiling = effectiveSearchCeiling(access);

  const knowledge = listKnowledge().map((k) => ({
    id: k.id,
    title: k.title,
    text: `${k.title} ${k.category} ${k.business}`,
    confidentialityLevel: (k as { confidentialityLevel?: ConfidentialityLevel })
      .confidentialityLevel ?? "company",
    visibility: k.visibility as Visibility,
    ownerUserId: "system",
    sourceType: "knowledge",
  }));

  const allowedKnowledge = filterResourcesByAccess(access, knowledge);

  const chatHits = searchAccessible(input.query, input.userId).map((h) => ({
    id: h.id,
    title: h.title,
    text: h.snippet,
    confidentialityLevel: h.confidentialityLevel,
    visibility: h.visibility,
    ownerUserId: input.userId,
    sourceType: h.sourceType,
  }));

  const candidates: ContextSource[] = [...allowedKnowledge, ...chatHits].map((s) => ({
    id: s.id,
    text: s.text,
    confidentialityLevel: s.confidentialityLevel,
    visibility: s.visibility,
    title: s.title,
    sourceType: "sourceType" in s ? String((s as { sourceType: string }).sourceType) : "knowledge",
  }));

  const { allowed, rejectedIds } = buildLlmContextSources(access, candidates);

  return {
    access,
    ceiling,
    sources: allowed,
    rejectedIds,
  };
}
