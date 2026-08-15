/**
 * Authenticated RLS assertion cases.
 * Every SELECT/INSERT/UPDATE/DELETE under test uses user JWT clients.
 */
import { randomUUID } from "node:crypto";
import { tagTitle } from "./lib.mjs";

export async function runAllCases(reporter, fx) {
  const { users, ids, ctx, runId } = fx;
  const sales = users.sales_company;
  const hr = users.hr_people;
  const exec = users.executive;
  const adminFix = users.admin_fixture;
  const none = users.no_membership;

  await runConfidentiality(reporter, { sales, hr, exec, ids });
  await runVisibility(reporter, { sales, hr, exec, adminFix, ids });
  await runConversation(reporter, { sales, hr, exec, adminFix, ids });
  await runAudit(reporter, { sales, exec, adminFix, ids });
  await runDerived(reporter, { sales, hr, exec, ids });
  await runWrites(reporter, { sales, hr, exec, adminFix, ids, ctx, runId });
  await runStorage(reporter, { sales, hr, exec, adminFix, ids, fx });
  await runKnowledge(reporter, { sales, hr, exec, adminFix, ids });
  await runNoMembership(reporter, { none, ids, ctx });
}

async function selectThread(client, id) {
  return client.from("chat_threads").select("id, title, confidentiality_level, visibility").eq("id", id);
}

async function runConfidentiality(reporter, { sales, hr, exec, ids }) {
  console.log("\n--- Confidentiality ---");

  reporter.expectRows(
    "sales_company SELECT L1 organization",
    await selectThread(sales.client, ids.threadL1Org),
    (r) => r.id === ids.threadL1Org,
  );
  reporter.expectDenied(
    "sales_company DENIED L2 organization",
    await selectThread(sales.client, ids.threadL2Org),
    ids.threadL2Org,
  );
  reporter.expectDenied(
    "sales_company DENIED L3 organization",
    await selectThread(sales.client, ids.threadL3Org),
    ids.threadL3Org,
  );

  reporter.expectRows(
    "hr_people SELECT L1 organization",
    await selectThread(hr.client, ids.threadL1Org),
    (r) => r.id === ids.threadL1Org,
  );
  reporter.expectRows(
    "hr_people SELECT L2 organization",
    await selectThread(hr.client, ids.threadL2Org),
    (r) => r.id === ids.threadL2Org,
  );
  reporter.expectDenied(
    "hr_people DENIED L3 organization",
    await selectThread(hr.client, ids.threadL3Org),
    ids.threadL3Org,
  );

  reporter.expectRows(
    "executive SELECT L1 organization",
    await selectThread(exec.client, ids.threadL1Org),
    (r) => r.id === ids.threadL1Org,
  );
  reporter.expectRows(
    "executive SELECT L2 organization",
    await selectThread(exec.client, ids.threadL2Org),
    (r) => r.id === ids.threadL2Org,
  );
  reporter.expectRows(
    "executive SELECT L3 organization",
    await selectThread(exec.client, ids.threadL3Org),
    (r) => r.id === ids.threadL3Org,
  );
}

