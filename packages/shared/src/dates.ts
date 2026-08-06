export const TOKYO_TZ = "Asia/Tokyo";

export function toTokyoDate(date: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TOKYO_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "0";

  return new Date(
    `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}`,
  );
}

export function formatTokyoIso(date: Date): string {
  const tokyo = toTokyoDate(date);
  const offset = "+09:00";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${tokyo.getFullYear()}-${pad(tokyo.getMonth() + 1)}-${pad(tokyo.getDate())}T${pad(tokyo.getHours())}:${pad(tokyo.getMinutes())}:${pad(tokyo.getSeconds())}${offset}`;
}

export function startOfDayTokyo(date: Date = new Date()): Date {
  const tokyo = toTokyoDate(date);
  tokyo.setHours(0, 0, 0, 0);
  return tokyo;
}

export function addDaysTokyo(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

export function setTimeTokyo(date: Date, hour: number, minute = 0): Date {
  const copy = new Date(date);
  copy.setHours(hour, minute, 0, 0);
  return copy;
}

export function daysUntilTokyo(from: Date, to: Date): number {
  const start = startOfDayTokyo(from).getTime();
  const end = startOfDayTokyo(to).getTime();
  return Math.round((end - start) / (24 * 60 * 60 * 1000));
}
