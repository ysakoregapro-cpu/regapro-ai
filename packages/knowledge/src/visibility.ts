import { compareConfidentiality, type ConfidentialityLevel } from "@regapro/shared";

/**
 * Never auto-widen audience. Private source cannot become organization published.
 * Confidentiality may not be lowered (less secret) automatically.
 */
export function assertNoSecurityPromotion(input: {
  sourceVisibility: string;
  targetVisibility: string;
  sourceLevel: ConfidentialityLevel;
  targetLevel: ConfidentialityLevel;
}): void {
  if (input.sourceVisibility === "private" && input.targetVisibility !== "private") {
    throw new Error("PRIVATE_SOURCE_CANNOT_AUTO_PROMOTE");
  }
  if (compareConfidentiality(input.targetLevel, input.sourceLevel) < 0) {
    throw new Error("CLEARANCE_DOWNGRADE_FORBIDDEN");
  }
}

export function inheritVisibility(sourceVisibility: string): string {
  return sourceVisibility || "organization";
}
