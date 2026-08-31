import { isPlatformAccessError } from "@regapro/platform";
import type { AppErrorCode } from "@/lib/application/api-errors";

/**
 * Session-level refusals thrown by the existing auth helpers.
 *
 * Matched exactly, never by pattern: a broad match would also swallow Next.js
 * control-flow errors such as the dynamic-rendering bailout, which must always
 * propagate.
 */
const SESSION_DENIALS = new Set([
  "UNAUTHENTICATED",
  "NO_ORGANIZATION_MEMBERSHIP",
]);

export function isSessionDenial(err: unknown): boolean {
  return err instanceof Error && SESSION_DENIALS.has(err.message);
}

/**
 * Maps platform denials onto the app's existing API error codes so responses
 * stay uniform across AI routes and integrated-app routes.
 *
 * `MODULE_UNAVAILABLE` becomes 404: a registered but unshipped module should
 * not confirm its own existence to someone probing URLs.
 */
export function platformErrorToAppCode(err: unknown): AppErrorCode | null {
  if (!isPlatformAccessError(err)) return null;
  switch (err.code) {
    case "MODULE_UNAVAILABLE":
      return "NOT_FOUND";
    case "STAFF_INACTIVE":
    case "FORBIDDEN":
    default:
      return "FORBIDDEN";
  }
}
