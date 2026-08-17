import type { KnowledgeJobStatus, KnowledgeUnitStatus } from "./factory-types.js";

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
  leaseExpiresAt?: string | null;
  leaseOwner?: string | null;
  attemptCount?: number;
  nextAttemptAt?: string | null;
  lastErrorCode?: string | null;
  pausedAt?: string | null;
  cancelRequested?: boolean;
};

export type KnowledgeChunkLease = {
  id: string;
  jobId: string;
  chunkIndex: number;
  content: string;
  contentHash: string;
  status: KnowledgeUnitStatus;
  attemptCount: number;
  leaseExpiresAt: string | null;
};

export type KnowledgeJobQueue = {
  enqueue(input: { sourceId: string; orgId: string; createdBy: string }): Promise<string>;
  load(jobId: string): Promise<KnowledgeJobSnapshot | null>;
  saveProgress(job: KnowledgeJobSnapshot): Promise<void>;
};

export type KnowledgeJobLease = {
  claimJob(input: {
    jobId: string;
    owner: string;
    leaseSeconds: number;
    now?: Date;
  }): Promise<KnowledgeJobSnapshot | null>;
  releaseJob(input: {
    jobId: string;
    status: KnowledgeJobStatus;
    errorCode?: string | null;
  }): Promise<void>;
  claimChunks(input: {
    jobId: string;
    limit: number;
    leaseSeconds: number;
    includeWaitingForExtractor: boolean;
    maxAttempts: number;
    now?: Date;
  }): Promise<KnowledgeChunkLease[]>;
};

export type KnowledgeJobWorkerTick = {
  jobId: string;
  claimedChunks: number;
  completedChunks: number;
  failedChunks: number;
  waitingForExtractor: number;
  status: KnowledgeJobStatus;
};

export type KnowledgeJobWorker = {
  tick(input: { jobId: string; owner: string }): Promise<KnowledgeJobWorkerTick>;
};

function iso(d: Date): string {
  return d.toISOString();
}

/**
 * In-process durable-queue stand-in for tests.
 * Production uses Postgres claim RPCs; this port stays swappable
 * (Vercel Queue / external worker) without domain depending on pgmq.
 */
export class InMemoryKnowledgeJobQueue implements KnowledgeJobQueue, KnowledgeJobLease {
  private readonly jobs = new Map<string, KnowledgeJobSnapshot>();
  private readonly chunks = new Map<string, KnowledgeChunkLease[]>();

  seedChunks(jobId: string, chunks: KnowledgeChunkLease[]): void {
    this.chunks.set(jobId, chunks.map((c) => ({ ...c })));
  }

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
      leaseExpiresAt: null,
      attemptCount: 0,
      cancelRequested: false,
    });
    return id;
  }

  async load(jobId: string): Promise<KnowledgeJobSnapshot | null> {
    const job = this.jobs.get(jobId);
    return job ? { ...job } : null;
  }

  async saveProgress(job: KnowledgeJobSnapshot): Promise<void> {
    this.jobs.set(job.id, { ...job });
  }

  async claimJob(input: {
    jobId: string;
    owner: string;
    leaseSeconds: number;
    now?: Date;
  }): Promise<KnowledgeJobSnapshot | null> {
    const job = this.jobs.get(input.jobId);
    if (!job) return null;
    const now = input.now ?? new Date();
    if (job.cancelRequested) {
      job.status = "cancelled";
      return { ...job };
    }
    if (job.pausedAt) return null;
    if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
      return null;
    }
    if (
      job.leaseExpiresAt &&
      new Date(job.leaseExpiresAt) > now &&
      job.leaseOwner &&
      job.leaseOwner !== input.owner
    ) {
      return null;
    }
    job.status = "processing";
    job.leaseOwner = input.owner;
    job.leaseExpiresAt = iso(new Date(now.getTime() + input.leaseSeconds * 1000));
    job.attemptCount = (job.attemptCount ?? 0) + 1;
    job.startedAt = job.startedAt ?? iso(now);
    this.jobs.set(job.id, job);
    return { ...job };
  }

  async releaseJob(input: {
    jobId: string;
    status: KnowledgeJobStatus;
    errorCode?: string | null;
  }): Promise<void> {
    const job = this.jobs.get(input.jobId);
    if (!job) return;
    job.status = input.status;
    job.leaseExpiresAt = null;
    job.lastErrorCode = input.errorCode ?? job.lastErrorCode ?? null;
    if (input.status === "completed" || input.status === "failed" || input.status === "cancelled") {
      job.completedAt = iso(new Date());
    }
    this.jobs.set(job.id, job);
  }

  async claimChunks(input: {
    jobId: string;
    limit: number;
    leaseSeconds: number;
    includeWaitingForExtractor: boolean;
    maxAttempts: number;
    now?: Date;
  }): Promise<KnowledgeChunkLease[]> {
    const now = input.now ?? new Date();
    const rows = this.chunks.get(input.jobId) ?? [];
    const claimed: KnowledgeChunkLease[] = [];
    for (const row of rows) {
      if (claimed.length >= input.limit) break;
      const expired =
        row.status === "processing" &&
        row.leaseExpiresAt &&
        new Date(row.leaseExpiresAt) <= now;
      const waitingOk =
        input.includeWaitingForExtractor && row.status === "waiting_for_extractor";
      const open =
        row.status === "pending" || row.status === "retryable" || expired || waitingOk;
      if (!open) continue;
      if (row.attemptCount >= input.maxAttempts && row.status !== "pending") continue;
      row.status = "processing";
      row.attemptCount += 1;
      row.leaseExpiresAt = iso(new Date(now.getTime() + input.leaseSeconds * 1000));
      claimed.push({ ...row });
    }
    this.chunks.set(input.jobId, rows);
    return claimed;
  }

  markChunk(
    jobId: string,
    chunkId: string,
    status: KnowledgeUnitStatus,
    errorCode?: string,
  ): void {
    const rows = this.chunks.get(jobId) ?? [];
    for (const row of rows) {
      if (row.id !== chunkId) continue;
      row.status = status;
      row.leaseExpiresAt = null;
      if (errorCode) row.attemptCount = row.attemptCount;
    }
    this.chunks.set(jobId, rows);
  }

  poisonAfterMaxAttempts(jobId: string, maxAttempts: number): KnowledgeChunkLease[] {
    const poisoned: KnowledgeChunkLease[] = [];
    const rows = this.chunks.get(jobId) ?? [];
    for (const row of rows) {
      if (row.attemptCount >= maxAttempts && row.status !== "completed") {
        row.status = "failed";
        poisoned.push({ ...row });
      }
    }
    this.chunks.set(jobId, rows);
    return poisoned;
  }
}
