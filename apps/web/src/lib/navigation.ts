import { MODULE_REGISTRY } from "@regapro/platform";

/**
 * Shell navigation is generated from the Module Registry, not hand-maintained.
 * These arrays are the *unauthenticated fallback* used before a session is
 * resolved; the real, permission-filtered navigation is passed down from
 * `(app)/layout.tsx`.
 */
export type NavItem = { href: string; label: string; id: string };

function fallbackNav(surface: "desktop" | "mobile"): NavItem[] {
  return MODULE_REGISTRY.filter(
    (m) =>
      m.featureState === "available" &&
      m.legacyFallbackVisible &&
      m.navigationGroup === "primary" &&
      (surface === "desktop" || m.mobileVisibility),
  )
    .sort((a, b) => a.order - b.order)
    .map((m) => ({ href: m.primaryRoute, label: m.label, id: m.iconRef }));
}

export const NAV_PRIMARY: readonly NavItem[] = fallbackNav("desktop");

export const NAV_MOBILE: readonly NavItem[] = fallbackNav("mobile");

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
  { href: "/admin/conversation-audit", label: "会話監査" },
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
