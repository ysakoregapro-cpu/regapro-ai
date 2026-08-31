import type { PlatformPermission } from "@regapro/shared";

/**
 * Module Registry — the single source of truth for what the integrated app
 * contains, who may see it, and where it appears.
 *
 * Navigation, dashboard shortcuts, mobile nav, route guards, and API guards all
 * read from here. Adding a business module means adding one entry, not editing
 * five components.
 *
 * `featureState: "planned"` entries are registered but never rendered and never
 * routable — they exist so the permission model, docs, and future migrations
 * have a stable id to attach to.
 */

export const MODULE_IDS = [
  "home",
  "ai",
  "tasks",
  "search",
  "workspace",
  "work",
  "expense",
  "sales",
  "weekly_pay",
  "chat",
  "meeting",
  "coding",
  "mypage",
  "admin",
] as const;

export type ModuleId = (typeof MODULE_IDS)[number];

/**
 * - `available` — shipped, routable, may appear in navigation.
 * - `planned`   — registered only. Hidden everywhere, guards always refuse.
 * - `disabled`  — shipped but switched off for this deployment.
 */
export type ModuleFeatureState = "available" | "planned" | "disabled";

/** Where an entry belongs in the shell. `none` = routable but not in nav. */
export type NavigationGroup = "primary" | "work" | "personal" | "advanced" | "none";

export type ModuleDefinition = {
  id: ModuleId;
  /** Domain language shown to users. Never an internal engine name. */
  label: string;
  /** Route prefixes this module owns. Used by route guards. */
  routes: readonly string[];
  primaryRoute: string;
  navigationGroup: NavigationGroup;
  parentModuleId: ModuleId | null;
  /** Icon key resolved by the UI layer; the registry stays framework-free. */
  iconRef: string;
  requiredPermissions: readonly PlatformPermission[];
  /** `any` (default) shows the module when the caller holds one listed permission. */
  permissionMode: "any" | "all";
  dashboardVisibility: boolean;
  mobileVisibility: boolean;
  featureState: ModuleFeatureState;
  /**
   * Shown during staff-backfill compatibility mode, before the caller has a
   * `staff_id`. Only true for surfaces that already shipped, so enabling the
   * registry cannot remove anything a user can reach today.
   */
  legacyFallbackVisible: boolean;
  order: number;
};

const define = (
  input: Omit<ModuleDefinition, "permissionMode" | "legacyFallbackVisible"> &
    Partial<Pick<ModuleDefinition, "permissionMode" | "legacyFallbackVisible">>,
): ModuleDefinition => ({
  permissionMode: "any",
  legacyFallbackVisible: false,
  ...input,
});

