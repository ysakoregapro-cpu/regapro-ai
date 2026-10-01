import { describe, expect, it, vi } from "vitest";
import { WeeklyPayDomainError } from "./weekly-pay-errors.js";
import type { WeeklyPayPorts } from "./weekly-pay-ports.js";
import {
  approveWeeklyApplication,
  createOrReplaceWeeklyApplicationDraft,
  returnWeeklyApplication,
  type WeeklyPayActor,
} from "./weekly-pay-service.js";
import type { WeeklyApplication } from "./weekly-pay-types.js";

function app(partial: Partial<WeeklyApplication> = {}): WeeklyApplication {
  return {
    id: "app-1",
    orgId: "org-1",
    staffId: "staff-worker",
    weekStart: "2026-08-03",
    weekEnd: "2026-08-09",
    cutoffAt: "2026-08-10T00:00:00+09:00",
    paymentDate: "2026-08-14",
    status: "submitted",
    totalAmountYen: 6500,
    policyId: "pol-1",
    policyVersion: 1,
    policySnapshot: {
      policyId: "pol-1",
      version: 1,
      advanceRateBps: 7000,
      dailyCapMinutes: 480,
      dailyCapScope: "per_calendar_day",
      roundingUnitYen: 500,
      includeTransportFee: false,
      weekStartIsoDow: 1,
      paymentOffsetDays: 11,
    },
    submittedAt: "2026-08-08T12:00:00+09:00",
    submittedByStaffId: "staff-worker",
    returnedAt: null,
    returnedByStaffId: null,
    returnReason: null,
    approvedAt: null,
    approvedByStaffId: null,
    createdByStaffId: "staff-worker",
    createdAt: "2026-08-08T12:00:00+09:00",
    updatedAt: "2026-08-08T12:00:00+09:00",
    ...partial,
  };
}

function actor(
  staffId: string,
  permissions: WeeklyPayActor["permissions"],
): WeeklyPayActor {
  return { staffId, orgId: "org-1", permissions };
}

function emptyBankPorts(): WeeklyPayPorts["bank"] {
  return {
    listMasked: vi.fn(),
    upsert: vi.fn(),
    deactivate: vi.fn(),
    getWorkerSettings: vi.fn(),
    upsertWorkerSettings: vi.fn(),
    decryptApplicationAccountNumber: vi.fn(),
  };
}

function portsWith(
  applications: Partial<WeeklyPayPorts["applications"]>,
): WeeklyPayPorts {
  return {
    applications: {
      list: vi.fn(),
      getById: vi.fn(),
      createOrReplaceDraft: vi.fn(),
      submit: vi.fn(),
      returnApplication: vi.fn(),
      approve: vi.fn(),
      getBankSnapshot: vi.fn(),
      ...applications,
    },
    policies: { listActive: vi.fn(), upsert: vi.fn() },
    bank: emptyBankPorts(),
  };
}

describe("weekly pay service permissions", () => {
  it("blocks self-approval in the application layer", async () => {
    const ports = portsWith({
      getById: vi.fn(async () => app({ staffId: "staff-reviewer" })),
    });
    await expect(
      approveWeeklyApplication(ports, actor("staff-reviewer", ["weekly_pay.review"]), "app-1"),
    ).rejects.toBeInstanceOf(WeeklyPayDomainError);
  });

  it("allows reviewer to approve another staff application", async () => {
    const approve = vi.fn(async () => app({ status: "approved" }));
    const ports = portsWith({
      getById: vi.fn(async () => app()),
      approve,
    });
    await approveWeeklyApplication(ports, actor("staff-reviewer", ["weekly_pay.review"]), "app-1");
    expect(approve).toHaveBeenCalled();
  });

  it("blocks worker creating draft for another staff without manage", async () => {
    const ports = portsWith({});
    await expect(
      createOrReplaceWeeklyApplicationDraft(
        ports,
        actor("staff-worker", ["weekly_pay.submit"]),
        { workRecordIds: ["wr-1"], staffId: "staff-other" },
      ),
    ).rejects.toThrow(/another staff/);
  });

  it("requires return reason", async () => {
    const ports = portsWith({
      getById: vi.fn(async () => app()),
    });
    await expect(
      returnWeeklyApplication(ports, actor("staff-reviewer", ["weekly_pay.review"]), "app-1", "x"),
    ).rejects.toThrow(/too short/);
  });
});
