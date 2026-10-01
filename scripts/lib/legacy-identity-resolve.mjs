/**
 * Legacy identity resolution for Phase 8.1 import (Node scripts).
 * Keep in sync with packages/work/src/legacy-identity-resolve.ts
 */

export function resolveLegacyPerson({
  row,
  legacyEmailByUserId,
  approvedByExternal,
  staffById,
  byAuth,
  byStaffNo,
  byLegacyExternal,
  byEmailMd5,
  crossProjectEmailMd5,
  normalizeCode,
}) {
  const candidates = new Map();
  const add = (staffId, method) => {
    if (!staffId || !staffById.has(staffId)) return;
    const staff = staffById.get(staffId);
    if (staff?.record_kind === "fixture") return;
    const methods = candidates.get(staffId) ?? [];
    methods.push(method);
    candidates.set(staffId, methods);
  };

  const externalId = String(row.id ?? row.profile_id ?? row.member_id ?? "");
  if (externalId && approvedByExternal.has(externalId)) {
    const staffId = approvedByExternal.get(externalId);
    if (staffById.has(staffId) && staffById.get(staffId)?.record_kind !== "fixture") {
      return {
        kind: "confirmed",
        staffId,
        methods: ["approved_identity"],
      };
    }
    return {
      kind: "collision",
      staffId: null,
      methods: ["approved_identity_fixture_or_missing"],
      staffIds: [staffId].filter(Boolean),
    };
  }

  const authUserId = row.auth_user_id ?? row.authUserId ?? null;
  if (authUserId && byAuth?.has(authUserId)) {
    for (const sid of byAuth.get(authUserId)) add(sid, "auth_user_id_candidate");
  }

  const loginId = row.login_id ?? null;
  if (loginId && byStaffNo?.has(normalizeCode(loginId))) {
    add(byStaffNo.get(normalizeCode(loginId)), "staff_no_candidate");
  }

  if (externalId && byLegacyExternal?.has(externalId)) {
    add(byLegacyExternal.get(externalId), "existing_identity_candidate");
  }

  const emailKey = authUserId ?? externalId;
  const emailRow = legacyEmailByUserId?.get(String(emailKey));
  let emailCandidateStaff = null;
  let emailCrossProject = false;
  if (emailRow?.confirmed && emailRow.email_md5 && byEmailMd5?.has(emailRow.email_md5)) {
    emailCrossProject = crossProjectEmailMd5?.has(emailRow.email_md5) ?? false;
    const hits = byEmailMd5.get(emailRow.email_md5).filter((sid) => {
      const s = staffById.get(sid);
      return s && s.record_kind !== "fixture";
    });
    if (hits.length === 1) {
      emailCandidateStaff = hits[0];
      add(hits[0], "email_verified_candidate");
    } else if (hits.length > 1) {
      return {
        kind: "collision",
        staffId: null,
        methods: ["email_verified_candidate"],
        staffIds: hits,
      };
    }
  }

  if (emailCandidateStaff) {
    return {
      kind: emailCrossProject ? "candidate_needs_org_person_confirm" : "candidate",
      staffId: emailCandidateStaff,
      methods: emailCrossProject
        ? ["email_verified_candidate", "cross_project_email_unconfirmed"]
        : ["email_verified_candidate"],
    };
  }

  if (candidates.size === 1) {
    const [staffId, methods] = [...candidates.entries()][0];
    return {
      kind: "candidate",
      staffId,
      methods: [...new Set(methods)],
    };
  }
  if (candidates.size > 1) {
    return {
      kind: "collision",
      staffId: null,
      methods: [...new Set([...candidates.values()].flat())],
      staffIds: [...candidates.keys()],
    };
  }

  return { kind: "unmatched", staffId: null, methods: [] };
}

export function assertNoEmailConfirmLoophole(argv) {
  if (argv.includes("--confirm-email-matches")) {
    throw new Error(
      "REFUSED: --confirm-email-matches removed. Use migration_approved_identities only.",
    );
  }
}
