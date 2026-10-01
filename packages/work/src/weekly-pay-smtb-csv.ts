/**
 * ドコモSMTBネット銀行 総合振込 CSV（振込ファイル）encoder.
 * Spec: https://www.netbk.co.jp/contents/resources/pdf/doc_soufuri_furikomicsv.pdf
 * Not the bank's "金額取込CSV". Character set: Shift_JIS. Separators: comma.
 */

import iconv from "iconv-lite";
import { toSmtbTransferMmdd } from "./weekly-pay-business-day.js";
import { WeeklyPayDomainError } from "./weekly-pay-errors.js";

export const SMTB_SOGO_FORMAT_CODE = "docomo_smtb_sogo_csv_v1" as const;

export type SmtbTransferorSnapshot = {
  consignorCode: string;
  requesterNameKana: string;
  sourceBankCode: string;
  sourceBankNameKana?: string | null;
  sourceBranchCode: string;
  sourceBranchNameKana?: string | null;
  sourceAccountType: "ordinary" | "current";
  sourceAccountNumber: string;
};

export type SmtbCsvDestination = {
  bankCode: string;
  bankName?: string | null;
  branchCode: string;
  branchName?: string | null;
  accountType: "ordinary" | "current";
  accountNumber: string;
  accountHolderKana: string;
  amountYen: number;
};

export type SmtbCsvBuildInput = {
  bankTransferDate: string;
  transferor: SmtbTransferorSnapshot;
  destinations: SmtbCsvDestination[];
  /** When set, must match destinations length and sum(amountYen). */
  expectedItemCount?: number;
  expectedTotalAmountYen?: number;
};

const HALF_KANA_ASCII =
  /^[\u0020-\u007E\uFF61-\uFF9F]+$/;

function assertHalfWidthEncodable(value: string, field: string): void {
  if (!HALF_KANA_ASCII.test(value)) {
    throw new WeeklyPayDomainError(
      "INVALID_BANK",
      `${field} contains characters that cannot be encoded as half-width for SMTB CSV`,
    );
  }
  // Fail loud if iconv would substitute
  const buf = iconv.encode(value, "Shift_JIS");
  const round = iconv.decode(buf, "Shift_JIS");
  if (round !== value) {
    throw new WeeklyPayDomainError(
      "INVALID_BANK",
      `${field} is not representable in Shift_JIS without substitution`,
    );
  }
}

function accountTypeCode(t: "ordinary" | "current"): string {
  return t === "ordinary" ? "1" : "2";
}

function stripLeadingZerosOptionalDigits(value: string): string {
  // Bank allows omitting leading zeros; keep digits as provided if within length.
  return value.replace(/^0+(?=\d)/, "") || "0";
}

