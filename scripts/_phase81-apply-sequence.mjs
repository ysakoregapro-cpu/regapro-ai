/**
 * Phase 8.1 apply sequence: fail-after, apply, rerun for expense+sales.
 * Writes summary to tmp/legacy-import/apply-sequence.json (no PII bodies).
 */
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { loadEnvFiles, requireEnv } from "./rls-integration/lib.mjs";

loadEnvFiles();
const { url, secret } = requireEnv();
const db = createClient(url, secret, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const ORG = "d381bef7-768a-4325-a21e-f0b606e67ec2";

async function counts() {
  const tables = [
    "expense_applications",
    "personal_sales_cases",
    "migration_source_records",
    "migration_identity_matches",
    "expense_categories",
    "migration_errors",
    "migration_import_batches",
    "expense_events",
    "personal_sales_allocations",
  ];
  const out = {};
  for (const t of tables) {
    const { count, error } = await db.from(t).select("*", { count: "exact", head: true });
    out[t] = error ? error.message : count;
  }
  return out;
}

function run(args) {
  const r = spawnSync(process.execPath, ["scripts/legacy-expense-sales-import.mjs", ...args], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  let parsed = null;
  try {
    parsed = JSON.parse(r.stdout);
  } catch {
    // keep null
  }
  return {
    code: r.status,
    status: parsed?.status ?? null,
    reason: parsed?.reason ?? null,
    batchId: parsed?.batchId ?? null,
    identity: parsed?.identity ?? null,
    import: parsed?.import ?? null,
    amounts: parsed?.amounts ?? null,
    reconciliation: parsed?.reconciliation ?? null,
    writes: parsed?.writes ?? null,
  };
}

const seq = { before: await counts() };
seq.expense_fail = run([
  "--entity",
  "expense",
  "--org-id",
  ORG,
  "--source-dir",
  "tmp/legacy-import/expense",
  "--apply",
  "--fail-after",
  "3",
]);
seq.after_fail = await counts();
seq.expense_apply = run([
  "--entity",
  "expense",
  "--org-id",
  ORG,
  "--source-dir",
  "tmp/legacy-import/expense",
  "--apply",
]);
seq.after_expense_apply = await counts();
seq.expense_rerun = run([
  "--entity",
  "expense",
  "--org-id",
  ORG,
  "--source-dir",
  "tmp/legacy-import/expense",
  "--apply",
]);
seq.after_expense_rerun = await counts();
seq.sales_apply = run([
  "--entity",
  "sales",
  "--org-id",
  ORG,
  "--source-dir",
  "tmp/legacy-import/sales",
  "--apply",
]);
seq.after_sales_apply = await counts();
seq.sales_rerun = run([
  "--entity",
  "sales",
  "--org-id",
  ORG,
  "--source-dir",
  "tmp/legacy-import/sales",
  "--apply",
]);
seq.after_sales_rerun = await counts();
seq.published = {
  expense_applications: seq.after_sales_rerun.expense_applications,
  personal_sales_cases: seq.after_sales_rerun.personal_sales_cases,
  personal_sales_allocations: seq.after_sales_rerun.personal_sales_allocations,
};
seq.errorGrowthExpenseRerun =
  seq.after_expense_rerun.migration_errors - seq.after_expense_apply.migration_errors;
seq.errorGrowthSalesRerun =
  seq.after_sales_rerun.migration_errors - seq.after_sales_apply.migration_errors;

writeFileSync(
  "tmp/legacy-import/apply-sequence.json",
  `${JSON.stringify(seq, null, 2)}\n`,
  "utf8",
);
console.log(
  JSON.stringify(
    {
      published: seq.published,
      expense_fail: {
        code: seq.expense_fail.code,
        status: seq.expense_fail.status,
        quarantined: seq.expense_fail.import?.quarantined,
        failed: seq.expense_fail.import?.failed,
      },
      expense_apply: {
        imported: seq.expense_apply.import?.imported,
        quarantined: seq.expense_apply.import?.quarantined,
        planned: seq.expense_apply.import?.plannedImport,
      },
      expense_rerun: {
        imported: seq.expense_rerun.import?.imported,
        quarantined: seq.expense_rerun.import?.quarantined,
      },
      sales_apply: {
        imported: seq.sales_apply.import?.imported,
        quarantined: seq.sales_apply.import?.quarantined,
      },
      sales_rerun: {
        imported: seq.sales_rerun.import?.imported,
        quarantined: seq.sales_rerun.import?.quarantined,
      },
      errorGrowthExpenseRerun: seq.errorGrowthExpenseRerun,
      errorGrowthSalesRerun: seq.errorGrowthSalesRerun,
      after_sales_rerun: seq.after_sales_rerun,
    },
    null,
    2,
  ),
);
