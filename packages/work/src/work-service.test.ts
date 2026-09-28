import { describe, expect, it } from "vitest";
import { WorkDomainError } from "./work-errors.js";
import type { WorkRecordPorts } from "./work-ports.js";
import {
  confirmWorkRecord,
  createEmploymentTerm,
  createOrUpdateWorkRecordDraft,
  listWorkRecords,
  reopenWorkRecord,
  voidWorkRecord,
  type WorkActor,
} from "./work-service.js";
import type { EmploymentTerm, WorkRecord, WorkRecordRevision } from "./work-types.js";

function actor(
  permissions: WorkActor["permissions"],
  staffId = "staff-1",
): WorkActor {
  return { staffId, orgId: "org-1", permissions };
}

function record(overrides: Partial<WorkRecord> = {}): WorkRecord {
  return {
    id: "wr-1",
    orgId: "org-1",
    staffId: "staff-1",
    workDate: "2026-09-10",
    startTime: "10:00",
    endTime: "19:00",
    endDayOffset: 0,
    breakMinutes: 60,
    workedMinutes: 480,
    transportFeeYen: 0,
    workLocationId: null,
    sourceShiftId: null,
    assignmentSource: null,
    assignmentExternalRef: null,
    status: "draft",
    employmentTermId: null,
    hourlyWageSnapshotYen: null,
    confirmedAt: null,
    confirmedByStaffId: null,
    voidedAt: null,
    voidedByStaffId: null,
    voidReason: null,
    createdByStaffId: "staff-1",
    createdAt: "2026-09-10T01:00:00.000Z",
    updatedAt: "2026-09-10T01:00:00.000Z",
    ...overrides,
  };
}

function makePorts(overrides: Partial<WorkRecordPorts> = {}): WorkRecordPorts {
  const stored: {
    records: WorkRecord[];
    terms: EmploymentTerm[];
    revisions: WorkRecordRevision[];
  } = {
    records: [record()],
    terms: [],
    revisions: [],
  };
  return {
    terms: {
      list: async (_org, query) =>
        stored.terms.filter((t) => !query.staffId || t.staffId === query.staffId),
      create: async (_org, input) => {
        const row: EmploymentTerm = {
          id: "term-new",
          orgId: "org-1",
          staffId: input.staffId,
          hourlyWageYen: input.hourlyWageYen,
          effectiveFrom: input.effectiveFrom,
          effectiveTo: input.effectiveTo ?? null,
          createdByStaffId: "mgr-1",
          createdAt: "2026-09-01T00:00:00.000Z",
          revokedAt: null,
          revokedByStaffId: null,
          revokeReason: null,
          updatedAt: null,
        };
        stored.terms.push(row);
        return row;
      },
      revoke: async (_org, termId, reason) => {
        const found = stored.terms.find((t) => t.id === termId);
        if (!found) throw new WorkDomainError("NOT_FOUND", "term");
        found.revokedAt = "2026-09-02T00:00:00.000Z";
        found.revokeReason = reason;
        return found;
      },
    },
    records: {
      getById: async (_org, id) => stored.records.find((r) => r.id === id) ?? null,
      list: async (_org, query) =>
        stored.records.filter((r) => !query.staffId || r.staffId === query.staffId),
      createOrUpdateDraft: async (_org, input) => {
        const row = record({
          id: input.workRecordId ?? "wr-new",
          staffId: input.staffId ?? "staff-1",
          workDate: input.workDate,
          startTime: input.startTime,
          endTime: input.endTime,
          endDayOffset: input.endDayOffset ?? 0,
        });
        stored.records.push(row);
        stored.revisions.push({
          id: "rev-1",
          orgId: "org-1",
          workRecordId: row.id,
          revisionNo: 1,
          eventType: "created",
          actorStaffId: "staff-1",
          beforeSnapshot: null,
          afterSnapshot: { status: row.status },
          reason: null,
          createdAt: row.createdAt,
        });
        return row;
      },
      confirm: async (_org, id) => {
        const found = stored.records.find((r) => r.id === id);
        if (!found) throw new WorkDomainError("NOT_FOUND", "record");
        found.status = "confirmed";
        return found;
      },
      reopen: async (_org, id) => {
        const found = stored.records.find((r) => r.id === id);
        if (!found) throw new WorkDomainError("NOT_FOUND", "record");
        found.status = "draft";
        return found;
      },
      void: async (_org, id) => {
        const found = stored.records.find((r) => r.id === id);
        if (!found) throw new WorkDomainError("NOT_FOUND", "record");
        found.status = "voided";
        return found;
      },
    },
    revisions: {
      listForRecord: async (_org, id) =>
        stored.revisions.filter((r) => r.workRecordId === id),
    },
    ...overrides,
  };
}

describe("work record application service", () => {
  it("lets a submitter create and confirm their own draft", async () => {
    const ports = makePorts();
    const user = actor(["work_record.view_own", "work_record.submit"]);
    const draft = await createOrUpdateWorkRecordDraft(ports, user, {
      workDate: "2026-09-01",
      startTime: "10:00",
      endTime: "18:00",
    });
    expect(draft.id).toBe("wr-new");
    const confirmed = await confirmWorkRecord(
      ports,
      user,
      "wr-1",
      new Date("2026-09-25T00:00:00+09:00"),
    );
    expect(confirmed.status).toBe("confirmed");
  });

  it("denies confirming another staff record without manage", async () => {
    const ports = makePorts();
    await expect(
      confirmWorkRecord(
        ports,
        actor(["work_record.submit"], "staff-2"),
        "wr-1",
        new Date("2026-09-25T00:00:00+09:00"),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("lets a manager confirm and reopen", async () => {
    const ports = makePorts();
    const manager = actor(["work_record.manage"]);
    const confirmed = await confirmWorkRecord(
      ports,
      manager,
      "wr-1",
      new Date("2026-09-25T00:00:00+09:00"),
    );
    expect(confirmed.status).toBe("confirmed");
    const reopened = await reopenWorkRecord(ports, manager, "wr-1", "訂正");
    expect(reopened.status).toBe("draft");
  });

  it("denies reopen to an ordinary submitter", async () => {
    await expect(
      reopenWorkRecord(
        makePorts(),
        actor(["work_record.submit"]),
        "wr-1",
        "訂正",
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("lists only own records for a non-manager", async () => {
    const ports = makePorts();
    const listed = await listWorkRecords(
      ports,
      actor(["work_record.view_own"]),
      { staffId: "staff-other" },
    );
    expect(listed.every((row) => row.staffId === "staff-1")).toBe(true);
  });

  it("denies employment term creation without manage", async () => {
    await expect(
      createEmploymentTerm(makePorts(), actor(["work_record.submit"]), {
        staffId: "staff-1",
        hourlyWageYen: 1200,
        effectiveFrom: "2026-09-01",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("voids an own draft", async () => {
    const voided = await voidWorkRecord(
      makePorts(),
      actor(["work_record.submit"]),
      "wr-1",
      "誤登録",
    );
    expect(voided.status).toBe("voided");
  });

  it("lets a manager void another staff historical record", async () => {
    const ports = makePorts();
    const manager = actor(["work_record.manage"]);
    await confirmWorkRecord(
      ports,
      manager,
      "wr-1",
      new Date("2026-09-25T00:00:00+09:00"),
    );
    const voided = await voidWorkRecord(ports, manager, "wr-1", "履歴訂正");
    expect(voided.status).toBe("voided");
  });
});
