/**
 * Fixture lifecycle for RLS integration tests (service_role only here).
 */
import {
  FIXTURE_TAG,
  ORG_SLUG,
  createAdminClient,
  createUserClient,
  fixtureEmail,
  fixturePassword,
  tagTitle,
} from "./lib.mjs";

/**
 * @typedef {{
 *   key: string,
 *   email: string,
 *   password: string,
 *   userId: string,
 *   accessToken: string,
 *   client: import('@supabase/supabase-js').SupabaseClient,
 *   membershipId?: string,
 *   departmentId?: string | null,
 *   roleKey?: string,
 * }} FixtureUser
 */

export async function resolveOrgContext(admin) {
  const { data: org, error } = await admin
    .from("organizations")
    .select("id, name, slug")
    .eq("slug", ORG_SLUG)
    .is("deleted_at", null)
    .single();
  if (error || !org) {
    throw new Error(
      `Organization slug=${ORG_SLUG} not found. Run npm run db:bootstrap-org first.`,
    );
  }

  const { data: depts, error: dErr } = await admin
    .from("departments")
    .select("id, key, name, default_clearance_level")
    .eq("org_id", org.id)
    .is("deleted_at", null);
  if (dErr) throw dErr;

  const byKey = Object.fromEntries((depts ?? []).map((d) => [d.key, d]));
  for (const key of ["sales", "people", "executive_strategy"]) {
    if (!byKey[key]) {
      throw new Error(`Missing department key=${key} on org ${org.id}`);
    }
  }

  const { data: roles, error: rErr } = await admin
    .from("roles")
    .select("id, key")
    .is("org_id", null)
    .is("deleted_at", null);
  if (rErr) throw rErr;
  const roleByKey = Object.fromEntries((roles ?? []).map((r) => [r.key, r]));
  if (!roleByKey.member || !roleByKey.editor || !roleByKey.admin) {
    throw new Error("Global roles member/editor/admin missing");
  }

  return { org, depts: byKey, roles: roleByKey };
}

async function ensureAuthUser(admin, email, password, displayName) {
  const list = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const existing = list.data?.users?.find(
    (u) => u.email?.toLowerCase() === email.toLowerCase(),
  );
  if (existing) {
    await admin.auth.admin.updateUserById(existing.id, {
      password,
      email_confirm: true,
      user_metadata: { display_name: displayName },
    });
    return existing.id;
  }
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: displayName },
  });
  if (created.error || !created.data.user) {
    throw new Error(
      `createUser failed for fixture: ${created.error?.message ?? "unknown"}`,
    );
  }
  return created.data.user.id;
}

async function ensureProfile(admin, userId, displayName) {
  const { data: existing } = await admin
    .from("profiles")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (existing) {
    await admin
      .from("profiles")
      .update({ display_name: displayName })
      .eq("user_id", userId);
    return;
  }
  const { error } = await admin.from("profiles").insert({
    user_id: userId,
    display_name: displayName,
  });
  if (error) throw error;
}

