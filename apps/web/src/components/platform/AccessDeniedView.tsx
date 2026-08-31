import Link from "next/link";
import type { PlatformDenialCode } from "@regapro/platform";
import { denialMessage } from "@regapro/platform";

/**
 * One refusal surface for every blocked route, so users get the same wording
 * and the same way out regardless of which layer refused them.
 *
 * Deliberately says nothing about which permission or module was missing —
 * that detail belongs in the server log, not in a reconnaissance-friendly page.
 */
export function AccessDeniedView({
  code = "FORBIDDEN",
  backHref = "/home",
  backLabel = "ホームへ戻る",
}: {
  code?: PlatformDenialCode;
  backHref?: string;
  backLabel?: string;
}) {
  const heading =
    code === "STAFF_INACTIVE"
      ? "アカウントを利用できません"
      : code === "MODULE_UNAVAILABLE"
        ? "準備中の機能です"
        : "権限がありません";

  return (
    <section
      className="mx-auto flex max-w-[560px] flex-col items-start gap-4 py-12"
      aria-labelledby="access-denied-heading"
    >
      <div className="flex flex-col gap-2">
        <h1
          id="access-denied-heading"
          className="text-[18px] font-semibold text-text"
        >
          {heading}
        </h1>
        <p className="text-[13px] leading-relaxed text-text-secondary">
          {denialMessage(code)}
        </p>
        {code === "FORBIDDEN" ? (
          <p className="text-[13px] leading-relaxed text-text-secondary">
            必要な場合は、担当の管理者に利用申請してください。
          </p>
        ) : null}
      </div>
      <Link
        href={backHref}
        className="inline-flex min-h-11 items-center rounded-md bg-accent px-4 text-[13px] font-medium text-accent-fg transition-colors hover:bg-accent-hover"
      >
        {backLabel}
      </Link>
    </section>
  );
}
