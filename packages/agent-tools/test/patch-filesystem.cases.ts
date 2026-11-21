// Precommit snapshot cases shared by patch-filesystem.test.ts and the generated
// project guide's test (packages/cli/test/project-guide.test.ts), which
// executes the rows its sentences claim.
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { computeFileIntegrity } from "@thermite/compiler";

import {
  createInternalApplySourcePatchTool,
  defaultApplySourcePatchDependencies,
  type ApplySourcePatchDependencies,
} from "../src/apply-source-patch.js";
import { captureProjectControlledSnapshot } from "../src/patch-filesystem.js";
import type {
  ApplySourcePatchRequest,
  SourcePatchOperation,
} from "../src/source-patch-request.js";
import {
  createPatchProjectFixture,
  type PatchProjectFixture,
} from "./patch-project-fixture.js";

export async function requestForFiles(
  fixture: PatchProjectFixture,
  paths: readonly string[],
  dryRun = false,
  operationsFor: (path: string) => readonly SourcePatchOperation[] = () => [
    { op: "test", path: "", value: { objects: [] } },
  ],
): Promise<ApplySourcePatchRequest> {
  return {
    format: "agent-tool-request/0.1",
    project: "project",
    patchFormat: "json-patch/0.1",
    dryRun,
    files: await Promise.all(
      paths.map(async (path) => ({
        path,
        expectedIntegrity: computeFileIntegrity(
          await readFile(join(fixture.projectRoot, path)),
        ),
        operations: operationsFor(path),
      })),
    ),
  };
}

export async function repairRequest(
  fixture: PatchProjectFixture,
): Promise<ApplySourcePatchRequest> {
  return requestForFiles(fixture, ["sources/objects.json"], false, () => [
    { op: "remove", path: "/objects/4" },
  ]);
}

export function applyWith(
  fixture: PatchProjectFixture,
  request: ApplySourcePatchRequest,
  dependencies: ApplySourcePatchDependencies,
) {
  return createInternalApplySourcePatchTool(
    { cwd: fixture.root },
    dependencies,
  ).applySourcePatch(request);
}

/** Files a real writer may change between staging and the precommit snapshot. */
export const PRECOMMIT_MUTATIONS = [
  {
    name: "manifest",
    kind: "clean" as const,
    diskPath: (fixture: PatchProjectFixture) =>
      join(fixture.projectRoot, "system.json"),
    displayFile: "system.json",
    request: (fixture: PatchProjectFixture) =>
      requestForFiles(fixture, ["sources/a.json"]),
  },
  {
    name: "lockfile",
    kind: "clean" as const,
    diskPath: (fixture: PatchProjectFixture) =>
      join(fixture.projectRoot, "electrical-system.lock.json"),
    displayFile: "electrical-system.lock.json",
    request: (fixture: PatchProjectFixture) =>
      requestForFiles(fixture, ["sources/a.json"]),
  },
  {
    name: "library",
    kind: "repair" as const,
    diskPath: (fixture: PatchProjectFixture) =>
      join(fixture.root, "library", "library.json"),
    displayFile: "../library/library.json",
    request: repairRequest,
  },
  {
    name: "local library source",
    kind: "repair" as const,
    diskPath: (fixture: PatchProjectFixture) =>
      join(fixture.root, "library", "types", "connectivity.json"),
    displayFile: "../library/types/connectivity.json",
    request: repairRequest,
  },
  {
    name: "target source",
    kind: "clean" as const,
    diskPath: (fixture: PatchProjectFixture) =>
      join(fixture.projectRoot, "sources", "a.json"),
    displayFile: "sources/a.json",
    request: (fixture: PatchProjectFixture) =>
      requestForFiles(fixture, ["sources/a.json"]),
  },
  {
    name: "non-target source",
    kind: "clean" as const,
    diskPath: (fixture: PatchProjectFixture) =>
      join(fixture.projectRoot, "sources", "b.json"),
    displayFile: "sources/b.json",
    request: (fixture: PatchProjectFixture) =>
      requestForFiles(fixture, ["sources/a.json"]),
  },
];
export type PrecommitMutation = (typeof PRECOMMIT_MUTATIONS)[number];
/**
 * Applies a patch while the row's file changes between staging and the
 * precommit snapshot; returns the outcome, the bytes before and after the
 * change, and how many snapshots the apply captured.
 */
export async function mutateBeforePrecommit({
  kind,
  diskPath,
  displayFile,
  request,
}: PrecommitMutation) {
  const fixture = await createPatchProjectFixture(kind);
  try {
    const path = diskPath(fixture);
    const isMissingLock = displayFile === "electrical-system.lock.json";
    const before = isMissingLock ? undefined : await readFile(path);
    const changed = isMissingLock
      ? Buffer.from("{}\n", "utf8")
      : Buffer.concat([before!, Buffer.from("\n", "utf8")]);
    let captureCalls = 0;
    const filesystem = defaultApplySourcePatchDependencies.filesystem;
    const dependencies: ApplySourcePatchDependencies = {
      ...defaultApplySourcePatchDependencies,
      async captureSnapshot(project) {
        captureCalls += 1;
        if (captureCalls === 2) await writeFile(path, changed);
        return captureProjectControlledSnapshot(project, filesystem);
      },
    };
    const outcome = await applyWith(
      fixture,
      await request(fixture),
      dependencies,
    );
    return { outcome, before, changed, captureCalls };
  } finally {
    await fixture.cleanup();
  }
}
