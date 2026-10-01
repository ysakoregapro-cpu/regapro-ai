export const EXPENSE_APPLICATION_STATUSES = [
  "draft",
  "pending",
  "approved",
  "returned",
] as const;

export type ExpenseApplicationStatus = (typeof EXPENSE_APPLICATION_STATUSES)[number];

export const EXPENSE_APPLICATION_TYPES = ["advance", "after"] as const;
export type ExpenseApplicationType = (typeof EXPENSE_APPLICATION_TYPES)[number];

export type ExpenseCategory = {
  id: string;
  orgId: string;
  code: string;
  name: string;
  sortOrder: number;
  active: boolean;
  createdAt: string;
};

export type ExpenseApplicationVersion = {
  id: string;
  applicationId: string;
  versionNo: number;
  applicationType: ExpenseApplicationType;
  categoryId: string;
  amountYen: number;
  expenseDate: string;
  description: string;
  fileObjectId: string | null;
  createdByStaffId: string;
  createdAt: string;
};

export type ExpenseApplication = {
  id: string;
  orgId: string;
  staffId: string;
  status: ExpenseApplicationStatus;
  currentVersionNo: number;
  applicationType: ExpenseApplicationType;
  categoryId: string;
  amountYen: number;
  expenseDate: string;
  description: string;
  fileObjectId: string | null;
  submittedAt: string | null;
  submittedByStaffId: string | null;
  returnedAt: string | null;
  returnedByStaffId: string | null;
  returnReason: string | null;
  approvedAt: string | null;
  approvedByStaffId: string | null;
  createdByStaffId: string;
  createdAt: string;
  updatedAt: string;
};

export type ExpenseApplicationListQuery = {
  from?: string;
  to?: string;
  staffId?: string;
  status?: ExpenseApplicationStatus;
};

export type UpsertExpenseApplicationDraftInput = {
  applicationId?: string;
  staffId?: string;
  applicationType: ExpenseApplicationType;
  categoryId: string;
  amountYen: number;
  expenseDate: string;
  description: string;
};

export type AttachExpenseReceiptInput = {
  applicationId: string;
  fileObjectId: string;
};