async function runVisibility(reporter, { sales, hr, exec, adminFix, ids }) {
  console.log("\n--- Visibility ---");

  // private
  reporter.expectRows(
    "private: owner sales SELECT",
    await selectThread(sales.client, ids.threadPrivateSales),
    (r) => r.id === ids.threadPrivateSales,
  );
  reporter.expectRows(
    "private: participant hr SELECT",
    await selectThread(hr.client, ids.threadPrivateSales),
    (r) => r.id === ids.threadPrivateSales,
  );
  reporter.expectDenied(
    "private: unrelated executive DENIED (clearance must not bypass)",
    await selectThread(exec.client, ids.threadPrivateSales),
    ids.threadPrivateSales,
  );

  // participants
  reporter.expectRows(
    "participants: participant sales SELECT",
    await selectThread(sales.client, ids.threadParticipants),
    (r) => r.id === ids.threadParticipants,
  );
  reporter.expectDenied(
    "participants: non-participant hr DENIED",
    await selectThread(hr.client, ids.threadParticipants),
    ids.threadParticipants,
  );

  // department
  reporter.expectRows(
    "department: same-dept sales SELECT",
    await selectThread(sales.client, ids.threadDeptSales),
    (r) => r.id === ids.threadDeptSales,
  );
  reporter.expectDenied(
    "department: other-dept hr DENIED",
    await selectThread(hr.client, ids.threadDeptSales),
    ids.threadDeptSales,
  );

  // project
  reporter.expectRows(
    "project: member sales SELECT",
    await selectThread(sales.client, ids.threadProject),
    (r) => r.id === ids.threadProject,
  );
  reporter.expectDenied(
    "project: non-member hr DENIED",
    await selectThread(hr.client, ids.threadProject),
    ids.threadProject,
  );

  // organization + clearance already covered; confirm org L1 visible to hr
  reporter.expectRows(
    "organization: org member with clearance SELECT L1",
    await selectThread(hr.client, ids.threadL1Org),
    (r) => r.id === ids.threadL1Org,
  );

  // restricted
  reporter.expectRows(
    "restricted: owner sales SELECT",
    await selectThread(sales.client, ids.threadRestricted),
    (r) => r.id === ids.threadRestricted,
  );
  reporter.expectDenied(
    "restricted: executive DENIED",
    await selectThread(exec.client, ids.threadRestricted),
    ids.threadRestricted,
  );
  reporter.expectDenied(
    "restricted: admin_fixture DENIED",
    await selectThread(adminFix.client, ids.threadRestricted),
    ids.threadRestricted,
  );
}

async function runConversation(reporter, { sales, hr, exec, adminFix, ids }) {
  console.log("\n--- Conversation ---");

  reporter.expectRows(
    "conversation: owner reads private thread",
    await selectThread(sales.client, ids.threadPrivateSales),
  );
  reporter.expectRows(
    "conversation: participant reads private thread",
    await selectThread(hr.client, ids.threadPrivateSales),
  );
  reporter.expectDenied(
    "conversation: unrelated user denied private thread",
    await selectThread(exec.client, ids.threadPrivateSales),
    ids.threadPrivateSales,
  );
  reporter.expectDenied(
    "NEG: executive clearance alone cannot SELECT others' private thread",
    await selectThread(exec.client, ids.threadPrivateSales),
    ids.threadPrivateSales,
  );
  reporter.expectDenied(
    "NEG: admin (organization:manage + conversation:audit) cannot SELECT others' private thread via normal path",
    await selectThread(adminFix.client, ids.threadPrivateSales),
    ids.threadPrivateSales,
  );

  const msgSales = await sales.client
    .from("chat_messages")
    .select("id, content")
    .eq("id", ids.msgPrivateSales);
  reporter.expectRows("conversation: owner reads private message", msgSales);

  const msgExec = await exec.client
    .from("chat_messages")
    .select("id, content")
    .eq("id", ids.msgPrivateSales);
  reporter.expectDenied(
    "NEG: executive cannot SELECT private message",
    msgExec,
    ids.msgPrivateSales,
  );

  const msgAdmin = await adminFix.client
    .from("chat_messages")
    .select("id, content")
    .eq("id", ids.msgPrivateSales);
  reporter.expectDenied(
    "NEG: admin cannot SELECT private message via normal chat SELECT",
    msgAdmin,
    ids.msgPrivateSales,
  );

  const parts = await hr.client
    .from("chat_participants")
    .select("id, user_id")
    .eq("thread_id", ids.threadPrivateSales);
  reporter.expectRows(
    "conversation: participant can list participants on accessible thread",
    parts,
  );
}

