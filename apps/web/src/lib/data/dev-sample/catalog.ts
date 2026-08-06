/** Coherent Regapro corp sample data for REGAPRO_DATA_MODE=dev-sample */

export const SAMPLE_ORG = {
  id: "org-regapro",
  name: "株式会社レガプロ",
} as const;

export const SAMPLE_USERS = [
  {
    id: "user-tanaka",
    name: "田中 健太",
    email: "tanaka@regapro.example",
    department: "有料職業紹介",
    role: "manager" as const,
  },
  {
    id: "user-morifuji",
    name: "森藤 美穂",
    email: "morifuji@regapro.example",
    department: "有料職業紹介",
    role: "editor" as const,
  },
  {
    id: "user-sato",
    name: "佐藤 悠",
    email: "sato@regapro.example",
    department: "DX開発",
    role: "member" as const,
  },
  {
    id: "user-admin",
    name: "管理 太郎",
    email: "admin@regapro.example",
    department: "経営企画",
    role: "admin" as const,
  },
] as const;

export const CURRENT_USER = SAMPLE_USERS[0];

export const SAMPLE_PROJECTS = [
  {
    id: "proj-recruit",
    name: "有料職業紹介",
    description: "人材紹介・求人選定・求職者対応",
  },
  {
    id: "proj-event",
    name: "通信イベント運営",
    description: "展示会・説明会の企画運営",
  },
  {
    id: "proj-hr",
    name: "採用・人事",
    description: "社内採用と人事オペレーション",
  },
  {
    id: "proj-dx",
    name: "DX開発",
    description: "社内業務の自動化・アプリ開発",
  },
  {
    id: "proj-estate",
    name: "不動産事業",
    description: "物件管理・顧客対応",
  },
] as const;

export type TaskStatus = "todo" | "in_progress" | "done" | "cancelled";
export type TaskPriority = "low" | "normal" | "high" | "urgent";

export type SampleTask = {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeId: string;
  projectId: string;
  dueAt: string;
  notifyDayBefore: boolean;
  createdFrom: string;
  relatedPeople: string[];
};

export const SAMPLE_TASKS: SampleTask[] = [
  {
    id: "task-1",
    title: "田中さんへ求人選定状況を確認",
    description: "A社向け候補3名の進捗を共有し、次の接触方針を決める",
    status: "todo",
    priority: "high",
    assigneeId: "user-morifuji",
    projectId: "proj-recruit",
    dueAt: "2026-08-07T17:00:00+09:00",
    notifyDayBefore: true,
    createdFrom: "アシスタント",
    relatedPeople: ["user-tanaka", "user-morifuji"],
  },
  {
    id: "task-2",
    title: "通信イベント運営資料の初稿レビュー",
    description: "会場レイアウトとタイムテーブルの矛盾を確認",
    status: "in_progress",
    priority: "normal",
    assigneeId: "user-tanaka",
    projectId: "proj-event",
    dueAt: "2026-08-08T12:00:00+09:00",
    notifyDayBefore: true,
    createdFrom: "手動",
    relatedPeople: ["user-sato"],
  },
  {
    id: "task-3",
    title: "代表確認が必要な採用条件案を整理",
    description: "給与レンジとリモート可否の案を1枚にまとめる",
    status: "todo",
    priority: "urgent",
    assigneeId: "user-tanaka",
    projectId: "proj-hr",
    dueAt: "2026-08-06T18:00:00+09:00",
    notifyDayBefore: true,
    createdFrom: "会議メモ",
    relatedPeople: ["user-admin"],
  },
  {
    id: "task-4",
    title: "DX開発：社内タスク画面のレビュー反映",
    description: "List Row密度とモバイル下部ナビの余白を調整",
    status: "in_progress",
    priority: "normal",
    assigneeId: "user-sato",
    projectId: "proj-dx",
    dueAt: "2026-08-09T17:00:00+09:00",
    notifyDayBefore: true,
    createdFrom: "プロジェクト",
    relatedPeople: ["user-tanaka"],
  },
  {
    id: "task-5",
    title: "物件問い合わせへの返信文面を作成",
    description: "内見候補日時を提示する返信ドラフト",
    status: "done",
    priority: "low",
    assigneeId: "user-tanaka",
    projectId: "proj-estate",
    dueAt: "2026-08-05T15:00:00+09:00",
    notifyDayBefore: false,
    createdFrom: "アシスタント",
    relatedPeople: [],
  },
];

export const SAMPLE_THREADS = [
  {
    id: "thread-1",
    title: "求人選定の状況整理",
    projectId: "proj-recruit",
    updatedAt: "2026-08-06T09:20:00+09:00",
    preview: "候補3名の強みと懸念を表で整理しました。",
  },
  {
    id: "thread-2",
    title: "イベント会場レイアウトの確認",
    projectId: "proj-event",
    updatedAt: "2026-08-05T16:40:00+09:00",
    preview: "動線案Bの方が受付混雑を回避できます。",
  },
  {
    id: "thread-3",
    title: "Cursor向け実装指示書",
    projectId: "proj-dx",
    updatedAt: "2026-08-05T11:10:00+09:00",
    preview: "タスク画面の品質ゲート付きプロンプトを作成しました。",
  },
] as const;

