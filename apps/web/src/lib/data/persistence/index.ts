import "server-only";
import { isDevSampleMode } from "@/lib/supabase/env";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { WorkUnitPersistence } from "./ports";
import { createSupabaseChatPersistence } from "./supabase-chat";
import {
  createSupabaseArtifactPersistence,
  createSupabaseFilePersistence,
  createSupabaseResearchPersistence,
  createSupabaseTaskPersistence,
} from "./supabase-work-units";
import type { InheritedResource } from "@/lib/application/chat-service";

const derivedMemory = new Map<string, InheritedResource[]>();

function createDerivedPersistence(): WorkUnitPersistence["derived"] {
  return {
    async create(resource) {
      const list = derivedMemory.get(resource.originThreadId) ?? [];
      list.push(resource);
      derivedMemory.set(resource.originThreadId, list);
      return resource;
    },
    async listByThread(threadId) {
      return derivedMemory.get(threadId) ?? [];
    },
  };
}

/**
 * Returns work-unit persistence for the active data mode.
 * Dev-sample callers should keep using in-memory services directly.
 */
export async function getSupabaseWorkUnitPersistence(): Promise<WorkUnitPersistence> {
  if (isDevSampleMode()) {
    throw new Error("getSupabaseWorkUnitPersistence requires REGAPRO_DATA_MODE=supabase");
  }
  // Structural cast: @supabase/ssr vs @supabase/supabase-js Database generic arity.
  const client = (await createServerSupabaseClient()) as unknown as Parameters<
    typeof createSupabaseChatPersistence
  >[0];
  return {
    chat: createSupabaseChatPersistence(client),
    tasks: createSupabaseTaskPersistence(client),
    artifacts: createSupabaseArtifactPersistence(client),
    research: createSupabaseResearchPersistence(client),
    files: createSupabaseFilePersistence(client),
    derived: createDerivedPersistence(),
  };
}

export function isUuid(value: string | null | undefined): boolean {
  if (!value) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}
