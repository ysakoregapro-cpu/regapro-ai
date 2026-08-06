export const DESIGN_TOKENS = {
  colors: {
    background: "#ffffff",
    foreground: "#0f172a",
    primary: "#2563eb",
    primaryForeground: "#ffffff",
    muted: "#f1f5f9",
    mutedForeground: "#64748b",
    border: "#e2e8f0",
    destructive: "#dc2626",
    success: "#16a34a",
    warning: "#ca8a04",
  },
  spacing: {
    xs: "0.25rem",
    sm: "0.5rem",
    md: "1rem",
    lg: "1.5rem",
    xl: "2rem",
    "2xl": "3rem",
  },
  radius: {
    sm: "0.25rem",
    md: "0.5rem",
    lg: "0.75rem",
    full: "9999px",
  },
  fontSize: {
    sm: "0.875rem",
    base: "1rem",
    lg: "1.125rem",
    xl: "1.25rem",
    "2xl": "1.5rem",
  },
  shadow: {
    sm: "0 1px 2px rgb(0 0 0 / 0.05)",
    md: "0 4px 6px rgb(0 0 0 / 0.1)",
  },
} as const;

export type DesignTokens = typeof DESIGN_TOKENS;

export const CSS_VARIABLE_MAP: Record<string, string> = {
  "--regapro-color-background": DESIGN_TOKENS.colors.background,
  "--regapro-color-foreground": DESIGN_TOKENS.colors.foreground,
  "--regapro-color-primary": DESIGN_TOKENS.colors.primary,
  "--regapro-color-primary-foreground": DESIGN_TOKENS.colors.primaryForeground,
  "--regapro-color-muted": DESIGN_TOKENS.colors.muted,
  "--regapro-color-muted-foreground": DESIGN_TOKENS.colors.mutedForeground,
  "--regapro-color-border": DESIGN_TOKENS.colors.border,
  "--regapro-color-destructive": DESIGN_TOKENS.colors.destructive,
  "--regapro-color-success": DESIGN_TOKENS.colors.success,
  "--regapro-color-warning": DESIGN_TOKENS.colors.warning,
  "--regapro-spacing-xs": DESIGN_TOKENS.spacing.xs,
  "--regapro-spacing-sm": DESIGN_TOKENS.spacing.sm,
  "--regapro-spacing-md": DESIGN_TOKENS.spacing.md,
  "--regapro-spacing-lg": DESIGN_TOKENS.spacing.lg,
  "--regapro-spacing-xl": DESIGN_TOKENS.spacing.xl,
  "--regapro-spacing-2xl": DESIGN_TOKENS.spacing["2xl"],
  "--regapro-radius-sm": DESIGN_TOKENS.radius.sm,
  "--regapro-radius-md": DESIGN_TOKENS.radius.md,
  "--regapro-radius-lg": DESIGN_TOKENS.radius.lg,
  "--regapro-radius-full": DESIGN_TOKENS.radius.full,
};

export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

export function tokenClass(
  prefix: "bg" | "text" | "border",
  token: keyof typeof DESIGN_TOKENS.colors,
): string {
  return `${prefix}-[var(--regapro-color-${token.replace(/([A-Z])/g, "-$1").toLowerCase()})]`;
}