export const SAMPLE_MESSAGES = [
  {
    id: "msg-1",
    threadId: "thread-1",
    role: "user" as const,
    content: "A社向け求人選定の現状をまとめて。担当は森藤さん。",
    createdAt: "2026-08-06T09:10:00+09:00",
  },
  {
    id: "msg-2",
    threadId: "thread-1",
    role: "assistant" as const,
    content:
      "有料職業紹介プロジェクトの社内情報から整理しました。\n\n- 候補A：現場経験が厚いがリモート希望\n- 候補B：条件一致度が高い\n- 候補C：即日出勤可だが年齢条件の確認が必要\n\n森藤さんへの確認タスク案を用意できます。",
    createdAt: "2026-08-06T09:12:00+09:00",
    citations: [
      {
        id: "cite-1",
        title: "A社求人要件（公開版）",
        source: "ナレッジ",
      },
      {
        id: "cite-2",
        title: "候補進捗シート 8月",
        source: "ドキュメント",
      },
    ],
  },
] as const;

export const SAMPLE_KNOWLEDGE = [
  {
    id: "know-1",
    title: "有料職業紹介：求人票作成の標準手順",
    category: "業務手順",
    business: "有料職業紹介",
    projectId: "proj-recruit",
    updatedAt: "2026-07-28",
    freshness: "良好",
    approvalStatus: "published" as const,
    visibility: "organization" as const,
  },
  {
    id: "know-2",
    title: "通信イベント：来場者動線の注意点",
    category: "運営ノウハウ",
    business: "通信イベント運営",
    projectId: "proj-event",
    updatedAt: "2026-07-15",
    freshness: "要確認",
    approvalStatus: "approved" as const,
    visibility: "project" as const,
  },
  {
    id: "know-3",
    title: "GAS：Spreadsheet読込の安全パターン",
    category: "コード部品",
    business: "DX開発",
    projectId: "proj-dx",
    updatedAt: "2026-08-01",
    freshness: "良好",
    approvalStatus: "review" as const,
    visibility: "team" as const,
  },
] as const;

export const SAMPLE_RESEARCH = [
  {
    id: "research-1",
    title: "職業紹介手数料の相場調査",
    statusLabel: "情報を整理しています",
    projectId: "proj-recruit",
    updatedAt: "2026-08-04",
  },
  {
    id: "research-2",
    title: "展示会ブース関連法規の確認",
    statusLabel: "回答を作成しています",
    projectId: "proj-event",
    updatedAt: "2026-08-03",
  },
] as const;

export const SAMPLE_DOCUMENTS = [
  {
    id: "doc-1",
    title: "求人選定サマリー（A社）",
    kind: "資料",
    projectId: "proj-recruit",
    updatedAt: "2026-08-06",
  },
  {
    id: "doc-2",
    title: "イベント運営チェックリスト",
    kind: "ドキュメント",
    projectId: "proj-event",
    updatedAt: "2026-08-05",
  },
  {
    id: "doc-3",
    title: "タスク画面実装のCursor指示書",
    kind: "プロンプト",
    projectId: "proj-dx",
    updatedAt: "2026-08-05",
  },
] as const;

export const SAMPLE_PROMPTS = [
  {
    id: "prompt-1",
    title: "Cursor：タスクList Row改善",
    target: "Cursor",
    projectId: "proj-dx",
    updatedAt: "2026-08-05",
  },
  {
    id: "prompt-2",
    title: "ChatGPT：求人票ドラフト校正",
    target: "ChatGPT",
    projectId: "proj-recruit",
    updatedAt: "2026-08-02",
  },
] as const;

export const SAMPLE_NOTIFICATIONS = [
  {
    id: "notif-1",
    title: "期限前日の通知",
    body: "『田中さんへ求人選定状況を確認』の期限が明日です",
    read: false,
    createdAt: "2026-08-06T09:00:00+09:00",
  },
  {
    id: "notif-2",
    title: "ナレッジ承認待ち",
    body: "『GAS：Spreadsheet読込の安全パターン』の確認依頼",
    read: false,
    createdAt: "2026-08-06T08:30:00+09:00",
  },
  {
    id: "notif-3",
    title: "調査が完了しました",
    body: "職業紹介手数料の相場調査の結果を確認できます",
    read: true,
    createdAt: "2026-08-04T18:00:00+09:00",
  },
] as const;

export const SAMPLE_ACTIVITY = [
  {
    id: "act-1",
    label: "森藤さんが求人選定タスクを更新",
    at: "2026-08-06T09:05:00+09:00",
  },
  {
    id: "act-2",
    label: "イベント運営資料の初稿を保存",
    at: "2026-08-05T17:20:00+09:00",
  },
  {
    id: "act-3",
    label: "DX開発プロジェクトにプロンプトを追加",
    at: "2026-08-05T11:15:00+09:00",
  },
] as const;

export function userName(id: string): string {
  return SAMPLE_USERS.find((u) => u.id === id)?.name ?? "未設定";
}

export function projectName(id: string): string {
  return SAMPLE_PROJECTS.find((p) => p.id === id)?.name ?? "未設定";
}
