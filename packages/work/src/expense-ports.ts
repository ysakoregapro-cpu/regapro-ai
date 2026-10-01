import type {
  AttachExpenseReceiptInput,
  ExpenseApplication,
  ExpenseApplicationListQuery,
  ExpenseCategory,
  UpsertExpenseApplicationDraftInput,
} from "./expense-types.js";

export type ExpensePorts = {
  categories: {
    list(orgId: string): Promise<ExpenseCategory[]>;
  };
  applications: {
    list(orgId: string, query: ExpenseApplicationListQuery): Promise<ExpenseApplication[]>;
    getById(orgId: string, applicationId: string): Promise<ExpenseApplication | null>;
    upsertDraft(
      orgId: string,
      input: UpsertExpenseApplicationDraftInput,
    ): Promise<ExpenseApplication>;
    submit(orgId: string, applicationId: string): Promise<ExpenseApplication>;
    return(orgId: string, applicationId: string, reason: string): Promise<ExpenseApplication>;
    approve(orgId: string, applicationId: string): Promise<ExpenseApplication>;
    attachReceipt(orgId: string, input: AttachExpenseReceiptInput): Promise<ExpenseApplication>;
  };
};
