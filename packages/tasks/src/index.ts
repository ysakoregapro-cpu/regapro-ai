import { z } from "zod";
import { parseJapaneseRelativeDate } from "@regapro/shared";
import type { Task } from "@regapro/database";

export const TaskDraftSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  dueAt: z.string().datetime({ offset: true }).optional(),
  assigneeHint: z.string().optional(),
  confidence: z.number().min(0).max(1),
  requiresConfirmation: z.boolean(),
});

export type TaskDraft = z.infer<typeof TaskDraftSchema>;

export interface TaskInterpreterResult {
  draft: TaskDraft;
  matchedPatterns: string[];
}

export function interpretNaturalLanguageTask(
  input: string,
  referenceDate: Date = new Date(),
): TaskInterpreterResult {
  const trimmed = input.trim();
  let title = trimmed;
  let dueAt: string | undefined;
  let confidence = 0.6;
  const matchedPatterns: string[] = [];

  const dueMatch = trimmed.match(
    /(?:期限|まで|締切)[：:\s]*(.+?)(?:$|[。、])/,
  );
  if (dueMatch?.[1]) {
    const parsed = parseJapaneseRelativeDate(dueMatch[1], referenceDate);
    if (parsed) {
      dueAt = parsed.date.toISOString();
      confidence = Math.max(confidence, parsed.confidence);
      matchedPatterns.push("due-date");
    }
  }

  const inlineDate = parseJapaneseRelativeDate(trimmed, referenceDate);
  if (inlineDate && !dueAt) {
    dueAt = inlineDate.date.toISOString();
    confidence = Math.max(confidence, inlineDate.confidence * 0.9);
    matchedPatterns.push(inlineDate.matched);
  }

  const assigneeMatch = trimmed.match(/(@[\w-]+|担当[:：]\s*\S+)/);
  if (assigneeMatch) {
    matchedPatterns.push("assignee");
    confidence += 0.05;
  }

  const actionMatch = trimmed.match(/^(TODO|タスク|やること)[:：]\s*(.+)/i);
  if (actionMatch?.[2]) {
    title = actionMatch[2].trim();
    confidence += 0.1;
    matchedPatterns.push("prefix");
  }

  confidence = Math.min(confidence, 1);

  return {
    draft: TaskDraftSchema.parse({
      title,
      description: trimmed !== title ? trimmed : undefined,
      dueAt,
      assigneeHint: assigneeMatch?.[1],
      confidence,
      requiresConfirmation: confidence < 0.85,
    }),
    matchedPatterns,
  };
}

export function shouldConfirmBeforeCreate(draft: TaskDraft): boolean {
  return draft.requiresConfirmation || draft.confidence < 0.85;
}

export function isReminderEligible(task: Pick<Task, "status">): boolean {
  return task.status !== "completed" && task.status !== "cancelled";
}

export function recalculateRemindersForTasks(
  tasks: Pick<Task, "id" | "status" | "dueAt">[],
): string[] {
  return tasks.filter((t) => t.dueAt && isReminderEligible(t)).map((t) => t.id);
}
