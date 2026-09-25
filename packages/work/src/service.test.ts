import { describe, expect, it } from "vitest";
import { ShiftDomainError } from "./errors.js";
import type { ShiftPorts } from "./ports.js";
import {
  cancelShift,
  createDraftShift,
  createShiftRequestDraft,
  listShiftRequests,
  listShifts,
  publishShift,
  submitShiftRequest,
  type ShiftActor,
} from "./service.js";
import type { Shift, ShiftRequest } from "./types.js";

function actor(
  permissions: ShiftActor["permissions"],
  staffId = "staff-1",
): ShiftActor {
  return { staffId, orgId: "org-1", permissions };
}

function makePorts(overrides: Partial<ShiftPorts> = {}): ShiftPorts {
  const stored: { shifts: Shift[]; requests: ShiftRequest[] } = {
    shifts: [],
    requests: [],
  };
  return {
    locations: { listActive: async () => [] },
    requests: {
      getById: async (_org, id) => stored.requests.find((r) => r.id === id) ?? null,
      list: async (_org, query) =>
        stored.requests.filter((r) => !query.staffId || r.staffId === query.staffId),
      createOrReplaceDraft: async (_org, actorStaffId, input) => {
        const row: ShiftRequest = {
          id: "req-new",
          orgId: "org-1",
          staffId: input.forStaffId ?? actorStaffId,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          version: 1,
          previousRequestId: null,
          status: "draft",
          requestedByStaffId: actorStaffId,
          submittedAt: null,
          cancelledAt: null,
          createdAt: "2026-09-01T00:00:00.000Z",
          updatedAt: "2026-09-01T00:00:00.000Z",
          dates: [],
        };
        stored.requests.push(row);
        return row;
      },
      submit: async (_org, requestId) => {
        const found = stored.requests.find((r) => r.id === requestId);
        if (!found) throw new ShiftDomainError("NOT_FOUND", "request");
        found.status = "submitted";
        return found;
      },
      cancel: async (_org, requestId) => {
        const found = stored.requests.find((r) => r.id === requestId);
        if (!found) throw new ShiftDomainError("NOT_FOUND", "request");
        found.status = "cancelled";
        return found;
      },
    },
    shifts: {
      getById: async (_org, id) => stored.shifts.find((s) => s.id === id) ?? null,
      list: async (_org, query) =>
        stored.shifts.filter((s) => !query.staffId || s.staffId === query.staffId),
      createDraft: async (_org, input) => {
        const row: Shift = {
          id: "shift-new",
          orgId: "org-1",
          staffId: input.staffId,
          workDate: input.workDate,
          startTime: input.startTime ?? null,
          endTime: input.endTime ?? null,
          endDayOffset: input.endDayOffset ?? 0,
          workLocationId: input.workLocationId ?? null,
          source: input.source ?? "internal",
          sourceRequestDateId: input.sourceRequestDateId ?? null,
          externalRef: input.externalRef ?? null,
          status: "draft",
          note: input.note ?? null,
          preReportUrl: input.preReportUrl ?? null,
          timeUnspecified: !input.startTime && !input.endTime,
          publishedAt: null,
          publishedByStaffId: null,
          cancelledAt: null,
          cancelledByStaffId: null,
          createdAt: "2026-09-01T00:00:00.000Z",
          updatedAt: "2026-09-01T00:00:00.000Z",
        };
        stored.shifts.push(row);
        return row;
      },
      publish: async (_org, shiftId) => {
        const found = stored.shifts.find((s) => s.id === shiftId);
        if (!found) throw new ShiftDomainError("NOT_FOUND", "shift");
        found.status = "published";
        return found;
      },
      cancel: async (_org, shiftId) => {
        const found = stored.shifts.find((s) => s.id === shiftId);
        if (!found) throw new ShiftDomainError("NOT_FOUND", "shift");
        found.status = "cancelled";
        return found;
      },
    },
    ...overrides,
  };
}

describe("application authorization", () => {
  it("scopes ordinary listShifts to the actor staff id", async () => {
    const ports = makePorts();
    await listShifts(ports, actor(["shift.view_own"]), {});
    // Filtering is passed to the port; the actor without manage cannot pick another staff.
    const listed = await listShifts(
      ports,
      actor(["shift.view_own"]),
      { staffId: "staff-other" },
    );
    expect(listed).toEqual([]);
  });

  it("requires shift.request for submission", async () => {
    await expect(
      submitShiftRequest(makePorts(), actor(["shift.view_own"]), "req-1"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("requires shift.manage to publish", async () => {
    await expect(
      publishShift(makePorts(), actor(["shift.request", "shift.view_own"]), "s1"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("lets a manager create a time-unspecified draft shift", async () => {
    const created = await createDraftShift(makePorts(), actor(["shift.manage"]), {
      staffId: "22222222-2222-4222-8222-222222222222",
      workDate: "2026-10-10",
    });
    expect(created.timeUnspecified).toBe(true);
    expect(created.status).toBe("draft");
  });

  it("lets a requester create a draft covering hope_work and hope_off", async () => {
    const created = await createShiftRequestDraft(
      makePorts(),
      actor(["shift.request"]),
      {
        periodStart: "2026-10-01",
        periodEnd: "2026-10-31",
        dates: [
          { workDate: "2026-10-02", preferenceType: "hope_work" },
          { workDate: "2026-10-03", preferenceType: "hope_off" },
        ],
      },
    );
    expect(created.status).toBe("draft");
  });

  it("does not let a requester list another staff's requests", async () => {
    const ports = makePorts();
    await createShiftRequestDraft(ports, actor(["shift.request"], "staff-1"), {
      periodStart: "2026-10-01",
      periodEnd: "2026-10-31",
      dates: [],
    });
    const listed = await listShiftRequests(ports, actor(["shift.request"], "staff-1"), {
      staffId: "staff-2",
    });
    expect(listed.every((row) => row.staffId === "staff-1")).toBe(true);
  });

  it("does not let a requester cancel via manage-only path when they lack request", async () => {
    await expect(
      cancelShift(makePorts(), actor(["shift.request"]), "shift-1"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