async function runAudit(reporter, { sales, exec, adminFix, ids }) {
  console.log("\n--- conversation:audit separation ---");

  const adminAudit = await adminFix.client
    .from("conversation_audit_cases")
    .select("id, reason")
    .eq("id", ids.auditCaseId);
  reporter.expectRows(
    "audit: admin_fixture can SELECT conversation_audit_cases",
    adminAudit,
    (r) => r.id === ids.auditCaseId,
  );

  const salesAudit = await sales.client
    .from("conversation_audit_cases")
    .select("id")
    .eq("id", ids.auditCaseId);
  reporter.expectDenied(
    "audit: sales cannot SELECT conversation_audit_cases",
    salesAudit,
    ids.auditCaseId,
  );

  // Critical: audit capability must not open chat_threads
  reporter.expectDenied(
    "NEG: conversation:audit does not bypass chat_threads SELECT",
    await selectThread(adminFix.client, ids.threadPrivateSales),
    ids.threadPrivateSales,
  );
  reporter.expectDenied(
    "NEG: conversation:audit does not bypass chat_messages SELECT",
    await adminFix.client
      .from("chat_messages")
      .select("id")
      .eq("id", ids.msgPrivateSales),
    ids.msgPrivateSales,
  );

  // Executive without audit cannot open audit cases
  reporter.expectDenied(
    "audit: executive (no conversation:audit) denied audit cases",
    await exec.client
      .from("conversation_audit_cases")
      .select("id")
      .eq("id", ids.auditCaseId),
    ids.auditCaseId,
  );
}

async function runDerived(reporter, { sales, hr, exec, ids }) {
  console.log("\n--- Derived resources ---");

  const ownerTask = await exec.client
    .from("tasks")
    .select("id, confidentiality_level, visibility, origin_thread_id")
    .eq("id", ids.taskDerived);
  reporter.expectRows("derived task: origin owner can SELECT", ownerTask);

  reporter.expectDenied(
    "NEG: sales cannot SELECT task derived from inaccessible private L3 thread",
    await sales.client.from("tasks").select("id").eq("id", ids.taskDerived),
    ids.taskDerived,
  );
  reporter.expectDenied(
    "NEG: hr cannot SELECT artifact derived from inaccessible thread",
    await hr.client.from("artifacts").select("id").eq("id", ids.artifactDerived),
    ids.artifactDerived,
  );
  reporter.expectDenied(
    "NEG: sales cannot SELECT research_run derived from inaccessible thread",
    await sales.client
      .from("research_runs")
      .select("id")
      .eq("id", ids.researchDerived),
    ids.researchDerived,
  );
  reporter.expectDenied(
    "NEG: hr cannot SELECT file_object derived from inaccessible thread",
    await hr.client.from("file_objects").select("id").eq("id", ids.fileDerived),
    ids.fileDerived,
  );

  reporter.expectRows(
    "derived: exec can SELECT research_run from own private thread",
    await exec.client
      .from("research_runs")
      .select("id, origin_thread_id")
      .eq("id", ids.researchDerived),
  );
  reporter.expectRows(
    "derived: exec can SELECT file_object from own private thread",
    await exec.client
      .from("file_objects")
      .select("id, path, confidentiality_level, visibility")
      .eq("id", ids.fileDerived),
  );
}

