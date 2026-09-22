import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Production loading rejects links. macOS /var and /tmp aliases must be
// canonicalized before creating test fixtures beneath the temporary directory.
const temporary = realpathSync(tmpdir());
const sidecars = mkdtempSync(join(temporary, "thermite-test-sidecars-"));
const selected = process.argv.slice(2);
// This suite builds the frozen private 0.2.0 tarball against its historical
// byte inventory. The alpha ships source and has its own archive acceptance.
const selection = selected.some((argument) =>
  argument.endsWith("/release-package.test.ts"),
)
  ? selected
  : ["--exclude=packages/cli/test/release-package.test.ts", ...selected];
if (selected.length === 0)
  process.stdout.write(
    "Source alpha check; frozen private tarball inventory tests are separate (test:legacy-package).\n",
  );
try {
  // Legacy candidate tests record their explicit "no downloaded candidate"
  // classification here; protected release evidence remains a separate command.
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(
        new URL("../node_modules/vitest/vitest.mjs", import.meta.url),
      ),
      "run",
      "--pool=threads",
      "--testTimeout=120000",
      "--hookTimeout=120000",
      // Review archives contain independent historical source checkouts. Their
      // copied tests are not tests of the active checkout.
      "--exclude=alpha-out/**",
      ...selection,
    ],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        TMPDIR: temporary,
        TMP: temporary,
        TEMP: temporary,
        THERMITE_SCHEMATICS_RELEASE_BRANCH_SIDECAR_DIR:
          process.env.THERMITE_SCHEMATICS_RELEASE_BRANCH_SIDECAR_DIR ??
          sidecars,
      },
    },
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(sidecars, { recursive: true, force: true });
}
