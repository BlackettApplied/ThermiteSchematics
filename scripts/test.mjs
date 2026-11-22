import { mkdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Production loading rejects links. macOS /var and /tmp aliases must be
// canonicalized before creating test fixtures beneath the temporary directory.
const temporary = realpathSync(tmpdir());
function runTests(selected, { cwd = process.cwd(), env = process.env } = {}) {
  // CI can write outside a temporary checkout so its report survives cleanup.
  const { THERMITE_TEST_TIMINGS_FILE: timingFile, ...workerEnv } = env;
  const timings =
    timingFile ||
    (env.THERMITE_TEST_TIMINGS === "1" ? "coverage/test-timings.json" : "");
  if (timings) mkdirSync(dirname(resolve(cwd, timings)), { recursive: true });
  return spawnSync(
    process.execPath,
    [
      fileURLToPath(
        new URL("../node_modules/vitest/vitest.mjs", import.meta.url),
      ),
      "run",
      // Keep each test worker in a separate process, using the same Bun runtime
      // for Vitest and the child CLIs exercised by integration tests.
      "--pool=forks",
      "--testTimeout=120000",
      "--hookTimeout=120000",
      // Release and review archives contain independent source checkouts. Their
      // copied tests are not tests of the active checkout.
      "--exclude=alpha-out/**",
      "--exclude=release-out/**",
      ...(timings
        ? [
            "--reporter=default",
            "--reporter=json",
            `--outputFile.json=${resolve(cwd, timings)}`,
          ]
        : []),
      ...selected,
    ],
    {
      cwd,
      stdio: "inherit",
      env: {
        // Nested contributor and docs runs own their own result files.
        ...workerEnv,
        TMPDIR: temporary,
        TMP: temporary,
        TEMP: temporary,
      },
    },
  );
}

// The contributor harness also observes this entry point when Bun bypasses PATH.
const observer = process.env.THERMITE_CONTRIBUTOR_BUN;
const result = observer
  ? (await import(pathToFileURL(observer).href)).observeContributorTest(
      process.argv.slice(1),
      runTests,
    )
  : runTests(process.argv.slice(2));
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