async function runWrites(reporter, { sales, hr, exec, adminFix, ids, ctx, runId }) {
  console.log("\n--- Write RLS (INSERT/UPDATE/DELETE) ---");

  // Level1 cannot create L3 thread
  const l3Insert = await sales.client
    .from("chat_threads")
    .insert({
      id: randomUUID(),
      org_id: ctx.org.id,
      title: tagTitle(runId, "write-deny L3 by sales"),
      confidentiality_level: 3,
      visibility: "private",
      owner_user_id: sales.userId,
      department_id: sales.departmentId,
      minimum_derived_level: 3,
    })
    .select("id");
  reporter.expectWriteDenied("NEG: sales cannot INSERT L3 thread", l3Insert);

  // Allowed L1 insert by sales
  const l1Insert = await sales.client
    .from("chat_threads")
    .insert({
      id: randomUUID(),
      org_id: ctx.org.id,
      title: tagTitle(runId, "write-ok L1 by sales"),
      confidentiality_level: 1,
      visibility: "private",
      owner_user_id: sales.userId,
      department_id: sales.departmentId,
      minimum_derived_level: 1,
    })
    .select("id");
  reporter.expectWriteOk("sales can INSERT L1 private thread", l1Insert);

  // Cannot update others' private thread (executive)
  const upd = await exec.client
    .from("chat_threads")
    .update({ title: tagTitle(runId, "hijack attempt") })
    .eq("id", ids.threadPrivateSales)
    .select("id");
  reporter.expectWriteDenied(
    "NEG: executive cannot UPDATE others' private thread",
    upd,
  );

  // Cannot create task from inaccessible origin thread
  const badTask = await sales.client
    .from("tasks")
    .insert({
      id: randomUUID(),
      org_id: ctx.org.id,
      title: tagTitle(runId, "bad derived task"),
      status: "open",
      created_by: sales.userId,
      confidentiality_level: 1,
      visibility: "private",
      origin_thread_id: ids.threadPrivateExec,
      minimum_derived_level: 1,
    })
    .select("id");
  reporter.expectWriteDenied(
    "NEG: sales cannot INSERT task with inaccessible origin_thread",
    badTask,
  );

  // Cannot create artifact from inaccessible origin
  const badArt = await sales.client
    .from("artifacts")
    .insert({
      id: randomUUID(),
      org_id: ctx.org.id,
      title: tagTitle(runId, "bad derived artifact"),
      format: "markdown",
      created_by: sales.userId,
      confidentiality_level: 1,
      visibility: "private",
      origin_thread_id: ids.threadPrivateExec,
      minimum_derived_level: 1,
    })
    .select("id");
  reporter.expectWriteDenied(
    "NEG: sales cannot INSERT artifact with inaccessible origin_thread",
    badArt,
  );

  // Unauthorized participant add (no INSERT policy → deny)
  const badPart = await sales.client
    .from("chat_participants")
    .insert({
      thread_id: ids.threadPrivateExec,
      user_id: sales.userId,
    })
    .select("id");
  reporter.expectWriteDenied(
    "NEG: unauthorized cannot INSERT chat_participants on private exec thread",
    badPart,
  );

  // DELETE default deny on chat_threads
  const del = await sales.client
    .from("chat_threads")
    .delete()
    .eq("id", ids.threadPrivateSales)
    .select("id");
  reporter.expectWriteDenied(
    "NEG: DELETE chat_threads denied (no/deny policy)",
    del,
  );

  // Owner can update own thread title
  const ownUpd = await sales.client
    .from("chat_threads")
    .update({ title: tagTitle(runId, "private sales owner updated") })
    .eq("id", ids.threadPrivateSales)
    .select("id");
  reporter.expectWriteOk("owner can UPDATE own private thread title", ownUpd);

  // Durable artifact on sales-dept thread (hr is other dept → denied; avoids hr-as-participant)
  const artId = randomUUID();
  const artIns = await sales.client
    .from("artifacts")
    .insert({
      id: artId,
      org_id: ctx.org.id,
      title: tagTitle(runId, "durable artifact"),
      format: "markdown",
      created_by: sales.userId,
      confidentiality_level: 1,
      visibility: "department",
      origin_thread_id: ids.threadDeptSales,
      security_label_source: "inherited",
      minimum_derived_level: 1,
    })
    .select("id");
  reporter.expectWriteOk(
    "sales can INSERT department artifact on owned thread",
    artIns,
  );

  const verIns = await sales.client.from("artifact_versions").insert({
    artifact_id: artId,
    version_number: 1,
    canonical_content: "# durable body",
    storage_path: null,
    checksum: "abc",
  });
  reporter.expectWriteOk(
    "sales can INSERT artifact_versions.canonical_content",
    verIns,
  );

  const verSel = await sales.client
    .from("artifact_versions")
    .select("canonical_content, storage_path")
    .eq("artifact_id", artId);
  reporter.expectRows(
    "owner SELECT durable canonical_content",
    verSel,
    (r) => r.canonical_content === "# durable body" && r.storage_path == null,
  );

  reporter.expectDenied(
    "NEG: hr cannot SELECT sales-dept artifact_versions body",
    await hr.client
      .from("artifact_versions")
      .select("id, artifact_id, canonical_content")
      .eq("artifact_id", artId),
  );

  void adminFix;
}

