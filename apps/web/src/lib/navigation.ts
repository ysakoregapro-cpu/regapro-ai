export const NAV_PRIMARY = [
  { href: "/home", label: "ホーム", id: "home" },
  { href: "/assistant", label: "アシスタント", id: "assistant" },
  { href: "/tasks", label: "タスク", id: "tasks" },
  { href: "/search", label: "検索", id: "search" },
  { href: "/workspace", label: "ワークスペース", id: "workspace" },
] as const;

export const NAV_MOBILE = [
  { href: "/home", label: "ホーム", id: "home" },
  { href: "/assistant", label: "アシスタント", id: "assistant" },
  { href: "/tasks", label: "タスク", id: "tasks" },
  { href: "/search", label: "検索", id: "search" },
] as const;

export const WORKSPACE_NAV = [
  { href: "/workspace/knowledge", label: "ナレッジ" },
  { href: "/workspace/research", label: "調査" },
  { href: "/workspace/documents", label: "ドキュメント" },
  { href: "/workspace/prompts", label: "プロンプト" },
  { href: "/workspace/projects", label: "プロジェクト" },
] as const;

export const ADMIN_NAV = [
  { href: "/admin/organization", label: "組織" },
  { href: "/admin/members", label: "メンバー" },
  { href: "/admin/roles", label: "ロールと権限" },
  { href: "/admin/knowledge", label: "ナレッジ承認" },
  { href: "/admin/tasks", label: "タスク管理" },
  { href: "/admin/notifications", label: "通知管理" },
  { href: "/admin/connections", label: "システム接続" },
  { href: "/admin/usage", label: "利用状況" },
  { href: "/admin/audit", label: "監査ログ" },
  { href: "/admin/diagnostics", label: "診断情報" },
] as const;

export const ASSISTANT_TOOLS = [
  { id: "internal_search", label: "社内情報を探す" },
  { id: "web_research", label: "Webで調べる" },
  { id: "task_manage", label: "タスクを管理する" },
  { id: "draft_text", label: "文面を作る" },
  { id: "make_doc", label: "資料を作る" },
  { id: "make_code", label: "コードを作る" },
  { id: "make_prompt", label: "AI向け指示書を作る" },
  { id: "attach_file", label: "ファイルを追加する" },
] as const;
