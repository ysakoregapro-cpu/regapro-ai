import { describe, expect, it, vi } from "vitest";
import { ExpenseDomainError } from "./expense-errors.js";
import type { ExpensePorts } from "./expense-ports.js";
import {
  approveExpenseApplication,
  returnExpenseApplication,
  type ExpenseActor,
} from "./expense-service.js";
import type { ExpenseApplication } from "./expense-types.js";

function app(partial: Partial<ExpenseApplication> = {}): ExpenseApplication {
  return {
    id: "exp-1",
    orgId: "org-1",
    staffId: "staff-worker",
    status: "pending",
    currentVersionNo: 1,
    applicationType: "after",
    categoryId: "cat-1",
    amountYen: 1200,
    expenseDate: "2026-09-01",
    description: "交通費",
    fileObjectId: null,
    submittedAt: "2026-09-02T00:00:00Z",
    submittedByStaffId: "staff-worker",
    returnedAt: null,
    returnedByStaffId: null,
    returnReason: null,
    approvedAt: null,
    approvedByStaffId: null,
    createdByStaffId: "staff-worker",
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-02T00:00:00Z",
    ...partial,
  };
}

function actor(staffId: string, permissions: ExpenseActor["permissions"]): ExpenseActor {
  return { staffId, orgId: "org-1", permissions };
}

function ports(overrides: Partial<ExpensePorts["applications"]> = {}): ExpensePorts {
  return {
    categories: { list: vi.fn() },
    applications: {
      list: vi.fn(),
      getById: vi.fn().mockResolvedValue(app()),
      upsertDraft: vi.fn(),
      submit: vi.fn(),
      return: vi.fn().mockResolvedValue(app({ status: "returned" })),
      approve: vi.fn().mockResolvedValue(app({ status: "approved" })),
      attachReceipt: vi.fn(),
      ...overrides,
    },
  };
}

describe("expense review permissions", () => {
  it("blocks self-approval", async () => {
    await expect(
      approveExpenseApplication(ports(), actor("staff-worker", ["expense.manage"]), "exp-1"),
    ).rejects.toBeInstanceOf(ExpenseDomainError);
  });

  it("allows manager to return someone else's pending application", async () => {
    const result = await returnExpenseApplication(
      ports(),
      actor("staff-manager", ["expense.manage"]),
      "exp-1",
      "領収書不足",
    );
    expect(result.status).toBe("returned");
  });
});
