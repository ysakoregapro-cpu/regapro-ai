import type { ConfidentialityLevel } from "@regapro/shared";
import {
  assertNoSensitiveInExternalQueries as assertDomain,
  sanitizeExternalQuery as domainSanitize,
  type SanitizedQueryPlan,
} from "@regapro/web-intelligence";
import { SAMPLE_MEMBERSHIPS } from "@/lib/data/dev-sample/memberships";

export type QueryPlan = SanitizedQueryPlan;

const NAME_RE = (() => {
  const families = SAMPLE_MEMBERSHIPS.map((m) => m.name.split(/\s+/)[0]).filter(
    Boolean,
  ) as string[];
  return new RegExp(`(${families.join("|")})(さん)?`);
})();

/**
 * Application wrapper around the domain sanitizer.
 * Adds sample-directory name patterns used in local tests.
 */
export function sanitizeExternalQuery(input: {
  request: string;
  confidentialityLevel: ConfidentialityLevel;
}): QueryPlan {
  return domainSanitize({
    request: input.request,
    confidentialityLevel: input.confidentialityLevel,
    extraNamePattern: NAME_RE,
  });
}

export function assertNoSensitiveInExternalQueries(plan: QueryPlan): void {
  assertDomain(plan);
  for (const q of plan.sanitizedQueries) {
    if (NAME_RE.test(q)) {
      throw new Error("External query contains sensitive content");
    }
  }
}
