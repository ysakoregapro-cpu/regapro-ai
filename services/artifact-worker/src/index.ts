/**
 * Artifact Worker — job claim loop skeleton.
 *
 * NOTE: Production Supabase Cron / pg_cron registration is NOT configured in this scaffold.
 */
import type { ArtifactJob } from "@regapro/database";
import { devSampleDatabase } from "@regapro/database";
import { MarkdownRenderer } from "@regapro/artifacts";

export interface JobProcessor<T extends { id: string; status: string; attempts: number; maxAttempts: number }> {
  claim(): Promise<T | null>;
  complete(id: string): Promise<void>;
  fail(id: string, error: string): Promise<void>;
}

export class InMemoryArtifactJobProcessor implements JobProcessor<ArtifactJob> {
  constructor(private readonly repo = devSampleDatabase.artifactJobs) {}

  async claim(): Promise<ArtifactJob | null> {
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
      updatedAt: new Date().toISOString(),
    });
  }
}

export async function processArtifactJob(_job: ArtifactJob): Promise<void> {
  const renderer = new MarkdownRenderer();
  await renderer.render({
    title: "Generated Artifact",
    format: "markdown",
    sections: [{ heading: "Content", body: "Stub content" }],
  });
}

export async function runArtifactWorkerLoop(
  processor: JobProcessor<ArtifactJob>,
  maxIterations = 10,
): Promise<number> {
  let processed = 0;
  for (let i = 0; i < maxIterations; i++) {
    const job = await processor.claim();
    if (!job) break;
    try {
      await processArtifactJob(job);
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
  const processed = await runArtifactWorkerLoop(new InMemoryArtifactJobProcessor());
  console.log(`Artifact worker processed ${processed} job(s)`);
}
