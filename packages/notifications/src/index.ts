import { z } from "zod";
import {
  addDaysTokyo,
  setTimeTokyo,
  startOfDayTokyo,
  toTokyoDate,
} from "@regapro/shared";

export const DeliveryStatusSchema = z.enum([
  "pending",
  "claimed",
  "delivered",
  "failed",
  "retry",
]);

export type DeliveryStatus = z.infer<typeof DeliveryStatusSchema>;

export const NotificationDeliverySchema = z.object({
  id: z.string().uuid(),
  notificationId: z.string().uuid(),
  channel: z.enum(["in_app", "push", "email"]),
  status: DeliveryStatusSchema,
  attempts: z.number().int().nonnegative(),
  lastError: z.string().nullable().optional(),
  claimedAt: z.string().datetime({ offset: true }).nullable().optional(),
  deliveredAt: z.string().datetime({ offset: true }).nullable().optional(),
});

export type NotificationDelivery = z.infer<typeof NotificationDeliverySchema>;

export const NotificationPreferenceSchema = z.object({
  userId: z.string().uuid(),
  inAppEnabled: z.boolean().default(true),
  pushEnabled: z.boolean().default(false),
  emailEnabled: z.boolean().default(false),
  taskRemindersEnabled: z.boolean().default(true),
  quietHoursStart: z.number().int().min(0).max(23).nullable().optional(),
  quietHoursEnd: z.number().int().min(0).max(23).nullable().optional(),
});

export type NotificationPreference = z.infer<
  typeof NotificationPreferenceSchema
>;

export const TaskReminderSchema = z.object({
  taskId: z.string().uuid(),
  userId: z.string().uuid(),
  remindAt: z.string().datetime({ offset: true }),
  dueAt: z.string().datetime({ offset: true }),
});

export type TaskReminder = z.infer<typeof TaskReminderSchema>;

export const DEFAULT_REMINDER_HOUR = 9;

export function computeDefaultTaskReminder(dueAt: Date): Date {
  const dueTokyo = toTokyoDate(dueAt);
  const dayBefore = addDaysTokyo(startOfDayTokyo(dueTokyo), -1);
  return setTimeTokyo(dayBefore, DEFAULT_REMINDER_HOUR);
}

export interface TaskForReminder {
  id: string;
  status: string;
  dueAt: string | null | undefined;
  assigneeId?: string | null;
}

export function recalculateTaskReminders(
  tasks: TaskForReminder[],
): TaskReminder[] {
  const reminders: TaskReminder[] = [];
  for (const task of tasks) {
    if (!task.dueAt || !task.assigneeId) continue;
    if (task.status === "completed" || task.status === "cancelled") continue;
    const due = new Date(task.dueAt);
    const remindAt = computeDefaultTaskReminder(due);
    reminders.push({
      taskId: task.id,
      userId: task.assigneeId,
      remindAt: remindAt.toISOString(),
      dueAt: due.toISOString(),
    });
  }
  return reminders;
}

export function canRetryDelivery(
  delivery: Pick<NotificationDelivery, "status" | "attempts">,
  maxAttempts = 3,
): boolean {
  return (
    (delivery.status === "failed" || delivery.status === "retry") &&
    delivery.attempts < maxAttempts
  );
}
