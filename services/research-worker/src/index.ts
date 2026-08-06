/**
 * Research Worker — job claim loop skeleton.
 *
 * NOTE: Production Supabase Cron / pg_cron registration is NOT configured in this scaffold.
 * Wire scheduling separately when deploying to production.
 */
import type { ResearchJob } from "@regapro/database";
import { devSampleDatabase } from "@regapro/database";
import { RESEARCH_STAGES } from "@regapro/research";

export interface JobProcessor<T extends { id: string; status: string; attempts: number; maxAttempts: number }> {
  claim(): Promise<T | null>;
  complete(id: string): Promise<void>;
  fail(id: string, error: string): Promise<void>;
}

export class InMemoryResearchJobProcessor implements JobProcessor<ResearchJob> {
  constructor(
    private readonly repo = devSampleDatabase.researchJobs,
  ) {}

  async claim(): Promise<ResearchJob | null> {
    const pending = (await this.repo.list()).filter(
      (j) => j.status === "pending" || j.status === "retry",
    );
    const job = pending[0];
    if (!job) return null;
    await this.repo.update(job.id, {
      status: "claimed",
      attempts: job.attempts + 1,
      updatedAt: new Date().toISOString(),
    });
    return (await this.repo.findById(job.id))!;
  }

  async complete(id: string): Promise<void> {
    await this.repo.update(id, {
      status: "completed",
      updatedAt: new Date().toISOString(),
    });
  }

  async fail(id: string, error: string): Promise<void> {
    const job = await this.repo.findById(id);
    if (!job) return;
    const nextStatus =
      job.attempts >= job.maxAttempts ? "failed" : "retry";
    await this.repo.update(id, {
      status: nextStatus,
      lastError: error,
      updatedAt: new Date().toISOString(),
    });
  }
}

export async function processResearchJob(job: ResearchJob): Promise<void> {
  const stageIndex = RESEARCH_STAGES.indexOf(
    job.stage as (typeof RESEARCH_STAGES)[number],
  );
  if (stageIndex < 0) {
    throw new Error(`Unknown research stage: ${job.stage}`);
  }
}

export async function runResearchWorkerLoop(
  processor: JobProcessor<ResearchJob>,
  maxIterations = 10,
): Promise<number> {
  let processed = 0;
  for (let i = 0; i < maxIterations; i++) {
    const job = await processor.claim();
    if (!job) break;
    try {
      await processResearchJob(job);
      await processor.complete(job.id);
      processed++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await processor.fail(job.id, message);
    }
  }
  return processed;
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}`) {
  const processed = await runResearchWorkerLoop(new InMemoryResearchJobProcessor());
  console.log(`Research worker processed ${processed} job(s)`);
}
