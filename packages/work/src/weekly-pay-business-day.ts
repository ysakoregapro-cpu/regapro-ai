/**
 * Japanese bank business-day helpers for SMTB transfer designation dates.
 * Does not auto-shift application payment_date — only validates bank transfer dates.
 */

const FIXED_HOLIDAYS = new Set<string>([
  "2025-01-01", "2025-01-13", "2025-02-11", "2025-02-23", "2025-02-24",
  "2025-03-20", "2025-04-29", "2025-05-03", "2025-05-04", "2025-05-05",
  "2025-05-06", "2025-07-21", "2025-08-11", "2025-09-15", "2025-09-23",
  "2025-10-13", "2025-11-03", "2025-11-23", "2025-11-24",
  "2026-01-01", "2026-01-12", "2026-02-11", "2026-02-23", "2026-03-20",
  "2026-04-29", "2026-05-03", "2026-05-04", "2026-05-05", "2026-05-06",
  "2026-07-20", "2026-08-11", "2026-09-21", "2026-09-22", "2026-09-23",
  "2026-10-12", "2026-11-03", "2026-11-23",
  "2027-01-01", "2027-01-11", "2027-02-11", "2027-02-23", "2027-03-21",
  "2027-03-22", "2027-04-29", "2027-05-03", "2027-05-04", "2027-05-05",
  "2027-07-19", "2027-08-11", "2027-09-20", "2027-09-23", "2027-10-11",
  "2027-11-03", "2027-11-23",
]);

/** ISO weekday: 1=Mon … 7=Sun for YYYY-MM-DD (UTC civil date). */
function isoDow(isoDate: string): number {
  const parts = isoDate.split("-").map(Number);
  const y = parts[0] ?? 0;
  const m = parts[1] ?? 1;
  const d = parts[2] ?? 1;
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return js === 0 ? 7 : js;
}

export function isJapaneseBankBusinessDay(isoDate: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return false;
  const dow = isoDow(isoDate);
  if (dow === 6 || dow === 7) return false;
  if (FIXED_HOLIDAYS.has(isoDate)) return false;
  return true;
}

/** MMDD for SMTB header 取組日 (leading zeros optional in bank; we emit zero-padded). */
export function toSmtbTransferMmdd(isoDate: string): string {
  const [, m, d] = isoDate.split("-");
  return `${m}${d}`;
}