export const MODULE_REGISTRY: readonly ModuleDefinition[] = [
  define({
    id: "home",
    label: "ホーム",
    routes: ["/home"],
    primaryRoute: "/home",
    navigationGroup: "primary",
    parentModuleId: null,
    iconRef: "home",
    requiredPermissions: [],
    dashboardVisibility: false,
    mobileVisibility: true,
    featureState: "available",
    legacyFallbackVisible: true,
    order: 10,
  }),
  define({
    id: "ai",
    label: "アシスタント",
    routes: ["/assistant"],
    primaryRoute: "/assistant",
    navigationGroup: "primary",
    parentModuleId: null,
    iconRef: "assistant",
    requiredPermissions: ["ai.use"],
    dashboardVisibility: true,
    mobileVisibility: true,
    featureState: "available",
    legacyFallbackVisible: true,
    order: 20,
  }),
  define({
    id: "tasks",
    label: "タスク",
    routes: ["/tasks"],
    primaryRoute: "/tasks",
    navigationGroup: "primary",
    parentModuleId: null,
    iconRef: "tasks",
    requiredPermissions: ["tasks.use"],
    dashboardVisibility: true,
    mobileVisibility: true,
    featureState: "available",
    legacyFallbackVisible: true,
    order: 30,
  }),
  define({
    id: "search",
    label: "検索",
    routes: ["/search"],
    primaryRoute: "/search",
    navigationGroup: "primary",
    parentModuleId: null,
    iconRef: "search",
    requiredPermissions: ["ai.use"],
    dashboardVisibility: false,
    mobileVisibility: true,
    featureState: "available",
    legacyFallbackVisible: true,
    order: 40,
  }),
  define({
    id: "workspace",
    label: "ワークスペース",
    routes: ["/workspace"],
    primaryRoute: "/workspace",
    navigationGroup: "primary",
    parentModuleId: null,
    iconRef: "workspace",
    requiredPermissions: ["ai.use"],
    dashboardVisibility: true,
    mobileVisibility: false,
    featureState: "available",
    legacyFallbackVisible: true,
    order: 50,
  }),

  // ---- Work: container for the business modules landing on this foundation ----
  define({
    id: "work",
    label: "業務",
    routes: ["/work"],
    primaryRoute: "/work",
    navigationGroup: "work",
    parentModuleId: null,
    iconRef: "work",
    requiredPermissions: [
      "expense.submit",
      "expense.view_own",
      "expense.manage",
      "sales.view_own",
      "sales.manage",
      "weekly_pay.submit",
      "weekly_pay.manage",
    ],
    dashboardVisibility: false,
    mobileVisibility: false,
    featureState: "planned",
    order: 60,
  }),
  define({
    id: "expense",
    label: "経費",
    routes: ["/work/expense"],
    primaryRoute: "/work/expense",
    navigationGroup: "work",
    parentModuleId: "work",
    iconRef: "expense",
    requiredPermissions: ["expense.submit", "expense.view_own", "expense.manage"],
    dashboardVisibility: true,
    mobileVisibility: true,
    featureState: "planned",
    order: 61,
  }),
  define({
    id: "sales",
    label: "売上",
    routes: ["/work/sales"],
    primaryRoute: "/work/sales",
    navigationGroup: "work",
    parentModuleId: "work",
    iconRef: "sales",
    requiredPermissions: ["sales.view_own", "sales.manage"],
    dashboardVisibility: true,
    mobileVisibility: false,
    featureState: "planned",
    order: 62,
  }),
  define({
    id: "weekly_pay",
    label: "週払い",
    routes: ["/work/weekly-pay"],
    primaryRoute: "/work/weekly-pay",
    navigationGroup: "work",
    parentModuleId: "work",
    iconRef: "weekly_pay",
    requiredPermissions: ["weekly_pay.submit", "weekly_pay.manage"],
    dashboardVisibility: true,
    mobileVisibility: true,
    featureState: "planned",
    order: 63,
  }),

  define({
    id: "chat",
    label: "社内チャット",
    routes: ["/chat"],
    primaryRoute: "/chat",
    navigationGroup: "primary",
    parentModuleId: null,
    iconRef: "chat",
    requiredPermissions: ["chat.use"],
    dashboardVisibility: false,
    mobileVisibility: true,
    featureState: "planned",
    order: 70,
  }),
  define({
    id: "meeting",
    label: "議事録",
    routes: ["/meeting"],
    primaryRoute: "/meeting",
    navigationGroup: "work",
    parentModuleId: null,
    iconRef: "meeting",
    requiredPermissions: ["meeting.use", "meeting.manage"],
    dashboardVisibility: false,
    mobileVisibility: false,
    featureState: "planned",
    order: 75,
  }),
  define({
    id: "coding",
    label: "コーディング",
    routes: ["/coding"],
    primaryRoute: "/coding",
    navigationGroup: "advanced",
    parentModuleId: null,
    iconRef: "coding",
    requiredPermissions: ["coding.use"],
    dashboardVisibility: false,
    mobileVisibility: false,
    featureState: "planned",
    order: 80,
  }),

  define({
    id: "mypage",
    label: "マイページ",
    routes: ["/settings"],
    primaryRoute: "/settings",
    navigationGroup: "personal",
    parentModuleId: null,
    iconRef: "mypage",
    requiredPermissions: ["mypage.use"],
    dashboardVisibility: false,
    mobileVisibility: false,
    featureState: "available",
    legacyFallbackVisible: true,
    order: 90,
  }),
  define({
    id: "admin",
    label: "管理センター",
    routes: ["/admin"],
    primaryRoute: "/admin",
    navigationGroup: "advanced",
    parentModuleId: null,
    iconRef: "admin",
    requiredPermissions: ["admin.access"],
    dashboardVisibility: false,
    mobileVisibility: false,
    featureState: "available",
    legacyFallbackVisible: true,
    order: 100,
  }),
];

const BY_ID = new Map<ModuleId, ModuleDefinition>(
  MODULE_REGISTRY.map((m) => [m.id, m]),
);

export function getModule(id: ModuleId): ModuleDefinition {
  const found = BY_ID.get(id);
  if (!found) throw new Error(`Unknown module id: ${id}`);
  return found;
}

export function listModules(): readonly ModuleDefinition[] {
  return MODULE_REGISTRY;
}

export function isModuleRoutable(module: ModuleDefinition): boolean {
  return module.featureState === "available";
}

/**
 * Longest-prefix match so `/work/expense` resolves to `expense`, not `work`.
 * Returns `null` for routes no module claims (login, api, static).
 */
export function findModuleByPath(pathname: string): ModuleDefinition | null {
  let best: ModuleDefinition | null = null;
  let bestLength = -1;
  for (const module of MODULE_REGISTRY) {
    for (const route of module.routes) {
      const matches = pathname === route || pathname.startsWith(`${route}/`);
      if (matches && route.length > bestLength) {
        best = module;
        bestLength = route.length;
      }
    }
  }
  return best;
}
