import type { ConfidentialityLevel } from "@regapro/shared";
import { confidentialityFromRank, confidentialityRank } from "@regapro/shared";

/** DB smallint (1–3) ↔ domain key */
export function levelToDb(level: ConfidentialityLevel): 1 | 2 | 3 {
  return confidentialityRank(level);
}

export function levelFromDb(rank: number | null | undefined): ConfidentialityLevel {
  return confidentialityFromRank(rank ?? 1);
}