export function buildSmtbSogoCsvRows(input: SmtbCsvBuildInput): string[] {
  const { transferor, destinations, bankTransferDate } = input;
  if (!destinations.length) {
    throw new WeeklyPayDomainError("INVALID_SELECTION", "no destinations for CSV");
  }

  if (!/^20\d{8}$/.test(transferor.consignorCode)) {
    throw new WeeklyPayDomainError("INVALID_TRANSFEROR", "consignorCode must be 20 + 8 digits");
  }
  if (!/^\d{4}$/.test(transferor.sourceBankCode)) {
    throw new WeeklyPayDomainError("INVALID_TRANSFEROR", "sourceBankCode must be 4 digits");
  }
  if (!/^\d{3}$/.test(transferor.sourceBranchCode)) {
    throw new WeeklyPayDomainError("INVALID_TRANSFEROR", "sourceBranchCode must be 3 digits");
  }
  if (!/^\d{7}$/.test(transferor.sourceAccountNumber)) {
    throw new WeeklyPayDomainError("INVALID_TRANSFEROR", "sourceAccountNumber must be 7 digits");
  }
  if (transferor.requesterNameKana.length < 1 || transferor.requesterNameKana.length > 40) {
    throw new WeeklyPayDomainError("INVALID_TRANSFEROR", "requesterNameKana length invalid");
  }
  assertHalfWidthEncodable(transferor.requesterNameKana, "requesterNameKana");
  if (transferor.sourceBankNameKana) {
    assertHalfWidthEncodable(transferor.sourceBankNameKana, "sourceBankNameKana");
  }
  if (transferor.sourceBranchNameKana) {
    assertHalfWidthEncodable(transferor.sourceBranchNameKana, "sourceBranchNameKana");
  }

  let total = 0;
  for (const d of destinations) {
    if (!/^\d{1,4}$/.test(d.bankCode)) {
      throw new WeeklyPayDomainError("INVALID_BANK", "bankCode must be 1-4 digits");
    }
    if (!/^\d{1,3}$/.test(d.branchCode)) {
      throw new WeeklyPayDomainError("INVALID_BANK", "branchCode must be 1-3 digits");
    }
    if (!/^\d{1,7}$/.test(d.accountNumber)) {
      throw new WeeklyPayDomainError(
        "INVALID_BANK",
        "accountNumber must be 1-7 digits for SMTB CSV",
      );
    }
    if (d.accountHolderKana.length < 1 || d.accountHolderKana.length > 30) {
      throw new WeeklyPayDomainError("INVALID_BANK", "accountHolderKana length invalid");
    }
    assertHalfWidthEncodable(d.accountHolderKana, "accountHolderKana");
    if (d.bankName) assertHalfWidthEncodable(d.bankName, "bankName");
    if (d.branchName) assertHalfWidthEncodable(d.branchName, "branchName");
    if (!Number.isInteger(d.amountYen) || d.amountYen <= 0 || d.amountYen > 9_999_999_999) {
      throw new WeeklyPayDomainError("INVALID_SELECTION", "amountYen out of range");
    }
    total += d.amountYen;
  }

  if (
    input.expectedItemCount != null &&
    input.expectedItemCount !== destinations.length
  ) {
    throw new WeeklyPayDomainError("TOTAL_MISMATCH", "item count mismatch vs sealed batch");
  }
  if (
    input.expectedTotalAmountYen != null &&
    input.expectedTotalAmountYen !== total
  ) {
    throw new WeeklyPayDomainError("TOTAL_MISMATCH", "total amount mismatch vs sealed batch");
  }

  const mmdd = toSmtbTransferMmdd(bankTransferDate);
  const header = [
    "1",
    "21",
    "0",
    transferor.consignorCode,
    transferor.requesterNameKana,
    mmdd,
    stripLeadingZerosOptionalDigits(transferor.sourceBankCode),
    transferor.sourceBankNameKana ?? "",
    stripLeadingZerosOptionalDigits(transferor.sourceBranchCode),
    transferor.sourceBranchNameKana ?? "",
    accountTypeCode(transferor.sourceAccountType),
    stripLeadingZerosOptionalDigits(transferor.sourceAccountNumber),
    "",
  ];

  const dataRows = destinations.map((d) => [
    "2",
    stripLeadingZerosOptionalDigits(d.bankCode),
    d.bankName ?? "",
    stripLeadingZerosOptionalDigits(d.branchCode),
    d.branchName ?? "",
    "",
    accountTypeCode(d.accountType),
    stripLeadingZerosOptionalDigits(d.accountNumber),
    d.accountHolderKana,
    String(d.amountYen),
    "0",
    "",
    "",
    "",
    "",
    "",
  ]);

  const trailer = ["8", String(destinations.length), String(total), ""];
  const end = ["9", ""];

  return [
    header.join(","),
    ...dataRows.map((r) => r.join(",")),
    trailer.join(","),
    end.join(","),
  ];
}

export function encodeSmtbSogoCsvShiftJis(rows: string[]): Buffer {
  const text = `${rows.join("\r\n")}\r\n`;
  return iconv.encode(text, "Shift_JIS");
}

