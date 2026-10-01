import { describe, expect, it } from "vitest";
import iconv from "iconv-lite";
import { isJapaneseBankBusinessDay } from "./weekly-pay-business-day.js";
import {
  buildSmtbSogoCsvBuffer,
  buildSmtbSogoCsvRows,
  toHalfWidthKatakanaForSmtb,
} from "./weekly-pay-smtb-csv.js";

const transferor = {
  consignorCode: "2012345678",
  requesterNameKana: toHalfWidthKatakanaForSmtb("スミエスショウジ(カ"),
  sourceBankCode: "0038",
  sourceBankNameKana: "",
  sourceBranchCode: "106",
  sourceBranchNameKana: "",
  sourceAccountType: "ordinary" as const,
  sourceAccountNumber: "1234567",
};

describe("SMTB sogo CSV", () => {
  it("matches PDF example record order, counts, and Shift_JIS bytes", () => {
    const destinations = [
      {
        bankCode: "0038",
        branchCode: "101",
        accountType: "ordinary" as const,
        accountNumber: "1234567",
        accountHolderKana: toHalfWidthKatakanaForSmtb("スミシン　タロウ"),
        amountYen: 1_000_000,
      },
      {
        bankCode: "0038",
        branchCode: "102",
        accountType: "ordinary" as const,
        accountNumber: "1234567",
        accountHolderKana: toHalfWidthKatakanaForSmtb("スミシン　タロウ"),
        amountYen: 100_000,
      },
      {
        bankCode: "0038",
        branchCode: "103",
        accountType: "ordinary" as const,
        accountNumber: "1234567",
        accountHolderKana: toHalfWidthKatakanaForSmtb("スミシン　タロウ"),
        amountYen: 10_000,
      },
    ];
    const { rows, buffer, itemCount, totalAmountYen } = buildSmtbSogoCsvBuffer({
      bankTransferDate: "2025-12-25",
      transferor,
      destinations,
      expectedItemCount: 3,
      expectedTotalAmountYen: 1_110_000,
    });
    expect(itemCount).toBe(3);
    expect(totalAmountYen).toBe(1_110_000);
    expect(rows[0]!.startsWith("1,21,0,2012345678,")).toBe(true);
    expect(rows[0]!).toContain(",1225,38,");
    expect(rows[1]!.startsWith("2,38,")).toBe(true);
    expect(rows[4]).toBe("8,3,1110000,");
    expect(rows[5]).toBe("9,");
    const again = buildSmtbSogoCsvRows({
      bankTransferDate: "2025-12-25",
      transferor,
      destinations,
    });
    expect(again).toEqual(rows);
    expect(buffer[0]).not.toBe(0xef); // not UTF-8 BOM
    const decoded = iconv.decode(buffer, "Shift_JIS");
    expect(decoded.split("\r\n")[0]).toContain("2012345678");
  });

  it("rejects unconvertible kana without silent substitution", () => {
    expect(() => toHalfWidthKatakanaForSmtb("山田太郎")).toThrow(/half-width/);
  });

  it("rejects weekends and published bank holidays including Friday holiday weeks", () => {
    expect(isJapaneseBankBusinessDay("2025-05-02")).toBe(true); // Fri before Golden Week
    expect(isJapaneseBankBusinessDay("2025-05-03")).toBe(false); // Sat + 憲法記念日
    expect(isJapaneseBankBusinessDay("2025-05-06")).toBe(false); // Tue 振替
    expect(isJapaneseBankBusinessDay("2026-02-11")).toBe(false); // Wed holiday
    expect(isJapaneseBankBusinessDay("2025-11-22")).toBe(false); // Sat
    expect(isJapaneseBankBusinessDay("2025-11-24")).toBe(false); // Mon 振替 after Sunday holiday
    // Week containing Friday 2024-style GW: ensure Fri holiday would block if listed
    expect(isJapaneseBankBusinessDay("2025-01-03")).toBe(true);
  });
});