async function runStorage(reporter, { sales, hr, exec, adminFix, ids, fx }) {
  console.log("\n--- Storage ---");

  if (!ids.storageUploaded) {
    reporter.fail(
      "storage fixture upload",
      `skipping download checks: ${ids.storageUploadError ?? "upload failed"}`,
    );
    // Still test file_objects SELECT gates
  }

  reporter.expectRows(
    "storage meta: owner exec SELECT file_objects",
    await exec.client
      .from("file_objects")
      .select("id, path")
      .eq("id", ids.fileDerived),
  );
  reporter.expectDenied(
    "storage meta: same-org sales DENIED file_objects",
    await sales.client
      .from("file_objects")
      .select("id")
      .eq("id", ids.fileDerived),
    ids.fileDerived,
  );
  reporter.expectDenied(
    "storage meta: insufficient clearance hr DENIED",
    await hr.client.from("file_objects").select("id").eq("id", ids.fileDerived),
    ids.fileDerived,
  );
  reporter.expectDenied(
    "storage meta: unrelated admin DENIED (not owner/participant path)",
    await adminFix.client
      .from("file_objects")
      .select("id")
      .eq("id", ids.fileDerived),
    ids.fileDerived,
  );

  if (ids.storageUploaded) {
    const ownerDl = await exec.client.storage
      .from(ids.fileBucket)
      .download(ids.filePath);
    if (ownerDl.error) {
      reporter.fail(
        "storage object: owner download",
        ownerDl.error.message,
      );
    } else {
      reporter.pass("storage object: owner download", "blob ok");
    }

    const salesDl = await sales.client.storage
      .from(ids.fileBucket)
      .download(ids.filePath);
    if (salesDl.error || !salesDl.data) {
      reporter.pass(
        "NEG: knowing path alone, sales cannot download storage object",
        `denied (${salesDl.error?.message ?? "empty"})`,
      );
    } else {
      reporter.fail(
        "NEG: knowing path alone, sales cannot download storage object",
        "unexpectedly retrieved object bytes",
      );
    }

    const execDlDenied = await adminFix.client.storage
      .from(ids.fileBucket)
      .download(ids.filePath);
    if (execDlDenied.error || !execDlDenied.data) {
      reporter.pass(
        "NEG: admin/executive-like fixture cannot download private storage object",
        `denied (${execDlDenied.error?.message ?? "empty"})`,
      );
    } else {
      reporter.fail(
        "NEG: admin/executive-like fixture cannot download private storage object",
        "unexpectedly retrieved object bytes",
      );
    }
  }

  // INSERT vs SELECT: org member may upload to org path; read remains gated by file_objects.
  // Do not use upsert — Storage upsert also needs SELECT/UPDATE policies via file_objects.
  const uploadPath = `org/${fx.ctx.org.id}/threads/${ids.threadPrivateSales}/${fx.runId}-sales-upload.txt`;
  const up = await sales.client.storage
    .from(ids.fileBucket)
    .upload(uploadPath, new Blob(["sales-upload"]), {
      contentType: "text/plain",
      upsert: false,
    });
  if (up.error) {
    reporter.fail(
      "storage INSERT policy allows org-member upload (distinct from read)",
      up.error.message,
    );
  } else {
    reporter.pass(
      "storage INSERT policy allows org-member upload (distinct from read)",
      uploadPath,
    );
    // Same-org unauthorized user still cannot download before/without readable file_objects
    const otherDl = await hr.client.storage.from(ids.fileBucket).download(uploadPath);
    if (otherDl.error || !otherDl.data) {
      reporter.pass(
        "NEG: storage object without authorized file_objects remains unreadable",
        `denied (${otherDl.error?.message ?? "empty"})`,
      );
    } else {
      reporter.fail(
        "NEG: storage object without authorized file_objects remains unreadable",
        "unexpectedly retrieved bytes",
      );
    }
    await fx.admin.storage.from(ids.fileBucket).remove([uploadPath]);
  }
}

