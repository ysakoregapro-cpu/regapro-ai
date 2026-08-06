export type TaskDraft = {
  title: string;
  assigneeHint: string | null;
  dueHint: string | null;
  projectHint: string | null;
  priority: "low" | "normal" | "high" | "urgent";
  notifyDayBefore: boolean;
  description: string;
  confidence: number;
  raw: string;
};

const ASSIGNEE_HINTS: { pattern: RegExp; name: string }[] = [
  { pattern: /森藤/, name: "森藤 美穂" },
  { pattern: /田中/, name: "田中 健太" },
  { pattern: /佐藤/, name: "佐藤 悠" },
];

const PROJECT_HINTS: { pattern: RegExp; name: string }[] = [
  { pattern: /求人|職業紹介|求職/, name: "有料職業紹介" },
  { pattern: /イベント|展示/, name: "通信イベント運営" },
  { pattern: /採用|人事/, name: "採用・人事" },
  { pattern: /DX|実装|画面/, name: "DX開発" },
  { pattern: /物件|不動産/, name: "不動産事業" },
];

export function interpretTaskUtterance(input: string, now = new Date()): TaskDraft {
  const raw = input.trim();
  let confidence = 0.55;
  let title = raw.replace(/^(これ|それ)(を)?/, "").trim() || raw;
  let assigneeHint: string | null = null;
  let dueHint: string | null = null;
  let projectHint: string | null = null;
  let priority: TaskDraft["priority"] = "normal";
  const notifyDayBefore = /前日|通知/.test(raw);
  let description = "";

  for (const a of ASSIGNEE_HINTS) {
    if (a.pattern.test(raw)) {
      assigneeHint = a.name;
      confidence += 0.12;
      break;
    }
  }

  for (const p of PROJECT_HINTS) {
    if (p.pattern.test(raw)) {
      projectHint = p.name;
      confidence += 0.08;
      break;
    }
  }

  if (/明日/.test(raw)) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    dueHint = formatDate(d) + " 17:00";
    confidence += 0.15;
  } else if (/金曜/.test(raw) || /金曜日/.test(raw)) {
    dueHint = nextWeekdayLabel(now, 5) + (/17時/.test(raw) ? " 17:00" : " 終日");
    confidence += 0.15;
  } else if (/来週月曜|来週の月曜/.test(raw)) {
    dueHint = nextMondayAfterThisWeek(now) + " 17:00";
    confidence += 0.15;
  } else if (/今週/.test(raw)) {
    dueHint = "今週中";
    confidence += 0.08;
  }

  if (/至急|すぐ|代表確認/.test(raw)) {
    priority = "urgent";
    confidence += 0.08;
  } else if (/優先/.test(raw)) {
    priority = "high";
    confidence += 0.05;
  }

  if (/確認/.test(raw)) {
    description = "確認結果を共有する";
  }
  if (/終わった|完了/.test(raw)) {
    title = title.replace(/終わった|完了/, "").trim() || "タスクを完了";
    description = "完了として更新";
    confidence += 0.1;
  }

  // Clean title: remove relative date phrases lightly
  title = title
    .replace(/明日までに?/, "")
    .replace(/金曜(日)?(の)?\d*時?までに?/, "")
    .replace(/担当を.+に変えて/, "")
    .replace(/へ/, "へ ")
    .replace(/\s+/g, " ")
    .trim();

  return {
    title: title || raw,
    assigneeHint,
    dueHint,
    projectHint,
    priority,
    notifyDayBefore: notifyDayBefore || Boolean(dueHint),
    description,
    confidence: Math.min(0.98, confidence),
    raw,
  };
}

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function nextWeekdayLabel(now: Date, weekday: number): string {
  const d = new Date(now);
  const day = d.getDay();
  let diff = weekday - day;
  if (diff <= 0) diff += 7;
  d.setDate(d.getDate() + diff);
  return formatDate(d);
}

function nextMondayAfterThisWeek(now: Date): string {
  const d = new Date(now);
  const day = d.getDay();
  const toNextMonday = ((1 + 7 - day) % 7) + 7;
  d.setDate(d.getDate() + toNextMonday);
  return formatDate(d);
}
