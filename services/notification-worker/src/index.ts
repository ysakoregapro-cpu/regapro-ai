/**
 * Notification Worker — delivery claim loop skeleton.
 *
 * NOTE: Production Supabase Cron / pg_cron registration is NOT configured in this scaffold.
 */
import type { Notification } from "@regapro/database";
import { devSampleDatabase } from "@regapro/database";
import {
  canRetryDelivery,
  type DeliveryStatus,
} from "@regapro/notifications";

export interface DeliveryJob {
  id: string;
  notificationId: string;
  status: DeliveryStatus;
  attempts: number;
  maxAttempts: number;
}

export interface DeliveryProcessor {
  claim(): Promise<DeliveryJob | null>;
  complete(id: string): Promise<void>;
  fail(id: string, error: string): Promise<void>;
}

export class InMemoryNotificationProcessor implements DeliveryProcessor {
  private deliveries = new Map<string, DeliveryJob>();

  enqueue(notification: Notification): DeliveryJob {
    const job: DeliveryJob = {
      id: crypto.randomUUID(),
      notificationId: notification.id,
      status: "pending",
      attempts: 0,
      maxAttempts: 3,
    };
    this.deliveries.set(job.id, job);
    return job;
  }

  async claim(): Promise<DeliveryJob | null> {
    const pending = [...this.deliveries.values()].filter(
      (d) => d.status === "pending" || d.status === "retry",
    );
    const job = pending[0];
    if (!job) return null;
    job.status = "claimed";
    job.attempts += 1;
    this.deliveries.set(job.id, job);
    return job;
  }

  async complete(id: string): Promise<void> {
    const job = this.deliveries.get(id);
    if (!job) return;
    job.status = "delivered";
    this.deliveries.set(id, job);
  }

  async fail(id: string, error: string): Promise<void> {
    const job = this.deliveries.get(id);
    if (!job) return;
    job.status = canRetryDelivery(job) ? "retry" : "failed";
    this.deliveries.set(id, job);
    void error;
  }
}

export async function processNotificationDelivery(
  _job: DeliveryJob,
): Promise<void> {
  // Stub: in-app / push delivery would happen here
}

export async function runNotificationWorkerLoop(
  processor: DeliveryProcessor,
  maxIterations = 10,
): Promise<number> {
  let processed = 0;
  for (let i = 0; i < maxIterations; i++) {
    const job = await processor.claim();
    if (!job) break;
    try {
      await processNotificationDelivery(job);
      await processor.complete(job.id);
      processed++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await processor.fail(job.id, message);
    }
  }
  return processed;
}

export async function runNotificationWorkerFromDatabase(
  maxIterations = 10,
): Promise<number> {
  const processor = new InMemoryNotificationProcessor();
  const pending = (await devSampleDatabase.notifications.list()).filter(
    (n) => n.status === "pending",
  );
  for (const n of pending) processor.enqueue(n);
  return runNotificationWorkerLoop(processor, maxIterations);
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}`) {
  const processed = await runNotificationWorkerFromDatabase();
  console.log(`Notification worker processed ${processed} delivery(ies)`);
}
