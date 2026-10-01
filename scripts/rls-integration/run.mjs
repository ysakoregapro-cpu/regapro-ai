/**
 * Authenticated RLS Integration Test runner.
 *
 * Usage:
 *   npm run db:test-rls
 *   npm run db:test-rls -- --keep-fixtures   # debug: skip cleanup
 *
 * Env:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or ANON_KEY)
 *   SUPABASE_SECRET_KEY (or SERVICE_ROLE_KEY) — fixture setup/cleanup only
 *   RLS_TEST_PASSWORD (optional)
 *   RLS_TEST_EMAIL_DOMAIN (optional, default example.com)
 *   REGAPRO_WEB_URL (optional, for login API 403 check)
 *
 * Does NOT change REGAPRO_DATA_MODE. Does not use service_role for RLS assertions.
 */
import {
  RlsReporter,
  loadEnvFiles,
  newRunId,
  requireEnv,
} from "./lib.mjs";
import { cleanupFixtures, setupFixtures } from "./fixtures.mjs";
import { runAllCases } from "./cases.mjs";
import {
  cleanupPlatformFixtures,
  platformTablesReady,
  runPlatformCases,
  setupPlatformFixtures,
} from "./cases-platform.mjs";
import {
  cleanupShiftFixtures,
  runShiftCases,
  setupShiftFixtures,
  shiftTablesReady,
} from "./cases-shift.mjs";
import {
  cleanupWorkRecordFixtures,
  runWorkRecordCases,
  setupWorkRecordFixtures,
  workRecordTablesReady,
} from "./cases-work-record.mjs";
import { runShiftWorkAclCases } from "./cases-rpc-acl.mjs";
import { runLegacyAclCases } from "./cases-legacy-acl.mjs";
import {
  cleanupWeeklyPayFixtures,
  runWeeklyPayCases,
  setupWeeklyPayFixtures,
  weeklyPayTablesReady,
} from "./cases-weekly-pay.mjs";
import {
  cleanupExpenseSalesFixtures,
  expenseSalesTablesReady,
  runExpenseSalesCases,
  setupExpenseSalesFixtures,
} from "./cases-expense-sales.mjs";

async function main() {
  loadEnvFiles();
  const keep = process.argv.includes("--keep-fixtures");
  const env = requireEnv();
  const runId = newRunId();
  const reporter = new RlsReporter();

  console.log("==========================================");
  console.log(" Authenticated RLS Integration Tests");
  console.log(` runId=${runId}`);
  console.log("==========================================\n");

  let fx = null;
  let platform = null;
  let shift = null;
  let workRecord = null;
  let weeklyPay = null;
  let expenseSales = null;
  try {
    console.log("Setting up fixtures (service_role / admin auth)...");
    fx = await setupFixtures({ ...env, runId });
    console.log(
      `Fixtures ready: users=${Object.keys(fx.users).join(", ")} org=${fx.ctx.org.id}`,
    );

    await runAllCases(reporter, fx);

    // Integrated app foundation cases only apply once the additive Phase 1
    // migrations are on the target project.
    const readiness = await platformTablesReady(fx.admin);
    if (readiness.ready) {
      console.log("\nSetting up integrated app foundation fixtures...");
      platform = await setupPlatformFixtures(fx);
      await runPlatformCases(reporter, fx, platform);

      const shiftReady = await shiftTablesReady(fx.admin);
      if (shiftReady.ready) {
        console.log("\nSetting up shift domain fixtures...");
        shift = await setupShiftFixtures(fx, platform);
        await runShiftCases(reporter, fx, shift);
      } else {
        reporter.skip(
          "shift domain cases",
          `table ${shiftReady.missing} not present — apply supabase/migrations/20260925120000_shift_domain_foundation.sql first`,
        );
      }

      const workReady = await workRecordTablesReady(fx.admin);
      if (workReady.ready) {
        console.log("\nSetting up work record / employment terms fixtures...");
        workRecord = await setupWorkRecordFixtures(fx, platform);
        await runWorkRecordCases(reporter, fx, workRecord);
      } else {
        reporter.skip(
          "work record domain cases",
          `table ${workReady.missing} not present — apply supabase/migrations/20260925180000_work_record_employment_terms_foundation.sql first`,
        );
      }

      if (shiftReady.ready && workReady.ready) {
        console.log("\nChecking Phase 2/3 RPC ACL hardening...");
        await runShiftWorkAclCases(reporter, fx, env);
      }

      console.log("\nChecking legacy database ACL hardening...");
      await runLegacyAclCases(reporter, fx, env);

      const weeklyReady = await weeklyPayTablesReady(fx.admin);
      if (weeklyReady.ready && workReady.ready) {
        console.log("\nSetting up weekly pay fixtures...");
        weeklyPay = await setupWeeklyPayFixtures(fx, platform, workRecord);
        console.log("\nChecking Phase 4 weekly pay application...");
        await runWeeklyPayCases(reporter, fx, weeklyPay, env);
      } else if (!weeklyReady.ready) {
        reporter.skip(
          "weekly pay domain cases",
          `table ${weeklyReady.missing} not present — apply supabase/migrations/20261001024933_weekly_pay_application_foundation.sql first`,
        );
      }

      const esReady = await expenseSalesTablesReady(fx.admin);
      if (esReady.ready) {
        console.log("\nSetting up expense / personal sales fixtures...");
        expenseSales = await setupExpenseSalesFixtures(fx, platform);
        console.log("\nChecking Phase 8 expense / personal sales...");
        await runExpenseSalesCases(reporter, fx, platform, expenseSales, env);
      } else {
        reporter.skip(
          "expense / sales domain cases",
          `table ${esReady.missing} not present — apply supabase/migrations/20261001200000_expense_sales_phase8_foundation.sql first`,
        );
      }
    } else {
      reporter.skip(
        "integrated app foundation cases",
        `table ${readiness.missing} not present — apply supabase/migrations/2026082812*.sql first`,
      );
    }
  } catch (err) {
    console.error("\nHarness error:", err?.message ?? err);
    reporter.fail("harness", String(err?.message ?? err));
  } finally {
    if (fx && !keep) {
      console.log("\nCleaning fixture data...");
      try {
        await cleanupExpenseSalesFixtures(fx.admin, expenseSales);
        await cleanupWeeklyPayFixtures(fx.admin, weeklyPay);
        await cleanupWorkRecordFixtures(fx, workRecord);
        await cleanupShiftFixtures(fx, shift);
        await cleanupPlatformFixtures(fx, platform);
        await cleanupFixtures(fx);
        reporter.pass("cleanup fixture users/rows", "completed");
      } catch (err) {
        reporter.fail("cleanup fixture users/rows", String(err?.message ?? err));
      }
    } else if (keep) {
      console.log("\n--keep-fixtures: skipping cleanup");
      reporter.pass("cleanup skipped (--keep-fixtures)", `runId=${runId}`);
    }
  }

  const { fail } = reporter.summary();
  process.exit(fail > 0 ? 1 : 0);
}

main();
