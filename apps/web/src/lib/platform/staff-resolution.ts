import "server-only";
import { cache } from "react";
import { unstable_rethrow } from "next/navigation";
import type { PermissionGrant } from "@regapro/shared";
import type { StaffRecord } from "@regapro/platform";
import { isDevSampleMode } from "@/lib/supabase/env";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  loadGrants,
  loadStaffRecord,
  type PlatformQueryClient,
} from "./staff-queries";

/**
 * Resolves the signed-in login identity to the canonical staff record and its
 * Feature Permission grants.
 *
 * Returns `null` whenever the caller has no staff record — including before the
 * Phase 1 migrations are applied. Callers then run in compatibility mode with
 * the legacy AI permissions driving the shell, so shipping this ahead of the
 * database changes is a no-op rather than an outage.
 */

export type ResolvedStaffAccess = {
  staff: StaffRecord;
  grants: PermissionGrant[];
  roleIds: string[];
};

let missingRelationLogged = false;

function noteCompatibilityMode() {
  if (missingRelationLogged) return;
  missingRelationLogged = true;
  console.info(
    "[platform] staff tables not present — running in staff compatibility mode",
  );
}

/**
 * Platform API — canonical person for the current request.
 * Memoised per request so the shell, page, and guards share one lookup.
 */
export const resolveCurrentStaff = cache(
  async (): Promise<ResolvedStaffAccess | null> => {
    if (isDevSampleMode()) return null;

    try {
      const supabase = await createServerSupabaseClient();
      const { data, error } = await supabase.auth.getUser();
      if (error || !data.user) return null;

      const client = supabase as unknown as PlatformQueryClient;
      const lookup = await loadStaffRecord(client, data.user.id);
      if (lookup.kind === "unavailable") {
        noteCompatibilityMode();
        return null;
      }
      if (lookup.kind !== "found") return null;

      const { grants, roleIds } = await loadGrants(client, lookup.staff);
      return { staff: lookup.staff, grants, roleIds };
    } catch (err) {
      unstable_rethrow(err);
      console.error(
        "[platform] staff resolution failed",
        err instanceof Error ? err.message : String(err),
      );
      return null;
    }
  },
);