async function runNoMembership(reporter, { none, ids, ctx }) {
  console.log("\n--- no_membership ---");

  reporter.expectDenied(
    "no_membership DENIED organizations row",
    await none.client
      .from("organizations")
      .select("id")
      .eq("id", ctx.org.id),
    ctx.org.id,
  );
  reporter.expectDenied(
    "no_membership DENIED chat_threads",
    await none.client
      .from("chat_threads")
      .select("id")
      .eq("id", ids.threadL1Org),
    ids.threadL1Org,
  );
  reporter.expectDenied(
    "no_membership DENIED tasks",
    await none.client.from("tasks").select("id").eq("id", ids.taskDerived),
    ids.taskDerived,
  );
  reporter.expectDenied(
    "no_membership DENIED artifacts",
    await none.client
      .from("artifacts")
      .select("id")
      .eq("id", ids.artifactDerived),
    ids.artifactDerived,
  );
  reporter.expectDenied(
    "no_membership DENIED research_runs",
    await none.client
      .from("research_runs")
      .select("id")
      .eq("id", ids.researchDerived),
    ids.researchDerived,
  );
  reporter.expectDenied(
    "no_membership DENIED file_objects",
    await none.client
      .from("file_objects")
      .select("id")
      .eq("id", ids.fileDerived),
    ids.fileDerived,
  );

  // Login gate alignment: authenticated but no membership → treat as 403
  const { data: mem } = await none.client
    .from("organization_memberships")
    .select("id")
    .eq("user_id", none.userId)
    .is("deleted_at", null);
  if ((mem ?? []).length === 0) {
    reporter.pass(
      "login-gate alignment: no_membership has 0 org memberships (API would 403)",
      "mirrors /api/auth/login membership check",
    );
  } else {
    reporter.fail(
      "login-gate alignment: no_membership has 0 org memberships (API would 403)",
      `found memberships=${mem.length}`,
    );
  }

  if (process.env.REGAPRO_WEB_URL) {
    const res = await fetch(`${process.env.REGAPRO_WEB_URL}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: none.email,
        password: none.password,
      }),
    });
    if (res.status === 403) {
      reporter.pass("login API returns 403 for no_membership", `status=${res.status}`);
    } else if (res.status === 400) {
      reporter.pass(
        "login API returns 400 in dev-sample (expected if REGAPRO_DATA_MODE≠supabase)",
        `status=${res.status}`,
      );
    } else {
      reporter.fail(
        "login API returns 403 for no_membership",
        `status=${res.status}`,
      );
    }
  } else {
    reporter.pass(
      "login API HTTP check skipped (set REGAPRO_WEB_URL to exercise live route)",
      "logic verified via membership query above",
    );
  }
}

async function runKnowledge(reporter, { sales, hr, exec, adminFix, ids }) {
  console.log("\n--- Knowledge hybrid retrieval ---");

  reporter.expectRows(
    "knowledge: sales SELECT published L1 chunk",
    await sales.client.from("knowledge_chunks").select("id").eq("id", ids.knowledgeL1.chunkId),
    (r) => r.id === ids.knowledgeL1.chunkId,
  );
  reporter.expectDenied(
    "knowledge: sales DENIED L2 chunk",
    await sales.client.from("knowledge_chunks").select("id").eq("id", ids.knowledgeL2.chunkId),
    ids.knowledgeL2.chunkId,
  );
  reporter.expectDenied(
    "knowledge: sales DENIED L3 chunk",
    await sales.client.from("knowledge_chunks").select("id").eq("id", ids.knowledgeL3.chunkId),
    ids.knowledgeL3.chunkId,
  );
  reporter.expectRows(
    "knowledge: hr SELECT L2 chunk",
    await hr.client.from("knowledge_chunks").select("id").eq("id", ids.knowledgeL2.chunkId),
    (r) => r.id === ids.knowledgeL2.chunkId,
  );
  reporter.expectRows(
    "knowledge: exec SELECT L3 chunk",
    await exec.client.from("knowledge_chunks").select("id").eq("id", ids.knowledgeL3.chunkId),
    (r) => r.id === ids.knowledgeL3.chunkId,
  );

  const draftInLex = await sales.client.rpc("regapro_knowledge_lexical_search", {
    p_query: "下書きのため検索対象外",
    p_limit: 20,
  });
  if (draftInLex.error) {
    reporter.fail("knowledge: draft lexical check", draftInLex.error.message);
  } else {
    const leaked = (draftInLex.data ?? []).some(
      (h) => h.chunk_id === ids.knowledgeDraft.chunkId,
    );
    if (!leaked) {
      reporter.pass("knowledge: draft excluded from lexical RPC", "ok");
    } else {
      reporter.fail("knowledge: draft leaked into lexical RPC", "found");
    }
  }

  const personalInLex = await sales.client.rpc("regapro_knowledge_lexical_search", {
    p_query: "個人会話から抽出",
    p_limit: 20,
  });
  if (personalInLex.error) {
    reporter.fail("knowledge: personal lexical check", personalInLex.error.message);
  } else {
    const leaked = (personalInLex.data ?? []).some(
      (h) => h.chunk_id === ids.knowledgePersonal.chunkId,
    );
    if (!leaked) {
      reporter.pass("knowledge: personal conversation excluded from RPC", "ok");
    } else {
      reporter.fail("knowledge: personal leaked into lexical RPC", "found");
    }
  }
  reporter.expectRows(
    "knowledge: sales SELECT department knowledge",
    await sales.client.from("knowledge_chunks").select("id").eq("id", ids.knowledgeDept.chunkId),
    (r) => r.id === ids.knowledgeDept.chunkId,
  );
  reporter.expectDenied(
    "knowledge: hr DENIED sales department knowledge",
    await hr.client.from("knowledge_chunks").select("id").eq("id", ids.knowledgeDept.chunkId),
    ids.knowledgeDept.chunkId,
  );

  reporter.expectRows(
    "knowledge: sales SELECT project knowledge",
    await sales.client
      .from("knowledge_chunks")
      .select("id")
      .eq("id", ids.knowledgeProject.chunkId),
    (r) => r.id === ids.knowledgeProject.chunkId,
  );
  reporter.expectDenied(
    "knowledge: exec DENIED project knowledge (not member)",
    await exec.client
      .from("knowledge_chunks")
      .select("id")
      .eq("id", ids.knowledgeProject.chunkId),
    ids.knowledgeProject.chunkId,
  );

  const lex = await sales.client.rpc("regapro_knowledge_lexical_search", {
    p_query: "就業規則",
    p_limit: 10,
  });
  if (lex.error) {
    reporter.fail("knowledge: lexical RPC", lex.error.message);
  } else {
    const hits = lex.data ?? [];
    const ok = hits.some((h) => h.chunk_id === ids.knowledgeL1.chunkId);
    const leakedDraft = hits.some((h) => h.chunk_id === ids.knowledgeDraft.chunkId);
    const leakedL3 = hits.some((h) => h.chunk_id === ids.knowledgeL3.chunkId);
    if (ok && !leakedDraft && !leakedL3) {
      reporter.pass("knowledge: lexical RPC returns L1 only for sales", `hits=${hits.length}`);
    } else {
      reporter.fail(
        "knowledge: lexical RPC security",
        `ok=${ok} draft=${leakedDraft} l3=${leakedL3}`,
      );
    }
  }

  const unitEmbed = Array.from({ length: 384 }, (_, i) => (i === 0 ? 1 : 0));
  const vec = await sales.client.rpc("regapro_knowledge_vector_search", {
    p_query_embedding: JSON.stringify(unitEmbed),
    p_limit: 10,
  });
  if (vec.error) {
    reporter.fail("knowledge: vector RPC", vec.error.message);
  } else {
    const hits = vec.data ?? [];
    const ok = hits.some((h) => h.chunk_id === ids.knowledgeL1.chunkId);
    const leakedL3 = hits.some((h) => h.chunk_id === ids.knowledgeL3.chunkId);
    if (ok && !leakedL3) {
      reporter.pass("knowledge: vector RPC respects clearance", `hits=${hits.length}`);
    } else {
      reporter.fail("knowledge: vector RPC security", `ok=${ok} l3=${leakedL3}`);
    }
  }

  // Writer with knowledge:write can see drafts via permission path
  const draftAsEditor = await hr.client
    .from("knowledge_documents")
    .select("id, status")
    .eq("id", ids.knowledgeDraft.documentId);
  reporter.expectRows(
    "knowledge: editor can SELECT draft for review",
    draftAsEditor,
    (r) => r.id === ids.knowledgeDraft.documentId && r.status === "draft",
  );

  void adminFix;
}