export function buildSmtbSogoCsvBuffer(input: SmtbCsvBuildInput): {
  rows: string[];
  buffer: Buffer;
  itemCount: number;
  totalAmountYen: number;
} {
  const rows = buildSmtbSogoCsvRows(input);
  const totalAmountYen = input.destinations.reduce((s, d) => s + d.amountYen, 0);
  return {
    rows,
    buffer: encodeSmtbSogoCsvShiftJis(rows),
    itemCount: input.destinations.length,
    totalAmountYen,
  };
}

const ZEN_TO_HAN: Record<string, string> = {
  "。": "｡", "「": "｢", "」": "｣", "、": "､", "・": "･",
  ヲ: "ｦ", ァ: "ｧ", ィ: "ｨ", ゥ: "ｩ", ェ: "ｪ", ォ: "ｫ",
  ャ: "ｬ", ュ: "ｭ", ョ: "ｮ", ッ: "ｯ", ー: "ｰ",
  ア: "ｱ", イ: "ｲ", ウ: "ｳ", エ: "ｴ", オ: "ｵ",
  カ: "ｶ", キ: "ｷ", ク: "ｸ", ケ: "ｹ", コ: "ｺ",
  サ: "ｻ", シ: "ｼ", ス: "ｽ", セ: "ｾ", ソ: "ｿ",
  タ: "ﾀ", チ: "ﾁ", ツ: "ﾂ", テ: "ﾃ", ト: "ﾄ",
  ナ: "ﾅ", ニ: "ﾆ", ヌ: "ﾇ", ネ: "ﾈ", ノ: "ﾉ",
  ハ: "ﾊ", ヒ: "ﾋ", フ: "ﾌ", ヘ: "ﾍ", ホ: "ﾎ",
  マ: "ﾏ", ミ: "ﾐ", ム: "ﾑ", メ: "ﾒ", モ: "ﾓ",
  ヤ: "ﾔ", ユ: "ﾕ", ヨ: "ﾖ",
  ラ: "ﾗ", リ: "ﾘ", ル: "ﾙ", レ: "ﾚ", ロ: "ﾛ",
  ワ: "ﾜ", ン: "ﾝ",
  ガ: "ｶﾞ", ギ: "ｷﾞ", グ: "ｸﾞ", ゲ: "ｹﾞ", ゴ: "ｺﾞ",
  ザ: "ｻﾞ", ジ: "ｼﾞ", ズ: "ｽﾞ", ゼ: "ｾﾞ", ゾ: "ｿﾞ",
  ダ: "ﾀﾞ", ヂ: "ﾁﾞ", ヅ: "ﾂﾞ", デ: "ﾃﾞ", ド: "ﾄﾞ",
  バ: "ﾊﾞ", ビ: "ﾋﾞ", ブ: "ﾌﾞ", ベ: "ﾍﾞ", ボ: "ﾎﾞ",
  パ: "ﾊﾟ", ピ: "ﾋﾟ", プ: "ﾌﾟ", ペ: "ﾍﾟ", ポ: "ﾎﾟ",
  ヴ: "ｳﾞ",
};

/** Convert full-width katakana / spaces commonly stored in DB to half-width for SMTB. */
export function toHalfWidthKatakanaForSmtb(input: string): string {
  let out = "";
  for (const ch of input) {
    if (ch === "　" || ch === " ") {
      out += " ";
      continue;
    }
    const mapped = ZEN_TO_HAN[ch];
    if (mapped != null) {
      out += mapped;
      continue;
    }
    const code = ch.codePointAt(0)!;
    if (code >= 0xff01 && code <= 0xff5e) {
      out += String.fromCodePoint(code - 0xfee0);
      continue;
    }
    if (
      (code >= 0x20 && code <= 0x7e) ||
      (code >= 0xff61 && code <= 0xff9f)
    ) {
      out += ch;
      continue;
    }
    throw new WeeklyPayDomainError(
      "INVALID_BANK",
      "name contains characters that cannot be converted to half-width kana/ASCII",
    );
  }
  return out;
}
