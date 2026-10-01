import type {
  CorrectPersonalSalesCaseInput,
  CreatePersonalSalesCaseInput,
  PersonalSalesAllocationRuleVersion,
  PersonalSalesCase,
  PersonalSalesCaseListQuery,
  UpsertAllocationRuleDraftInput,
} from "./sales-types.js";

export type SalesPorts = {
  cases: {
    list(orgId: string, query: PersonalSalesCaseListQuery): Promise<PersonalSalesCase[]>;
    getById(orgId: string, caseId: string): Promise<PersonalSalesCase | null>;
    create(orgId: string, input: CreatePersonalSalesCaseInput): Promise<PersonalSalesCase>;
    voidCase(orgId: string, caseId: string, reason: string): Promise<PersonalSalesCase>;
    correct(orgId: string, input: CorrectPersonalSalesCaseInput): Promise<PersonalSalesCase>;
  };
  rules: {
    list(orgId: string): Promise<PersonalSalesAllocationRuleVersion[]>;
    upsertDraft(
      orgId: string,
      input: UpsertAllocationRuleDraftInput,
    ): Promise<PersonalSalesAllocationRuleVersion>;
    approve(orgId: string, ruleVersionId: string): Promise<PersonalSalesAllocationRuleVersion>;
    revoke(orgId: string, ruleVersionId: string, reason: string): Promise<PersonalSalesAllocationRuleVersion>;
  };
};
