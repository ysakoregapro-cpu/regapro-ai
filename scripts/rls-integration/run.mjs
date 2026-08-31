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
