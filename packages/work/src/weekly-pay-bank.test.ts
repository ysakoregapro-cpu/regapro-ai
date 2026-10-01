import { describe, expect, it } from "vitest";
import { UpsertBankAccountSchema } from "./schemas.js";
import {
  canDecryptBankAccount,
  type WeeklyPayActor,
} from "./weekly-pay-service.js";
import {
  WEEKLY_PAY_BUSINESS_RPC_IDENTITIES,
  WEEKLY_PAY_INTERNAL_HELPER_IDENTITIES,
} from "./weekly-pay-rpc-acl.js";

function actor(
  permissions: WeeklyPayActor["permissions"],
): WeeklyPayActor {
  return { staffId: "s1", orgId: "o1", permissions };
}

describe("weekly pay bank schemas", () => {
  it("accepts a valid Japanese bank account payload", () => {
    const parsed = UpsertBankAccountSchema.safeParse({
      bankName: "みずほ銀行",
      bankCode: "0001",
      branchName: "丸の内支店",
      branchCode: "001",
      accountType: "ordinary",
      accountNumber: "1234567",
      accountHolderKana: "ヤマダ タロウ",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects non-digit account numbers", () => {
    const parsed = UpsertBankAccountSchema.safeParse({
      bankName: "みずほ銀行",
      bankCode: "0001",
      branchName: "丸の内支店",
      branchCode: "001",
      accountType: "ordinary",
      accountNumber: "12AB567",
      accountHolderKana: "ヤマダ タロウ",
    });
    expect(parsed.success).toBe(false);
  });
});

describe("weekly pay bank permissions", () => {
  it("allows payer and manage to decrypt, not submit/review alone", () => {
    expect(canDecryptBankAccount(actor(["weekly_pay.pay"]))).toBe(true);
    expect(canDecryptBankAccount(actor(["weekly_pay.manage"]))).toBe(true);
    expect(canDecryptBankAccount(actor(["weekly_pay.submit"]))).toBe(false);
    expect(canDecryptBankAccount(actor(["weekly_pay.review"]))).toBe(false);
  });
});

describe("weekly pay bank ACL identities", () => {
  it("lists masked bank business RPCs and keeps decrypt/legacy internals owner-only", () => {
    expect(WEEKLY_PAY_BUSINESS_RPC_IDENTITIES).toContain(
      "public.upsert_bank_account_masked(text, text, text, text, text, text, text, uuid)",
    );
    expect(WEEKLY_PAY_BUSINESS_RPC_IDENTITIES).toContain(
      "public.deactivate_bank_account_masked(uuid)",
    );
    expect(WEEKLY_PAY_BUSINESS_RPC_IDENTITIES).not.toContain(
      "public.decrypt_application_bank_account_number(uuid)",
    );
    expect(WEEKLY_PAY_INTERNAL_HELPER_IDENTITIES).toContain(
      "public.decrypt_application_bank_account_number(uuid)",
    );
    expect(WEEKLY_PAY_INTERNAL_HELPER_IDENTITIES).toContain(
      "public.upsert_bank_account(text, text, text, text, text, text, text, uuid)",
    );
    expect(WEEKLY_PAY_INTERNAL_HELPER_IDENTITIES).toContain(
      "public.regapro_weekly_pay_bank_dek()",
    );
    expect(WEEKLY_PAY_INTERNAL_HELPER_IDENTITIES).toContain(
      "public.regapro_encrypt_bank_account_number(text)",
    );
  });
});
