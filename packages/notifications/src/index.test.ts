import { describe, expect, it } from "vitest";
import {
  computeDefaultTaskReminder,
  recalculateTaskReminders,
} from "./index.js";

describe("task reminders", () => {
  it("defaults to day before due at 09:00 Tokyo", () => {
    const due = new Date("2026-08-10T15:00:00+09:00");
    const remind = computeDefaultTaskReminder(due);
    expect(remind.getDate()).toBe(9);
    expect(remind.getHours()).toBe(9);
  });

  it("excludes completed tasks from recalc", () => {
    const reminders = recalculateTaskReminders([
      {
        id: "1",
        status: "open",
        dueAt: "2026-08-10T00:00:00+09:00",
        assigneeId: "user-1",
      },
      {
        id: "2",
        status: "completed",
        dueAt: "2026-08-10T00:00:00+09:00",
        assigneeId: "user-1",
      },
    ]);
    expect(reminders).toHaveLength(1);
    expect(reminders[0]?.taskId).toBe("1");
  });
});
