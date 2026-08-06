import { addDaysTokyo, setTimeTokyo, startOfDayTokyo, toTokyoDate } from "./dates.js";

export interface ParsedRelativeDate {
  date: Date;
  confidence: number;
  matched: string;
}

const WEEKDAY_MAP: Record<string, number> = {
  日: 0,
  月: 1,
  火: 2,
  水: 3,
  木: 4,
  金: 5,
  土: 6,
};

function nextWeekday(from: Date, targetDay: number): Date {
  const current = from.getDay();
  let delta = (targetDay - current + 7) % 7;
  if (delta === 0) delta = 7;
  return addDaysTokyo(from, delta);
}

function parseTime(text: string, base: Date): Date | null {
  const hm = text.match(/(\d{1,2})\s*[時:：]\s*(\d{0,2})/);
  if (!hm) return null;
  const hour = Number(hm[1]);
  const minute = hm[2] ? Number(hm[2]) : 0;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return setTimeTokyo(base, hour, minute);
}

export function parseJapaneseRelativeDate(
  input: string,
  reference: Date = new Date(),
): ParsedRelativeDate | null {
  const text = input.trim();
  const now = toTokyoDate(reference);
  const today = startOfDayTokyo(now);

  if (/^今日|本日/.test(text)) {
    const withTime = parseTime(text, today) ?? today;
    return { date: withTime, confidence: 0.95, matched: "今日" };
  }

  if (/^明日/.test(text)) {
    const base = addDaysTokyo(today, 1);
    const withTime = parseTime(text, base) ?? base;
    return { date: withTime, confidence: 0.95, matched: "明日" };
  }

  if (/^明後日/.test(text)) {
    const base = addDaysTokyo(today, 2);
    const withTime = parseTime(text, base) ?? base;
    return { date: withTime, confidence: 0.9, matched: "明後日" };
  }

  const weekdayOnly = text.match(/^([月火水木金土日])曜/);
  if (weekdayOnly) {
    const day = WEEKDAY_MAP[weekdayOnly[1]!];
    if (day === undefined) return null;
    const base = nextWeekday(today, day);
    const withTime = parseTime(text, base) ?? setTimeTokyo(base, 17);
    return { date: withTime, confidence: 0.85, matched: weekdayOnly[0] };
  }

  const nextWeek = text.match(/^来週([月火水木金土日])曜/);
  if (nextWeek) {
    const day = WEEKDAY_MAP[nextWeek[1]!];
    if (day === undefined) return null;
    const nextMonday = addDaysTokyo(today, ((8 - today.getDay()) % 7) || 7);
    const delta = (day - 1 + 7) % 7;
    const base = addDaysTokyo(nextMonday, delta);
    const withTime = parseTime(text, base) ?? setTimeTokyo(base, 9);
    return { date: withTime, confidence: 0.8, matched: nextWeek[0] };
  }

  const timeOnly = parseTime(text, today);
  if (timeOnly) {
    return { date: timeOnly, confidence: 0.7, matched: "time" };
  }

  return null;
}

export function parseJapaneseRelativeDatesInText(
  input: string,
  reference?: Date,
): ParsedRelativeDate[] {
  const patterns = [
    /来週[月火水木金土日]曜(?:\d{1,2}[時:：]\d{0,2})?/g,
    /[月火水木金土日]曜(?:\d{1,2}[時:：]\d{0,2})?/g,
    /明後日(?:\d{1,2}[時:：]\d{0,2})?/g,
    /明日(?:\d{1,2}[時:：]\d{0,2})?/g,
    /今日|本日(?:\d{1,2}[時:：]\d{0,2})?/g,
  ];

  const results: ParsedRelativeDate[] = [];
  for (const pattern of patterns) {
    for (const match of input.matchAll(pattern)) {
      const parsed = parseJapaneseRelativeDate(match[0], reference);
      if (parsed) results.push(parsed);
    }
  }
  return results;
}
