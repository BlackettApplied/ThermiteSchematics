// Embedded-host signal cases shared by patch-write-chain-changes.test.ts and
// the generated project guide's test (packages/cli/test/project-guide.test.ts),
// which executes the rows its sentences claim.
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { computeFileIntegrity } from "@thermite/compiler";
import type { PatchProjectFixture } from "./patch-project-fixture.js";

export { POSIX_SIGNALS_UNAVAILABLE } from "./patch-write-recovery.cases.js";

export async function requestFor(project: string, paths = ["sources/a.json"]) {
  return {
    format: "agent-tool-request/0.1" as const,
    project,
    patchFormat: "json-patch/0.1" as const,
    dryRun: false,
    files: await Promise.all(
      paths.map(async (path) => ({
        path,
        expectedIntegrity: computeFileIntegrity(
          await readFile(join(project, path)),
        ),
        operations: [{ op: "add" as const, path: "/$schema", value: "round3" }],
      })),
    ),
  };
}

/** When the embedded host registers its own SIGINT handler. */
export const HOST_HANDLER_MODES = ["before", "after", "after-write"] as const;
/**
 * Applies in a host process that registers a SIGINT handler at `mode` and
 * receives SIGINT while the reservation is held; returns what it reports.
 */
export async function runEmbeddedWriter(
  fixture: PatchProjectFixture,
  mode: (typeof HOST_HANDLER_MODES)[number],
) {
  const requestPath = join(fixture.root, "request.json");
  await writeFile(
    requestPath,
    JSON.stringify(await requestFor(fixture.projectRoot)),
  );
  const result = await promisify(execFile)(process.execPath, [
    resolve("packages/agent-tools/test/fixtures/embedded-patch-writer.mjs"),
    requestPath,
    mode,
  ]);
  return JSON.parse(result.stdout) as {
    hostCalls: number;
    heldDuringWrite: boolean;
    outcome: any;
  };
}