async function ensureMembership(admin, orgId, userId, departmentId) {
  const { data: existing } = await admin
    .from("organization_memberships")
    .select("id")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (existing?.id) {
    await admin
      .from("organization_memberships")
      .update({ department_id: departmentId })
      .eq("id", existing.id);
    return existing.id;
  }
  const { data, error } = await admin
    .from("organization_memberships")
    .insert({
      org_id: orgId,
      user_id: userId,
      department_id: departmentId,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

async function ensureMembershipRole(admin, membershipId, roleId) {
  // Hard-delete stale rows so UNIQUE (membership_id, role_id) does not block recreate.
  await admin.from("membership_roles").delete().eq("membership_id", membershipId);

  const { error } = await admin.from("membership_roles").insert({
    membership_id: membershipId,
    role_id: roleId,
  });
  if (error) throw new Error(`membership_roles insert: ${error.message}`);
}

async function signInUser(url, anon, email, password) {
  const { createClient } = await import("@supabase/supabase-js");
  const client = createClient(url, anon, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password,
  });
  if (error || !data.session?.access_token) {
    throw new Error(`signIn failed for fixture: ${error?.message ?? "no session"}`);
  }
  return {
    accessToken: data.session.access_token,
    client: createUserClient(url, anon, data.session.access_token),
  };
}

/**
 * Create / refresh fixture users and seed data rows (service_role).
 */
export async function setupFixtures({ url, anon, secret, runId }) {
  const admin = createAdminClient(url, secret);
  const ctx = await resolveOrgContext(admin);
  const password = fixturePassword();

  /** @type {Record<string, FixtureUser>} */
  const users = {};

  const specs = [
    {
      key: "sales_company",
      dept: "sales",
      role: "editor",
      label: "RLS sales L1",
    },
    {
      key: "hr_people",
      dept: "people",
      role: "editor",
      label: "RLS hr L2",
    },
    {
      key: "executive",
      dept: "executive_strategy",
      role: "editor",
      label: "RLS executive L3",
    },
    {
      key: "admin_fixture",
      dept: "executive_strategy",
      role: "admin",
      label: "RLS admin fixture",
    },
    {
      key: "no_membership",
      dept: null,
      role: null,
      label: "RLS no membership",
    },
  ];

  for (const spec of specs) {
    const email = fixtureEmail(runId, spec.key);
    const displayName = `[${FIXTURE_TAG}:${runId}] ${spec.label}`;
    const userId = await ensureAuthUser(admin, email, password, displayName);
    await ensureProfile(admin, userId, displayName);

    let membershipId;
    let departmentId = null;
    if (spec.dept && spec.role) {
      departmentId = ctx.depts[spec.dept].id;
      membershipId = await ensureMembership(
        admin,
        ctx.org.id,
        userId,
        departmentId,
      );
      await ensureMembershipRole(admin, membershipId, ctx.roles[spec.role].id);
    } else {
      // Ensure no membership for no_membership user
      await admin
        .from("organization_memberships")
        .update({ deleted_at: new Date().toISOString() })
        .eq("user_id", userId)
        .eq("org_id", ctx.org.id)
        .is("deleted_at", null);
    }

    const session = await signInUser(url, anon, email, password);
    users[spec.key] = {
      key: spec.key,
      email,
      password,
      userId,
      accessToken: session.accessToken,
      client: session.client,
      membershipId,
      departmentId,
      roleKey: spec.role ?? undefined,
    };
  }

  // ---- Seed labeled threads / derived rows (service_role) ----
  const ids = {};
  const sales = users.sales_company;
  const hr = users.hr_people;
  const exec = users.executive;
  const adminFix = users.admin_fixture;

  async function insertThread(row) {
    const { data, error } = await admin
      .from("chat_threads")
      .insert(row)
      .select("id")
      .single();
    if (error) throw new Error(`seed thread: ${error.message}`);
    return data.id;
  }

  // Confidentiality matrix (organization visibility)
  ids.threadL1Org = await insertThread({
    org_id: ctx.org.id,
    title: tagTitle(runId, "conf L1 organization"),
    confidentiality_level: 1,
    visibility: "organization",
    owner_user_id: exec.userId,
    department_id: ctx.depts.executive_strategy.id,
    minimum_derived_level: 1,
    security_label_source: "user",
  });
  ids.threadL2Org = await insertThread({
    org_id: ctx.org.id,
    title: tagTitle(runId, "conf L2 organization"),
    confidentiality_level: 2,
    visibility: "organization",
    owner_user_id: exec.userId,
    department_id: ctx.depts.executive_strategy.id,
    minimum_derived_level: 2,
    security_label_source: "user",
  });
  ids.threadL3Org = await insertThread({
    org_id: ctx.org.id,
    title: tagTitle(runId, "conf L3 organization"),
    confidentiality_level: 3,
    visibility: "organization",
    owner_user_id: exec.userId,
    department_id: ctx.depts.executive_strategy.id,
    minimum_derived_level: 3,
    security_label_source: "user",
  });

  // Private owned by sales
  ids.threadPrivateSales = await insertThread({
    org_id: ctx.org.id,
    title: tagTitle(runId, "private sales owner"),
    confidentiality_level: 1,
    visibility: "private",
    owner_user_id: sales.userId,
    department_id: sales.departmentId,
    minimum_derived_level: 1,
  });
  await admin.from("chat_participants").upsert(
    {
      thread_id: ids.threadPrivateSales,
      user_id: sales.userId,
    },
    { onConflict: "thread_id,user_id" },
  );
  // participant: hr
  await admin.from("chat_participants").upsert(
    {
      thread_id: ids.threadPrivateSales,
      user_id: hr.userId,
    },
    { onConflict: "thread_id,user_id" },
  );

  ids.msgPrivateSales = (
    await admin
      .from("chat_messages")
      .insert({
        thread_id: ids.threadPrivateSales,
        author_id: sales.userId,
        role: "user",
        content: tagTitle(runId, "private message body"),
        confidentiality_level: 1,
        visibility: "private",
      })
      .select("id")
      .single()
  ).data.id;

  // Participants-visibility thread (owner exec, participant sales)
  ids.threadParticipants = await insertThread({
    org_id: ctx.org.id,
    title: tagTitle(runId, "participants thread"),
    confidentiality_level: 1,
    visibility: "participants",
    owner_user_id: exec.userId,
    department_id: exec.departmentId,
    minimum_derived_level: 1,
  });
  await admin.from("chat_participants").upsert(
    { thread_id: ids.threadParticipants, user_id: exec.userId },
    { onConflict: "thread_id,user_id" },
  );
  await admin.from("chat_participants").upsert(
    { thread_id: ids.threadParticipants, user_id: sales.userId },
    { onConflict: "thread_id,user_id" },
  );

  // Department = sales
  ids.threadDeptSales = await insertThread({
    org_id: ctx.org.id,
    title: tagTitle(runId, "department sales"),
    confidentiality_level: 1,
    visibility: "department",
    owner_user_id: sales.userId,
    department_id: sales.departmentId,
    minimum_derived_level: 1,
  });

  // Project membership: only sales
  const { data: project, error: pErr } = await admin
    .from("projects")
    .insert({
      org_id: ctx.org.id,
      name: tagTitle(runId, "project alpha"),
      description: "RLS fixture project",
      visibility: "project",
    })
    .select("id")
    .single();
  if (pErr) throw pErr;
  ids.projectId = project.id;
  await admin.from("project_members").insert({
    project_id: ids.projectId,
    user_id: sales.userId,
    role: "member",
  });

  ids.threadProject = await insertThread({
    org_id: ctx.org.id,
    title: tagTitle(runId, "project visibility"),
    confidentiality_level: 1,
    visibility: "project",
    owner_user_id: sales.userId,
    project_id: ids.projectId,
    department_id: sales.departmentId,
    minimum_derived_level: 1,
  });

  // Restricted owned by sales
  ids.threadRestricted = await insertThread({
    org_id: ctx.org.id,
    title: tagTitle(runId, "restricted sales"),
    confidentiality_level: 1,
    visibility: "restricted",
    owner_user_id: sales.userId,
    department_id: sales.departmentId,
    minimum_derived_level: 1,
  });

  // Private L3 for executive (derived origin)
  ids.threadPrivateExec = await insertThread({
    org_id: ctx.org.id,
    title: tagTitle(runId, "private executive L3"),
    confidentiality_level: 3,
    visibility: "private",
    owner_user_id: exec.userId,
    department_id: exec.departmentId,
    minimum_derived_level: 3,
  });
  await admin.from("chat_participants").upsert(
    { thread_id: ids.threadPrivateExec, user_id: exec.userId },
    { onConflict: "thread_id,user_id" },
  );

  const derivedBase = {
    org_id: ctx.org.id,
    confidentiality_level: 3,
    visibility: "private",
    origin_thread_id: ids.threadPrivateExec,
    security_label_source: "inherited",
    created_by: exec.userId,
  };

  ids.taskDerived = (
    await admin
      .from("tasks")
      .insert({
        ...derivedBase,
        title: tagTitle(runId, "derived task"),
        description: "from private exec thread",
        status: "open",
        minimum_derived_level: 3,
      })
      .select("id")
      .single()
  ).data.id;

  ids.artifactDerived = (
    await admin
      .from("artifacts")
      .insert({
        ...derivedBase,
        title: tagTitle(runId, "derived artifact"),
        format: "markdown",
        project_id: null,
        minimum_derived_level: 3,
      })
      .select("id")
      .single()
  ).data.id;

  ids.researchDerived = (
    await admin
      .from("research_runs")
      .insert({
        ...derivedBase,
        query: tagTitle(runId, "derived research"),
        status: "completed",
      })
      .select("id")
      .single()
  ).data.id;

  const storagePath = `org/${ctx.org.id}/threads/${ids.threadPrivateExec}/${runId}-secret.txt`;
  ids.filePath = storagePath;
  ids.fileBucket = "chat-attachments";

  ids.fileDerived = (
    await admin
      .from("file_objects")
      .insert({
        org_id: ctx.org.id,
        bucket: ids.fileBucket,
        path: storagePath,
        mime_type: "text/plain",
        size_bytes: 12,
        created_by: exec.userId,
        confidentiality_level: 3,
        visibility: "private",
        origin_thread_id: ids.threadPrivateExec,
      })
      .select("id")
      .single()
  ).data.id;

  // Upload storage object via service_role (fixture only)
  const upload = await admin.storage
    .from(ids.fileBucket)
    .upload(storagePath, new Blob(["secret-bytes"]), {
      contentType: "text/plain",
      upsert: true,
    });
  if (upload.error) {
    // Bucket may be missing — record and let storage cases mark carefully
    ids.storageUploadError = upload.error.message;
  } else {
    ids.storageUploaded = true;
  }

  // Audit case fixture (separate path from chat_threads SELECT)
  const { data: auditCase, error: aErr } = await admin
    .from("conversation_audit_cases")
    .insert({
      org_id: ctx.org.id,
      reason: tagTitle(runId, "audit case"),
      target_user_id: sales.userId,
      target_thread_id: ids.threadPrivateSales,
      opened_by: adminFix.userId,
    })
    .select("id")
    .single();
  if (aErr) {
    throw new Error(`audit case seed: ${aErr.message}`);
  }
  ids.auditCaseId = auditCase.id;

  // ---- Knowledge hybrid retrieval fixtures ----
  async function seedKnowledgeDoc(opts) {
    const { data: source, error: sErr } = await admin
      .from("knowledge_sources")
      .insert({
        org_id: ctx.org.id,
        name: tagTitle(runId, opts.sourceName ?? "source"),
        source_type: opts.sourceType ?? "manual",
      })
      .select("id")
      .single();
    if (sErr) throw new Error(`knowledge source: ${sErr.message}`);

    const { data: doc, error: dErr } = await admin
      .from("knowledge_documents")
      .insert({
        org_id: ctx.org.id,
        source_id: source.id,
        title: tagTitle(runId, opts.title),
        status: opts.status ?? "published",
        content_hash: `hash-${opts.title}`,
        confidentiality_level: opts.level ?? 1,
        visibility: opts.visibility ?? "organization",
        owner_user_id: opts.ownerUserId ?? exec.userId,
        department_id: opts.departmentId ?? null,
        project_id: opts.projectId ?? null,
        source_type: opts.sourceType ?? "manual",
        contains_personal_conversation: opts.personal ?? false,
        published_at:
          opts.status === "draft" || opts.status === "review"
            ? null
            : new Date().toISOString(),
      })
      .select("id")
      .single();
    if (dErr) throw new Error(`knowledge doc: ${dErr.message}`);

    const { data: ver, error: vErr } = await admin
      .from("knowledge_document_versions")
      .insert({
        document_id: doc.id,
        version_number: 1,
        body: opts.body,
        created_by: exec.userId,
      })
      .select("id")
      .single();
    if (vErr) throw new Error(`knowledge version: ${vErr.message}`);

    const { data: chunk, error: cErr } = await admin
      .from("knowledge_chunks")
      .insert({
        document_version_id: ver.id,
        document_id: doc.id,
        org_id: ctx.org.id,
        chunk_index: 0,
        content: opts.body,
        content_normalized: opts.body,
        content_hash: `chunk-${opts.title}`,
        confidentiality_level: opts.level ?? 1,
        visibility: opts.visibility ?? "organization",
        owner_user_id: opts.ownerUserId ?? exec.userId,
        department_id: opts.departmentId ?? null,
        project_id: opts.projectId ?? null,
        source_type: opts.sourceType ?? "manual",
        contains_personal_conversation: opts.personal ?? false,
        embedding: opts.embedding ?? null,
        embedding_dimensions: opts.embedding ? 384 : null,
        embedding_model: opts.embedding ? "rls-fixture-unit" : null,
        embedding_version: opts.embedding ? "test" : null,
      })
      .select("id")
      .single();
    if (cErr) throw new Error(`knowledge chunk: ${cErr.message}`);
    return { documentId: doc.id, chunkId: chunk.id, versionId: ver.id };
  }

  const unitEmbed = Array.from({ length: 384 }, (_, i) => (i === 0 ? 1 : 0));

  ids.knowledgeL1 = await seedKnowledgeDoc({
    title: "knowledge L1 org 就業規則",
    body: "就業規則では始業は午前九時です。休憩は一時間です。",
    level: 1,
    visibility: "organization",
    embedding: unitEmbed,
  });
  ids.knowledgeL2 = await seedKnowledgeDoc({
    title: "knowledge L2 org 人事評価",
    body: "人事評価プロセスは四半期ごとに実施します。",
    level: 2,
    visibility: "organization",
  });
  ids.knowledgeL3 = await seedKnowledgeDoc({
    title: "knowledge L3 org 経営戦略",
    body: "経営戦略の資金計画は非公開です。",
    level: 3,
    visibility: "organization",
  });
  ids.knowledgeDraft = await seedKnowledgeDoc({
    title: "knowledge draft 未公開",
    body: "これは下書きのため検索対象外です。",
    status: "draft",
    level: 1,
  });
  ids.knowledgePersonal = await seedKnowledgeDoc({
    title: "knowledge personal conversation",
    body: "個人会話から抽出したプライベート内容です。",
    level: 1,
    personal: true,
  });
  ids.knowledgeDept = await seedKnowledgeDoc({
    title: "knowledge department sales",
    body: "営業部のみが参照する提案テンプレートです。",
    level: 1,
    visibility: "department",
    departmentId: sales.departmentId,
    ownerUserId: sales.userId,
  });
  ids.knowledgeProject = await seedKnowledgeDoc({
    title: "knowledge project alpha",
    body: "プロジェクト限定の納品チェックリストです。",
    level: 1,
    visibility: "project",
    projectId: ids.projectId,
    ownerUserId: sales.userId,
  });

  return {
    admin,
    ctx,
    users,
    ids,
    runId,
    password,
  };
}

/**
 * Cleanup only fixture-tagged rows and fixture auth users.
 */
export async function cleanupFixtures({ admin, ctx, users, ids, runId }) {
  const orgId = ctx.org.id;
  const prefix = `[${FIXTURE_TAG}:${runId}]`;

  // Storage first
  if (ids.filePath) {
    await admin.storage.from(ids.fileBucket || "chat-attachments").remove([
      ids.filePath,
    ]);
  }

  // Soft-delete / hard-delete tagged domain rows
  const { data: threads } = await admin
    .from("chat_threads")
    .select("id")
    .eq("org_id", orgId)
    .like("title", `${prefix}%`);
  const tid = (threads ?? []).map((t) => t.id);

  if (tid.length) {
    await admin.from("chat_messages").delete().in("thread_id", tid);
    await admin.from("chat_participants").delete().in("thread_id", tid);
  }

  await admin
    .from("file_objects")
    .delete()
    .eq("org_id", orgId)
    .like("path", `%/${runId}-%`);

  await admin
    .from("research_runs")
    .delete()
    .eq("org_id", orgId)
    .like("query", `${prefix}%`);
  await admin
    .from("artifacts")
    .delete()
    .eq("org_id", orgId)
    .like("title", `${prefix}%`);
  await admin
    .from("tasks")
    .delete()
    .eq("org_id", orgId)
    .like("title", `${prefix}%`);
  await admin
    .from("conversation_audit_cases")
    .delete()
    .eq("org_id", orgId)
    .like("reason", `${prefix}%`);

  // Knowledge fixtures
  const { data: kdocs } = await admin
    .from("knowledge_documents")
    .select("id, source_id")
    .eq("org_id", orgId)
    .like("title", `${prefix}%`);
  const kid = (kdocs ?? []).map((d) => d.id);
  const ksrc = [...new Set((kdocs ?? []).map((d) => d.source_id).filter(Boolean))];
  if (kid.length) {
    await admin.from("knowledge_chunks").delete().in("document_id", kid);
    await admin.from("knowledge_document_versions").delete().in("document_id", kid);
    await admin.from("knowledge_approvals").delete().in("document_id", kid);
    await admin.from("knowledge_revisions").delete().in("document_id", kid);
    await admin.from("knowledge_documents").delete().in("id", kid);
  }
  if (ksrc.length) {
    await admin.from("knowledge_sources").delete().in("id", ksrc);
  }

  await admin
    .from("chat_threads")
    .delete()
    .eq("org_id", orgId)
    .like("title", `${prefix}%`);

  const { data: projects } = await admin
    .from("projects")
    .select("id")
    .eq("org_id", orgId)
    .like("name", `${prefix}%`);
  const pids = (projects ?? []).map((p) => p.id);
  if (pids.length) {
    await admin.from("project_members").delete().in("project_id", pids);
    await admin.from("projects").delete().in("id", pids);
  }

  // Remove fixture memberships + auth users (not bootstrap admin)
  for (const u of Object.values(users)) {
    if (u.membershipId) {
      await admin.from("membership_roles").delete().eq("membership_id", u.membershipId);
      await admin.from("organization_memberships").delete().eq("id", u.membershipId);
    }
    await admin
      .from("organization_memberships")
      .delete()
      .eq("user_id", u.userId)
      .eq("org_id", orgId);
    await admin.from("profiles").delete().eq("user_id", u.userId);
    await admin.auth.admin.deleteUser(u.userId);
  }
}
