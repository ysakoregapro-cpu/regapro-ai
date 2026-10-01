import { SalesDomainError } from "./sales-errors.js";

export function assertSalesReason(reason: string): string {
  const trimmed = reason.trim();
  if (trimmed.length < 3) {
    throw new SalesDomainError("INVALID_REASON", "reason too short");
  }
  if (trimmed.length > 2000) {
    throw new SalesDomainError("INVALID_REASON", "reason too long");
  }
  return trimmed;
}

export function assertAllocationSnapshot(
  totalAmountYen: number,
  allocations: Array<{ shareRateBps: number; amountYen: number }>,
): void {
  if (!Number.isInteger(totalAmountYen) || totalAmountYen <= 0) {
    throw new SalesDomainError("INVALID_ALLOCATION", "total amount invalid");
  }
  if (!allocations.length) {
    throw new SalesDomainError("INVALID_ALLOCATION", "at least one allocation required");
  }
  let sum = 0;
  for (const row of allocations) {
    if (!Number.isInteger(row.amountYen) || row.amountYen < 0) {
      throw new SalesDomainError("INVALID_ALLOCATION", "allocation amount invalid");
    }
    if (row.shareRateBps < 0 || row.shareRateBps > 10000) {
      throw new SalesDomainError("INVALID_ALLOCATION", "share rate bps invalid");
    }
    sum += row.amountYen;
  }
  if (sum !== totalAmountYen) {
    throw new SalesDomainError("INVALID_ALLOCATION", "allocation amounts must sum to total");
  }
}
