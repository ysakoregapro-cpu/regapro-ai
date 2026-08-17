import type { KnowledgeJobStatus } from "./factory-types.js";

export type KnowledgeJobSnapshot = {
  id: string;
  sourceId: string;
  status: KnowledgeJobStatus;
  totalUnits: number;
  processedUnits: number;
  failedUnits: number;
  cursorIndex: number;
  errorSummary: string | null;
  startedAt: string | null;
  completedAt: string | null;
};

export type KnowledgeJobQueue = {
  enqueue(input: { sourceId: string; orgId: string; createdBy: string }): Promise<string>;
  load(jobId: string): Promise<KnowledgeJobSnapshot | null>;
  saveProgress(job: KnowledgeJobSnapshot): Promise<void>;
};

/**
 * In-process queue. Swap later for Vercel Queue / Supabase Queue / worker.
 */
export class InMemoryKnowledgeJobQueue implements KnowledgeJobQueue {
  private readonly jobs = new Map<string, KnowledgeJobSnapshot>();

  async enqueue(input: { sourceId: string; orgId: string; createdBy: string }): Promise<string> {
    void input.orgId;
    void input.createdBy;
    const id = globalThis.crypto.randomUUID();
    this.jobs.set(id, {
      id,
      sourceId: input.sourceId,
      status: "pending",
      totalUnits: 0,
      processedUnits: 0,
      failedUnits: 0,
      cursorIndex: 0,
      errorSummary: null,
      startedAt: null,
      completedAt: null,
    });
    return id;
  }

  async load(jobId: string): Promise<KnowledgeJobSnapshot | null> {
    return this.jobs.get(jobId) ?? null;
  }

  async saveProgress(job: KnowledgeJobSnapshot): Promise<void> {
    this.jobs.set(job.id, { ...job });
  }
}
