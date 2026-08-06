import { cn } from "@/lib/cn";

type PageHeaderProps = {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
};

export function PageHeader({ title, description, actions, className }: PageHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4",
        className
      )}
    >
      <div className="min-w-0">
        <h1 className="text-[24px] font-semibold leading-tight tracking-tight text-text md:text-[26px]">
          {title}
        </h1>
        {description ? (
          <p className="mt-1 max-w-2xl text-[13px] text-text-secondary">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

type SectionHeaderProps = {
  title: string;
  description?: string;
  action?: React.ReactNode;
};

export function SectionHeader({ title, description, action }: SectionHeaderProps) {
  return (
    <div className="mb-2 flex items-end justify-between gap-3">
      <div>
        <h2 className="text-[16px] font-semibold text-text">{title}</h2>
        {description ? (
          <p className="mt-0.5 text-[12px] text-text-secondary">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

export function StatusBadge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger" | "accent";
}) {
  const tones: Record<string, string> = {
    neutral: "bg-surface-sunken text-text-secondary",
    success: "bg-success-muted text-success",
    warning: "bg-warning-muted text-warning",
    danger: "bg-danger-muted text-danger",
    accent: "bg-accent-muted text-accent",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
        tones[tone]
      )}
    >
      {children}
    </span>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-start gap-2 py-10">
      <p className="text-[15px] font-medium text-text">{title}</p>
      {description ? (
        <p className="max-w-md text-[13px] text-text-secondary">{description}</p>
      ) : null}
      {action}
    </div>
  );
}

export function ErrorState({
  title = "表示できませんでした",
  description,
}: {
  title?: string;
  description?: string;
}) {
  return (
    <div
      role="alert"
      className="rounded-[10px] border border-danger/30 bg-danger-muted px-4 py-3 text-[13px] text-danger"
    >
      <p className="font-medium">{title}</p>
      {description ? <p className="mt-1 opacity-90">{description}</p> : null}
    </div>
  );
}

export function LoadingSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="animate-pulse space-y-2" aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-10 rounded-md bg-surface-sunken" />
      ))}
    </div>
  );
}

export function ListRow({
  children,
  href,
  onClick,
  className,
}: {
  children: React.ReactNode;
  href?: string;
  onClick?: () => void;
  className?: string;
}) {
  const classes = cn(
    "flex w-full items-center gap-3 border-b border-border px-1 py-3 text-left transition-colors hover:bg-surface-raised",
    className
  );
  if (href) {
    return (
      <a href={href} className={classes}>
        {children}
      </a>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={classes}>
        {children}
      </button>
    );
  }
  return <div className={classes}>{children}</div>;
}

export function DemoDataBadge() {
  return (
    <span
      className="inline-flex items-center rounded-md border border-border bg-surface px-2 py-0.5 text-[11px] text-text-secondary"
      title="確認用のサンプルデータを表示しています"
    >
      サンプルデータ
    </span>
  );
}

export function ConnectionStatus({
  connected,
  label,
  reason,
}: {
  connected: boolean;
  label: string;
  reason?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border py-3 text-[13px]">
      <div>
        <p className="font-medium text-text">{label}</p>
        {!connected && reason ? (
          <p className="mt-0.5 text-[12px] text-text-secondary">{reason}</p>
        ) : null}
      </div>
      <StatusBadge tone={connected ? "success" : "neutral"}>
        {connected ? "接続済み" : "未接続"}
      </StatusBadge>
    </div>
  );
}

export function PermissionGate({
  allowed,
  children,
  fallback = null,
}: {
  allowed: boolean;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  if (!allowed) return <>{fallback}</>;
  return <>{children}</>;
}
