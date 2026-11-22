// Partial-rollback cases shared by patch-write-serialization.test.ts and the
// generated project guide's test (packages/cli/test/project-guide.test.ts),
// which executes the rows its sentences claim.
import {
  mkdir,
  readFile,
  readdir,
  rename,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import {
  computeFileIntegrity,
  loadProject,
  PROJECT_WRITE_LOCK_FILE_NAME,
} from "@thermite/compiler";
import { expect } from "vitest";

import {
  defaultApplySourcePatchDependencies,
  type ApplySourcePatchDependencies,
} from "../src/apply-source-patch.js";
import { reserveProjectWrite } from "../src/project-write-lock.js";
import type { ApplySourcePatchRequest } from "../src/source-patch-request.js";
import type { PatchProjectFixture } from "./patch-project-fixture.js";

const lockName = PROJECT_WRITE_LOCK_FILE_NAME;

export async function requestFor(
  project: string,
  paths = ["sources/a.json"],
  value = "A",
): Promise<ApplySourcePatchRequest> {
  return {
    format: "agent-tool-request/0.1",
    project,
    patchFormat: "json-patch/0.1",
    dryRun: false,
    files: await Promise.all(
      paths.map(async (path) => ({
        path,
        expectedIntegrity: computeFileIntegrity(
          await readFile(join(project, path)),
        ),
        operations: [
          { op: "test" as const, path: "/objects", value: [] },
          { op: "add" as const, path: "/$schema", value },
        ],
      })),
    ),
  };
}

/** What changes the first committed file before its restore. */
export const ROLLBACK_CHANGES = ["ancestor", "content"] as const;
/**
 * Three sources under a/, b/ and c/: the commit of c fails, and after b is
 * written `change` alters a, so rollback restores b and refuses a.
 */
export async function arrangePartialRollback(
  fixture: PatchProjectFixture,
  change: (typeof ROLLBACK_CHANGES)[number],
) {
  const original = await readFile(join(fixture.projectRoot, "sources/a.json"));
  const paths = ["a/a.json", "b/b.json", "c/c.json"];
  for (const path of paths) {
    await mkdir(join(fixture.projectRoot, path.split("/")[0]!));
    await writeFile(join(fixture.projectRoot, path), original);
  }
  const manifest = join(fixture.projectRoot, "system.json");
  const value = JSON.parse(await readFile(manifest, "utf8"));
  value.sources = ["*/*.json"];
  await writeFile(manifest, JSON.stringify(value));
  const outside = join(fixture.root, "outside");
  await mkdir(outside);
  await writeFile(join(outside, "a.json"), "SENTINEL");
  let mutated = false,
    restoredWhileLocked = false;
  const dependencies: ApplySourcePatchDependencies = {
    ...defaultApplySourcePatchDependencies,
    async writeFileAtomically(path, bytes, options) {
      if (path === join(fixture.projectRoot, paths[2]!))
        throw Object.assign(new Error("injected"), {
          code: "E_COMMIT",
        });
      await defaultApplySourcePatchDependencies.writeFileAtomically(
        path,
        bytes,
        options,
      );
      if (path !== join(fixture.projectRoot, paths[1]!)) return;
      if (mutated) {
        const loaded = await loadProject(fixture.projectRoot);
        // The changed project might no longer load, so check the reservation
        // directly without depending on a subsequent compilation.
        restoredWhileLocked = (await readdir(fixture.projectRoot)).includes(
          lockName,
        );
        if (loaded.ok)
          expect(reserveProjectWrite(loaded.project).ok).toBe(false);
        return;
      }
      mutated = true;
      const first = join(fixture.projectRoot, paths[0]!);
      if (change === "ancestor") {
        await rename(
          join(fixture.projectRoot, "a"),
          join(fixture.projectRoot, "saved-a"),
        );
        await symlink(
          outside,
          join(fixture.projectRoot, "a"),
          process.platform === "win32" ? "junction" : "dir",
        );
      } else {
        await writeFile(first, '{"objects":[],"$schema":"external edit"}\n');
      }
    },
  };
  return {
    original,
    paths,
    outside,
    dependencies,
    request: await requestFor(fixture.projectRoot, paths),
    restoredWhileLocked: () => restoredWhileLocked,
  };
}
