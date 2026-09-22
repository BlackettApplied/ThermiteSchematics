import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  compileProject,
  computeFileIntegrity,
  loadProject,
  resolveShippedCoreLibrary,
  type LoadedProject,
  writeFileAtomically,
} from "@thermite/compiler";
import type { Diagnostic } from "@thermite/schema";
import { describe, expect, it, vi, type TestContext } from "vitest";

import {
  createInternalApplySourcePatchTool,
  defaultApplySourcePatchDependencies,
  type ApplySourcePatchDependencies,
} from "../src/apply-source-patch.js";
import { serializeAgentToolReport } from "../src/common/serializer.js";
import {
  captureProjectControlledSnapshot,
  captureOwnedStageDirectory,
  projectControlledSnapshotPlan,
  createOwnedStageCleanup,
  removeOwnedStageDirectory,
  scanOrdinaryProjectTree,
  validateProjectSourceChain,
  type FileStatus,
  type PatchFilesystemDependencies,
} from "../src/patch-filesystem.js";
import type {
  ApplySourcePatchRequest,
  SourcePatchOperation,
} from "../src/source-patch-request.js";
import {
  createPatchProjectFixture,
  type PatchProjectFixture,
} from "./patch-project-fixture.js";

function codedError(code: string): Error {
  return Object.assign(new Error("private path must not escape"), { code });
}

function expectToolFailure(
  outcome: unknown,
  stage: "stage-create" | "stage-cleanup",
  code: string,
): void {
  expect(outcome).toEqual({
    ok: false,
    diagnostics: [
      {
        code: "E001",
        severity: "error",
        message: `Agent apply-source-patch tool failure (${stage}/${code}).`,
        file: "system.json",
        line: 1,
        column: 1,
        jsonPointer: "",
      },
    ],
    error: null,
    failureClass: "tool",
  });
}

function expectOwnGuardFailure(error: unknown, guard: string): void {
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toBe(
    `Stage cleanup guard mismatch at ${JSON.stringify(guard)}.`,
  );
  expect(Object.getOwnPropertyDescriptor(error, "code")).toMatchObject({
    value: "STAGE_GUARD_MISMATCH",
  });
}

function withDifferentIdentity(status: FileStatus): FileStatus {
  return {
    dev: status.dev,
    ino: status.ino + 1n,
    isDirectory: () => status.isDirectory(),
    isFile: () => status.isFile(),
    isSymbolicLink: () => status.isSymbolicLink(),
  };
}

const STAGED_WARNINGS: readonly Diagnostic[] = [
  {
    code: "W901",
    severity: "warning",
    message: "Staged unmatched source warning.",
    file: "system.json",
    line: 1,
    column: 1,
    jsonPointer: "/sources/1",
  },
  {
    code: "W902",
    severity: "warning",
    message: "Staged duplicate potential warning.",
    file: "sources/a.json",
    line: 1,
    column: 1,
    jsonPointer: "/objects/0",
  },
];

const LINK_SKIP_PREFIX =
  "real reparse-point acceptance skipped: runtime link creation was denied";

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : undefined;
}

async function createDirectoryLinkOrSkip(
  context: TestContext,
  target: string,
  link: string,
): Promise<void> {
  try {
    await symlink(
      target,
      link,
      process.platform === "win32" ? "junction" : "dir",
    );
  } catch (error) {
    const code = errorCode(error);
    if (code === "EPERM" || code === "EACCES" || code === "ENOSYS") {
      context.skip(`${LINK_SKIP_PREFIX} (${code}).`);
    }
    throw error;
  }
}

async function swapSourcesDirectoryForLink(
  fixture: PatchProjectFixture,
): Promise<void> {
  const sourceDirectory = join(fixture.projectRoot, "sources");
  const movedDirectory = join(fixture.projectRoot, "sources-original");
  await rename(sourceDirectory, movedDirectory);
  try {
    await symlink(
      movedDirectory,
      sourceDirectory,
      process.platform === "win32" ? "junction" : "dir",
    );
  } catch (error) {
    await rename(movedDirectory, sourceDirectory);
    throw error;
  }
}

async function proveDirectoryLinkCapability(
  context: TestContext,
  fixture: PatchProjectFixture,
): Promise<void> {
  const target = join(fixture.root, "capability-target");
  const link = join(fixture.root, "capability-link");
  await mkdir(target);
  await createDirectoryLinkOrSkip(context, target, link);
  await unlink(link);
}

function dependenciesWithFilesystem(
  overrides: Partial<PatchFilesystemDependencies>,
  other: Partial<ApplySourcePatchDependencies> = {},
): ApplySourcePatchDependencies {
  return {
    ...defaultApplySourcePatchDependencies,
    ...other,
    filesystem: {
      ...defaultApplySourcePatchDependencies.filesystem,
      ...overrides,
    },
  };
}

function dependenciesWithStagedWarnings(
  other: Partial<ApplySourcePatchDependencies> = {},
): ApplySourcePatchDependencies {
  return {
    ...defaultApplySourcePatchDependencies,
    ...other,
    async compileProject(inputPath, cwd) {
      const compiled = await defaultApplySourcePatchDependencies.compileProject(
        inputPath,
        cwd,
      );
      return compiled.ok
        ? { ...compiled, diagnostics: STAGED_WARNINGS }
        : compiled;
    },
  };
}

async function requestForFiles(
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

async function repairRequest(
  fixture: PatchProjectFixture,
): Promise<ApplySourcePatchRequest> {
  return requestForFiles(fixture, ["sources/objects.json"], false, () => [
    { op: "remove", path: "/objects/4" },
  ]);
}

function applyWith(
  fixture: PatchProjectFixture,
  request: ApplySourcePatchRequest,
  dependencies: ApplySourcePatchDependencies,
) {
  return createInternalApplySourcePatchTool(
    { cwd: fixture.root },
    dependencies,
  ).applySourcePatch(request);
}

function expectQuarantinePathIsInternal(
  outcome: Awaited<ReturnType<typeof applyWith>>,
  quarantinePath: string,
): void {
  if (outcome.ok) throw new Error("Expected a failed patch outcome.");
  const surfaces = [
    JSON.stringify(outcome),
    serializeAgentToolReport(
      "apply-source-patch",
      outcome.diagnostics,
      outcome.error,
    ),
    JSON.stringify(outcome.diagnostics),
  ];
  const pathSpellings = new Set([
    quarantinePath,
    quarantinePath.replaceAll("\\", "/"),
  ]);
  for (const path of pathSpellings) {
    const serializedPath = JSON.stringify(path).slice(1, -1);
    for (const surface of surfaces) {
      expect(surface).not.toContain(serializedPath);
    }
  }
}

describe("D10 filesystem safety and rollback", () => {
  describe("D7 project-controlled snapshot planning", () => {
    it("returns the exact rank/key order and includes only local library documents", async () => {
      const cleanFixture = await createPatchProjectFixture("clean");
      const localFixture = await createPatchProjectFixture("repair");
      try {
        const cleanLoaded = await loadProject("project", cleanFixture.root);
        if (!cleanLoaded.ok) {
          throw new Error(JSON.stringify(cleanLoaded.diagnostics));
        }
        expect(projectControlledSnapshotPlan(cleanLoaded.project)).toEqual([
          {
            role: "project-manifest",
            dependencyIndex: -1,
            file: "system.json",
            key: '[0,-1,"system.json"]',
          },
          {
            role: "project-source",
            dependencyIndex: -1,
            file: "sources/a.json",
            key: '[2,-1,"sources/a.json"]',
          },
          {
            role: "project-source",
            dependencyIndex: -1,
            file: "sources/b.json",
            key: '[2,-1,"sources/b.json"]',
          },
          {
            role: "lock",
            dependencyIndex: -1,
            file: "electrical-system.lock.json",
            key: '[3,-1,"electrical-system.lock.json"]',
          },
        ]);

        const localLoaded = await loadProject("project", localFixture.root);
        if (!localLoaded.ok) {
          throw new Error(JSON.stringify(localLoaded.diagnostics));
        }
        expect(
          projectControlledSnapshotPlan(localLoaded.project).filter((entry) =>
            entry.role.startsWith("local-library-"),
          ),
        ).toEqual([
          {
            role: "local-library-manifest",
            dependencyIndex: 0,
            file: "../library/library.json",
            key: '[4,0,"../library/library.json"]',
          },
          {
            role: "local-library-source",
            dependencyIndex: 0,
            file: "../library/types/connectivity.json",
            key: '[5,0,"../library/types/connectivity.json"]',
          },
        ]);
      } finally {
        await cleanFixture.cleanup();
        await localFixture.cleanup();
      }
    });

    it("plans an authored presentation and excludes synthetic shipped records solely by resolution kind", async () => {
      const loaded = await loadProject("examples/motor-starter", process.cwd());
      if (!loaded.ok) {
        throw new Error(JSON.stringify(loaded.diagnostics));
      }
      const baseline = projectControlledSnapshotPlan(loaded.project);
      expect(baseline.map(({ role, file }) => [role, file])).toContainEqual([
        "project-presentation",
        "presentation.json",
      ]);
      expect(
        baseline.some((entry) => entry.role.startsWith("local-library-")),
      ).toBe(false);

      const variant: LoadedProject = {
        ...loaded.project,
        libraries: loaded.project.libraries.map((library) =>
          library.resolutionKind === "shipped"
            ? {
                ...library,
                manifest: {
                  ...library.manifest,
                  rawBytes: Buffer.from("different shipped manifest", "utf8"),
                  canonicalPath: join(
                    loaded.project.logicalRootPath,
                    "missing-shipped-manifest",
                  ),
                },
                sources: library.sources.map((source, index) => ({
                  ...source,
                  rawBytes: Buffer.from(
                    `different shipped source ${index}`,
                    "utf8",
                  ),
                  canonicalPath: join(
                    loaded.project.logicalRootPath,
                    index === 0
                      ? "missing-shipped-source"
                      : "reparse-like-shipped-source",
                  ),
                })),
              }
            : library,
        ),
      };
      expect(projectControlledSnapshotPlan(variant)).toEqual(baseline);

      const equivalentLocal: LoadedProject = {
        ...variant,
        libraries: variant.libraries.map((library) => ({
          ...library,
          resolutionKind: "local",
        })),
      };
      const localEntries = projectControlledSnapshotPlan(
        equivalentLocal,
      ).filter((entry) => entry.role.startsWith("local-library-"));
      expect(localEntries).toHaveLength(
        equivalentLocal.libraries.reduce(
          (count, library) => count + 1 + library.sources.length,
          0,
        ),
      );
      expect(localEntries[0]?.role).toBe("local-library-manifest");
      expect(localEntries.at(-1)?.role).toBe("local-library-source");
    });
  });

  it("owns no path and performs no cleanup when mkdtemp fails", async () => {
    const fixture = await createPatchProjectFixture("staged-failure");
    try {
      const sentinel = join(
        fixture.root,
        ".thermite-schematics-stage-sentinel",
      );
      await writeFile(sentinel, "sentinel", "utf8");
      const cleanup = vi.fn(defaultApplySourcePatchDependencies.filesystem.rm);
      const dependencies = dependenciesWithFilesystem({
        mkdtemp: vi.fn(async () => {
          throw codedError("E_STAGE_CREATE");
        }),
        rm: cleanup,
      });
      const outcome = await applyWith(
        fixture,
        await requestForFiles(fixture, ["sources/a.json"]),
        dependencies,
      );
      expect(outcome).toEqual({
        ok: false,
        diagnostics: [
          {
            code: "E001",
            severity: "error",
            message:
              "Agent apply-source-patch tool failure (stage-create/E_STAGE_CREATE).",
            file: "system.json",
            line: 1,
            column: 1,
            jsonPointer: "",
          },
        ],
        error: null,
        failureClass: "tool",
      });
      expect(cleanup).not.toHaveBeenCalled();
      expect(await readFile(sentinel, "utf8")).toBe("sentinel");
    } finally {
      await fixture.cleanup();
    }
  });

  it("treats bounded stage mkdtemp EEXIST exhaustion as stage-create with no cleanup", async () => {
    const fixture = await createPatchProjectFixture("staged-failure");
    try {
      const base = defaultApplySourcePatchDependencies.filesystem;
      const removal = vi.fn(base.rm);
      const stageRename = vi.fn(base.rename);
      const outcome = await applyWith(
        fixture,
        await requestForFiles(fixture, ["sources/a.json"]),
        dependenciesWithFilesystem({
          mkdtemp: vi.fn(async () => {
            throw codedError("EEXIST");
          }),
          rename: stageRename,
          rm: removal,
        }),
      );
      expectToolFailure(outcome, "stage-create", "EEXIST");
      expect(stageRename).not.toHaveBeenCalled();
      expect(removal).not.toHaveBeenCalled();
    } finally {
      await fixture.cleanup();
    }
  });

  it("retains a no-identity stage after capture failure with zero removal attempts", async () => {
    const fixture = await createPatchProjectFixture("staged-failure");
    try {
      const base = defaultApplySourcePatchDependencies.filesystem;
      let stagePath: string | undefined;
      const create = vi.fn(async (prefix: string) => {
        stagePath = await base.mkdtemp(prefix);
        return stagePath;
      });
      const stageRename = vi.fn(base.rename);
      const removal = vi.fn(base.rm);
      const outcome = await applyWith(
        fixture,
        await requestForFiles(fixture, ["sources/a.json"], true),
        dependenciesWithFilesystem({
          mkdtemp: create,
          stat: vi.fn(async () => {
            throw codedError("E_STAGE_STAT");
          }),
          rename: stageRename,
          rm: removal,
        }),
      );
      expectToolFailure(outcome, "stage-create", "E_STAGE_STAT");
      expect(create).toHaveBeenCalledTimes(1);
      expect(stageRename).not.toHaveBeenCalled();
      expect(removal).not.toHaveBeenCalled();
      expect(stagePath).toBeDefined();
      expect((await base.lstat(stagePath!)).isDirectory()).toBe(true);
      expect(JSON.stringify(outcome)).not.toContain(stagePath!);
      expect(JSON.stringify(outcome)).not.toContain("residue");
    } finally {
      await fixture.cleanup();
    }
  });

  it("removes a verified quarantine parent and confirms its absence", async () => {
    const fixture = await createPatchProjectFixture("clean");
    try {
      const base = defaultApplySourcePatchDependencies.filesystem;
      let stagePath: string | undefined;
      let quarantineParent: string | undefined;
      const create = vi.fn(async (prefix: string) => {
        const path = await base.mkdtemp(prefix);
        if (prefix.includes(".thermite-schematics-quarantine-")) {
          quarantineParent = path;
        } else {
          stagePath = path;
        }
        return path;
      });
      const stageRename = vi.fn(base.rename);
      const removal = vi.fn(base.rm);
      const outcome = await applyWith(
        fixture,
        await requestForFiles(fixture, ["sources/a.json"], true),
        dependenciesWithFilesystem({
          mkdtemp: create,
          rename: stageRename,
          rm: removal,
        }),
      );
      expect(outcome).toMatchObject({ ok: true });
      expect(stagePath).toBeDefined();
      expect(quarantineParent).toBeDefined();
      expect(stageRename).toHaveBeenCalledExactlyOnceWith(
        stagePath,
        join(quarantineParent!, "s"),
      );
      expect(removal).toHaveBeenCalledExactlyOnceWith(quarantineParent, {
        recursive: true,
        force: true,
        maxRetries: 2,
        retryDelay: 50,
      });
      expect(removal.mock.calls[0]![0]).not.toBe(stagePath);
      await expect(base.lstat(stagePath!)).rejects.toMatchObject({
        code: "ENOENT",
      });
      await expect(base.lstat(quarantineParent!)).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it.each([
    {
      primaryCode: "EEXIST",
      finalCode: "E_FINAL_QUARANTINE_CREATE",
    },
    {
      primaryCode: "E_QUARANTINE_CREATE",
      finalCode: "E_QUARANTINE_CREATE",
    },
  ])(
    "retains the active stage when quarantine mkdtemp rejects with $primaryCode",
    async ({ primaryCode, finalCode }) => {
      const fixture = await createPatchProjectFixture("staged-failure");
      try {
        const base = defaultApplySourcePatchDependencies.filesystem;
        let stagePath: string | undefined;
        let quarantineAttempts = 0;
        const create = vi.fn(async (prefix: string) => {
          if (prefix.includes(".thermite-schematics-quarantine-")) {
            quarantineAttempts += 1;
            throw codedError(
              quarantineAttempts === 1 ? primaryCode : finalCode,
            );
          }
          stagePath = await base.mkdtemp(prefix);
          return stagePath;
        });
        const nameGeneration = vi.fn(base.nameGeneration);
        const stageRename = vi.fn(base.rename);
        const removal = vi.fn(base.rm);
        const outcome = await applyWith(
          fixture,
          await requestForFiles(fixture, ["sources/a.json"], true),
          dependenciesWithFilesystem({
            mkdtemp: create,
            nameGeneration,
            rename: stageRename,
            rm: removal,
          }),
        );
        expectToolFailure(outcome, "stage-cleanup", primaryCode);
        expect(create).toHaveBeenCalledTimes(3);
        expect(nameGeneration.mock.calls.map(([kind]) => kind)).toEqual([
          "stage",
          "quarantine",
          "quarantine",
        ]);
        expect(stageRename).not.toHaveBeenCalled();
        expect(removal).not.toHaveBeenCalled();
        expect((await base.lstat(stagePath!)).isDirectory()).toBe(true);
        if (finalCode !== primaryCode) {
          expect(JSON.stringify(outcome)).not.toContain(finalCode);
        }
        expect(JSON.stringify(outcome)).not.toContain("residue");
      } finally {
        await fixture.cleanup();
      }
    },
  );

  it("keeps the primary quarantine-creation failure after a successful active-state final attempt", async () => {
    const fixture = await createPatchProjectFixture("staged-failure");
    try {
      const base = defaultApplySourcePatchDependencies.filesystem;
      let stagePath: string | undefined;
      let finalQuarantineParent: string | undefined;
      let quarantineAttempts = 0;
      const create = vi.fn(async (prefix: string) => {
        if (prefix.includes(".thermite-schematics-quarantine-")) {
          quarantineAttempts += 1;
          if (quarantineAttempts === 1) {
            throw codedError("E_PRIMARY_QUARANTINE");
          }
          finalQuarantineParent = await base.mkdtemp(prefix);
          return finalQuarantineParent;
        }
        stagePath = await base.mkdtemp(prefix);
        return stagePath;
      });
      const removal = vi.fn(base.rm);
      const outcome = await applyWith(
        fixture,
        await requestForFiles(fixture, ["sources/a.json"], true),
        dependenciesWithFilesystem({ mkdtemp: create, rm: removal }),
      );
      expectToolFailure(outcome, "stage-cleanup", "E_PRIMARY_QUARANTINE");
      expect(quarantineAttempts).toBe(2);
      expect(removal).toHaveBeenCalledTimes(1);
      await expect(base.lstat(stagePath!)).rejects.toMatchObject({
        code: "ENOENT",
      });
      await expect(base.lstat(finalQuarantineParent!)).rejects.toMatchObject({
        code: "ENOENT",
      });
      expectQuarantinePathIsInternal(outcome, finalQuarantineParent!);
    } finally {
      await fixture.cleanup();
    }
  });

  it("retains the active stage and every empty quarantine after rename rejection", async () => {
    const fixture = await createPatchProjectFixture("staged-failure");
    try {
      const base = defaultApplySourcePatchDependencies.filesystem;
      let stagePath: string | undefined;
      const quarantineParents: string[] = [];
      const create = vi.fn(async (prefix: string) => {
        const path = await base.mkdtemp(prefix);
        if (prefix.includes(".thermite-schematics-quarantine-")) {
          quarantineParents.push(path);
        } else {
          stagePath = path;
        }
        return path;
      });
      let renameCalls = 0;
      const stageRename = vi.fn(async () => {
        renameCalls += 1;
        throw codedError(
          renameCalls === 1 ? "E_RENAME_PRIMARY" : "E_RENAME_FINAL",
        );
      });
      const removal = vi.fn(base.rm);
      const outcome = await applyWith(
        fixture,
        await requestForFiles(fixture, ["sources/a.json"], true),
        dependenciesWithFilesystem({
          mkdtemp: create,
          rename: stageRename,
          rm: removal,
        }),
      );
      expectToolFailure(outcome, "stage-cleanup", "E_RENAME_PRIMARY");
      expect(stageRename).toHaveBeenCalledTimes(2);
      expect(removal).not.toHaveBeenCalled();
      expect(quarantineParents).toHaveLength(2);
      expect(new Set(quarantineParents).size).toBe(2);
      expect((await base.lstat(stagePath!)).isDirectory()).toBe(true);
      for (const quarantineParent of quarantineParents) {
        expect((await base.lstat(quarantineParent)).isDirectory()).toBe(true);
        expect(await readdir(quarantineParent)).toEqual([]);
        expectQuarantinePathIsInternal(outcome, quarantineParent);
      }
      expect(JSON.stringify(outcome)).not.toContain("E_RENAME_FINAL");
      expect(JSON.stringify(outcome)).not.toContain("residue");
    } finally {
      await fixture.cleanup();
    }
  });

  it("retains a post-rename identity mismatch with frozen internal and envelope layers", async () => {
    const fixture = await createPatchProjectFixture("staged-failure");
    try {
      const base = defaultApplySourcePatchDependencies.filesystem;
      let stagePath: string | undefined;
      let quarantineParent: string | undefined;
      const create = vi.fn(async (prefix: string) => {
        const path = await base.mkdtemp(prefix);
        if (prefix.includes(".thermite-schematics-quarantine-")) {
          quarantineParent = path;
        } else {
          stagePath = path;
        }
        return path;
      });
      const stageRename = vi.fn(base.rename);
      const removal = vi.fn(base.rm);
      const filesystem: PatchFilesystemDependencies = {
        ...base,
        mkdtemp: create,
        async lstat(path) {
          const status = await base.lstat(path);
          return path === join(quarantineParent ?? "", "s")
            ? withDifferentIdentity(status)
            : status;
        },
        rename: stageRename,
        rm: removal,
      };
      const outcome = await applyWith(
        fixture,
        await requestForFiles(fixture, ["sources/a.json"], true),
        {
          ...defaultApplySourcePatchDependencies,
          filesystem,
        },
      );
      expectToolFailure(outcome, "stage-cleanup", "STAGE_GUARD_MISMATCH");
      expect(stageRename).toHaveBeenCalledTimes(1);
      expect(removal).not.toHaveBeenCalled();
      await expect(base.lstat(stagePath!)).rejects.toMatchObject({
        code: "ENOENT",
      });
      expect((await base.lstat(quarantineParent!)).isDirectory()).toBe(true);
      expect(
        (await base.lstat(join(quarantineParent!, "s"))).isDirectory(),
      ).toBe(true);
      expect(JSON.stringify(outcome)).not.toContain(
        "Stage cleanup guard mismatch at",
      );
      expect(JSON.stringify(outcome)).not.toContain("residue");
      expectQuarantinePathIsInternal(outcome, quarantineParent!);

      const directStagePath = await base.mkdtemp(
        join(fixture.root, ".thermite-schematics-stage-direct-"),
      );
      const directOwned = await captureOwnedStageDirectory(
        directStagePath,
        base,
      );
      const directCleanup = createOwnedStageCleanup(directOwned, fixture.root);
      let directChild: string | undefined;
      const directRemoval = vi.fn(base.rm);
      const directFilesystem: PatchFilesystemDependencies = {
        ...base,
        async lstat(path) {
          const status = await base.lstat(path);
          return path === directChild ? withDifferentIdentity(status) : status;
        },
        async rename(oldPath, newPath) {
          directChild = newPath;
          await base.rename(oldPath, newPath);
        },
        rm: directRemoval,
      };
      let guardFailure: unknown;
      try {
        await removeOwnedStageDirectory(directCleanup, directFilesystem);
      } catch (error) {
        guardFailure = error;
      }
      expectOwnGuardFailure(guardFailure, "quarantine-child");
      expect(directRemoval).not.toHaveBeenCalled();
      expect((await base.lstat(directChild!)).isDirectory()).toBe(true);
    } finally {
      await fixture.cleanup();
    }
  });

  it("retains the quarantine after a post-rename lstat exception", async () => {
    const fixture = await createPatchProjectFixture("staged-failure");
    try {
      const base = defaultApplySourcePatchDependencies.filesystem;
      let stagePath: string | undefined;
      let quarantineParent: string | undefined;
      const create = vi.fn(async (prefix: string) => {
        const path = await base.mkdtemp(prefix);
        if (prefix.includes(".thermite-schematics-quarantine-")) {
          quarantineParent = path;
        } else {
          stagePath = path;
        }
        return path;
      });
      let childInspectionCalls = 0;
      const stageRename = vi.fn(base.rename);
      const removal = vi.fn(base.rm);
      const filesystem: PatchFilesystemDependencies = {
        ...base,
        mkdtemp: create,
        async lstat(path) {
          if (path === join(quarantineParent ?? "", "s")) {
            childInspectionCalls += 1;
            throw codedError(
              childInspectionCalls === 1
                ? "E_POST_RENAME_LSTAT"
                : "E_FINAL_CHILD_LSTAT",
            );
          }
          return base.lstat(path);
        },
        rename: stageRename,
        rm: removal,
      };
      const outcome = await applyWith(
        fixture,
        await requestForFiles(fixture, ["sources/a.json"], true),
        {
          ...defaultApplySourcePatchDependencies,
          filesystem,
        },
      );
      expectToolFailure(outcome, "stage-cleanup", "E_POST_RENAME_LSTAT");
      expect(stageRename).toHaveBeenCalledTimes(1);
      expect(childInspectionCalls).toBe(2);
      expect(removal).not.toHaveBeenCalled();
      await expect(base.lstat(stagePath!)).rejects.toMatchObject({
        code: "ENOENT",
      });
      expect((await base.lstat(quarantineParent!)).isDirectory()).toBe(true);
      expect(
        (await base.lstat(join(quarantineParent!, "s"))).isDirectory(),
      ).toBe(true);
      expect(JSON.stringify(outcome)).not.toContain("E_FINAL_CHILD_LSTAT");
      expect(JSON.stringify(outcome)).not.toContain("private path");
      expect(JSON.stringify(outcome)).not.toContain("residue");
      expectQuarantinePathIsInternal(outcome, quarantineParent!);
    } finally {
      await fixture.cleanup();
    }
  });

  it("forbids false success when quarantine-parent absence is unconfirmed", async () => {
    const fixture = await createPatchProjectFixture("staged-failure");
    try {
      const base = defaultApplySourcePatchDependencies.filesystem;
      let quarantineParent: string | undefined;
      const create = vi.fn(async (prefix: string) => {
        const path = await base.mkdtemp(prefix);
        if (prefix.includes(".thermite-schematics-quarantine-")) {
          quarantineParent = path;
        }
        return path;
      });
      const removal = vi.fn(async () => {});
      const outcome = await applyWith(
        fixture,
        await requestForFiles(fixture, ["sources/a.json"], true),
        dependenciesWithFilesystem({ mkdtemp: create, rm: removal }),
      );
      expectToolFailure(outcome, "stage-cleanup", "STAGE_GUARD_MISMATCH");
      expect(removal).toHaveBeenCalledTimes(2);
      expect((await base.lstat(quarantineParent!)).isDirectory()).toBe(true);
      expect(
        (await base.lstat(join(quarantineParent!, "s"))).isDirectory(),
      ).toBe(true);
      const serialized = JSON.stringify(outcome);
      expect(serialized).toContain(
        "Agent apply-source-patch tool failure (stage-cleanup/STAGE_GUARD_MISMATCH).",
      );
      expect(serialized).not.toContain("Stage cleanup guard mismatch at");
      expect(serialized).not.toContain("residue");
      expectQuarantinePathIsInternal(outcome, quarantineParent!);

      const directStagePath = await base.mkdtemp(
        join(fixture.root, ".thermite-schematics-stage-absence-"),
      );
      const directOwned = await captureOwnedStageDirectory(
        directStagePath,
        base,
      );
      const directCleanup = createOwnedStageCleanup(directOwned, fixture.root);
      let guardFailure: unknown;
      try {
        await removeOwnedStageDirectory(directCleanup, {
          ...base,
          rm: vi.fn(async () => {}),
        });
      } catch (error) {
        guardFailure = error;
      }
      expectOwnGuardFailure(guardFailure, "quarantine-parent-absence");
    } finally {
      await fixture.cleanup();
    }
  });

  it("skips quarantine and removal after a swap before the primary lstat guard", async () => {
    const fixture = await createPatchProjectFixture("staged-failure");
    try {
      const base = defaultApplySourcePatchDependencies.filesystem;
      let stagePath: string | undefined;
      let originalStagePath: string | undefined;
      let swapped = false;
      const create = vi.fn(async (prefix: string) => {
        const path = await base.mkdtemp(prefix);
        stagePath = path;
        return path;
      });
      const nameGeneration = vi.fn(base.nameGeneration);
      const stageRename = vi.fn(base.rename);
      const removal = vi.fn(base.rm);
      const filesystem: PatchFilesystemDependencies = {
        ...base,
        mkdtemp: create,
        nameGeneration,
        async lstat(path) {
          if (path === stagePath && !swapped) {
            swapped = true;
            originalStagePath = `${stagePath}-owned-original`;
            await base.rename(path, originalStagePath);
            await base.mkdir(path);
          }
          return base.lstat(path);
        },
        rename: stageRename,
        rm: removal,
      };
      const outcome = await applyWith(
        fixture,
        await requestForFiles(fixture, ["sources/a.json"], true),
        {
          ...defaultApplySourcePatchDependencies,
          filesystem,
        },
      );
      expectToolFailure(outcome, "stage-cleanup", "STAGE_GUARD_MISMATCH");
      expect(swapped).toBe(true);
      expect(create).toHaveBeenCalledTimes(1);
      expect(nameGeneration.mock.calls.map(([kind]) => kind)).toEqual([
        "stage",
      ]);
      expect(stageRename).not.toHaveBeenCalled();
      expect(removal).not.toHaveBeenCalled();
      expect((await base.lstat(stagePath!)).isDirectory()).toBe(true);
      expect((await base.lstat(originalStagePath!)).isDirectory()).toBe(true);
    } finally {
      await fixture.cleanup();
    }
  });

  it("keeps the primary removal failure after a successful quarantined-state final attempt", async () => {
    const fixture = await createPatchProjectFixture("staged-failure");
    try {
      const base = defaultApplySourcePatchDependencies.filesystem;
      let quarantineParent: string | undefined;
      const create = vi.fn(async (prefix: string) => {
        const path = await base.mkdtemp(prefix);
        if (prefix.includes(".thermite-schematics-quarantine-")) {
          quarantineParent = path;
        }
        return path;
      });
      const stageRename = vi.fn(base.rename);
      let removalCalls = 0;
      const removal = vi.fn(async (path: string, options) => {
        removalCalls += 1;
        if (removalCalls === 1) {
          throw codedError("E_PRIMARY_REMOVE");
        }
        await base.rm(path, options);
      });
      const outcome = await applyWith(
        fixture,
        await requestForFiles(fixture, ["sources/a.json"], true),
        dependenciesWithFilesystem({
          mkdtemp: create,
          rename: stageRename,
          rm: removal,
        }),
      );
      expectToolFailure(outcome, "stage-cleanup", "E_PRIMARY_REMOVE");
      expect(stageRename).toHaveBeenCalledTimes(1);
      expect(removal).toHaveBeenCalledTimes(2);
      await expect(base.lstat(quarantineParent!)).rejects.toMatchObject({
        code: "ENOENT",
      });
      expectQuarantinePathIsInternal(outcome, quarantineParent!);
    } finally {
      await fixture.cleanup();
    }
  });

  it("isolates concurrent invocations in distinct fulfilled quarantine parents", async () => {
    const fixture = await createPatchProjectFixture("clean");
    try {
      const secondProjectRoot = join(fixture.root, "project-two");
      await cp(fixture.projectRoot, secondProjectRoot, {
        recursive: true,
        dereference: false,
        errorOnExist: true,
        force: false,
        verbatimSymlinks: true,
      });
      const secondFixture: PatchProjectFixture = {
        ...fixture,
        projectRoot: secondProjectRoot,
      };
      const firstRequest = await requestForFiles(
        fixture,
        ["sources/a.json"],
        true,
      );
      const secondRequest = {
        ...(await requestForFiles(secondFixture, ["sources/a.json"], true)),
        project: "project-two",
      };

      const base = defaultApplySourcePatchDependencies.filesystem;
      const stagePaths: string[] = [];
      const quarantineParents: string[] = [];
      let releaseQuarantines!: () => void;
      const bothQuarantines = new Promise<void>((resolveBarrier) => {
        releaseQuarantines = resolveBarrier;
      });
      const create = vi.fn(async (prefix: string) => {
        const path = await base.mkdtemp(prefix);
        if (prefix.includes(".thermite-schematics-quarantine-")) {
          quarantineParents.push(path);
          if (quarantineParents.length === 2) releaseQuarantines();
          await bothQuarantines;
        } else {
          stagePaths.push(path);
        }
        return path;
      });
      const renamePairs: Array<readonly [string, string]> = [];
      const stageRename = vi.fn(async (oldPath: string, newPath: string) => {
        renamePairs.push([oldPath, newPath]);
        await base.rename(oldPath, newPath);
      });
      const removal = vi.fn(base.rm);
      const nameGeneration = vi.fn(base.nameGeneration);
      const dependencies = dependenciesWithFilesystem({
        mkdtemp: create,
        nameGeneration,
        rename: stageRename,
        rm: removal,
      });
      const outcomes = await Promise.all([
        applyWith(fixture, firstRequest, dependencies),
        applyWith(secondFixture, secondRequest, dependencies),
      ]);
      expect(outcomes).toMatchObject([{ ok: true }, { ok: true }]);
      expect(stagePaths).toHaveLength(2);
      expect(new Set(stagePaths).size).toBe(2);
      expect(quarantineParents).toHaveLength(2);
      expect(new Set(quarantineParents).size).toBe(2);
      expect(renamePairs).toHaveLength(2);
      expect(new Set(renamePairs.map(([, child]) => child)).size).toBe(2);
      for (const [activeStage, child] of renamePairs) {
        expect(stagePaths).toContain(activeStage);
        expect(quarantineParents).toContain(join(child, ".."));
        expect(child).toBe(join(join(child, ".."), "s"));
      }
      expect(removal.mock.calls.map(([path]) => path).sort()).toEqual(
        [...quarantineParents].sort(),
      );
      for (const quarantineParent of quarantineParents) {
        await expect(base.lstat(quarantineParent)).rejects.toMatchObject({
          code: "ENOENT",
        });
      }
      expect(
        nameGeneration.mock.calls.filter(([kind]) => kind === "quarantine"),
      ).toHaveLength(2);
    } finally {
      await fixture.cleanup();
    }
  });

  it("keeps the injected scan seam as a fast reparse unit", async () => {
    const fixture = await createPatchProjectFixture("reparse");
    try {
      const mkdtemp = vi.fn(
        defaultApplySourcePatchDependencies.filesystem.mkdtemp,
      );
      const outcome = await applyWith(
        fixture,
        await requestForFiles(fixture, ["sources/a.json"]),
        {
          ...defaultApplySourcePatchDependencies,
          filesystem: {
            ...defaultApplySourcePatchDependencies.filesystem,
            mkdtemp,
          },
          scanProjectTree: vi.fn(async () => "sources/a.json"),
        },
      );
      expect(outcome).toMatchObject({
        ok: false,
        diagnostics: [],
        error: {
          code: "A003",
          file: "sources/a.json",
          reason: "reparse-point",
        },
        failureClass: "expected",
      });
      expect(mkdtemp).not.toHaveBeenCalled();
    } finally {
      await fixture.cleanup();
    }
  });

  it("detects a real runtime-created symlink or junction with the real scanner", async (context) => {
    const fixture = await createPatchProjectFixture("reparse");
    try {
      const target = join(fixture.root, "link-target");
      const link = join(fixture.projectRoot, "sources", "0-linked");
      const laterLink = join(fixture.projectRoot, "sources", "z-linked");
      await mkdir(target);
      await createDirectoryLinkOrSkip(context, target, link);
      await symlink(
        target,
        laterLink,
        process.platform === "win32" ? "junction" : "dir",
      );
      const mkdtemp = vi.fn(
        defaultApplySourcePatchDependencies.filesystem.mkdtemp,
      );
      const outcome = await applyWith(
        fixture,
        await requestForFiles(fixture, ["sources/a.json"]),
        dependenciesWithFilesystem({ mkdtemp }),
      );
      expect(outcome).toEqual({
        ok: false,
        diagnostics: [],
        error: {
          code: "A003",
          message:
            'A003 Unsafe source patch target "sources/0-linked": reparse point.',
          file: "sources/0-linked",
          reason: "reparse-point",
        },
        failureClass: "expected",
      });
      expect(mkdtemp).not.toHaveBeenCalled();
      await unlink(link);
      await unlink(laterLink);
    } finally {
      await fixture.cleanup();
    }
  });

  it("reports a real linked root as the frozen dot identifier", async (context) => {
    const fixture = await createPatchProjectFixture("reparse");
    try {
      const target = join(fixture.root, "root-target");
      const link = join(fixture.root, "linked-root");
      await mkdir(target);
      await createDirectoryLinkOrSkip(context, target, link);
      await expect(scanOrdinaryProjectTree(link)).resolves.toBe(".");
      await unlink(link);
    } finally {
      await fixture.cleanup();
    }
  });

  it.each([0, 1])(
    "restores all originals after commit failure at sorted position %i",
    async (failureIndex) => {
      const fixture = await createPatchProjectFixture("commit-failure");
      try {
        const paths = ["sources/a.json", "sources/b.json"] as const;
        const originals = new Map(
          await Promise.all(
            paths.map(
              async (path) =>
                [
                  path,
                  await readFile(join(fixture.projectRoot, path)),
                ] as const,
            ),
          ),
        );
        const failurePath = paths[failureIndex]!;
        let faultInjected = false;
        const writer = vi.fn(async (destination: string, data: Uint8Array) => {
          const original = originals.get(failurePath)!;
          if (
            !faultInjected &&
            destination.endsWith(failurePath.replace("sources/", "")) &&
            !Buffer.from(data).equals(original)
          ) {
            faultInjected = true;
            throw codedError("E_COMMIT");
          }
          await writeFileAtomically(destination, data);
        });
        const outcome = await applyWith(
          fixture,
          await requestForFiles(fixture, paths),
          {
            ...defaultApplySourcePatchDependencies,
            writeFileAtomically: writer,
          },
        );
        expect(outcome).toMatchObject({
          ok: false,
          diagnostics: [
            {
              code: "E001",
              message:
                "Agent apply-source-patch tool failure (commit-write/E_COMMIT).",
            },
          ],
          error: null,
          failureClass: "tool",
        });
        for (const path of paths) {
          expect(await readFile(join(fixture.projectRoot, path))).toEqual(
            originals.get(path),
          );
        }
        expect(writer).toHaveBeenCalledTimes(failureIndex === 0 ? 1 : 3);
      } finally {
        await fixture.cleanup();
      }
    },
  );

  it("replaces a primary commit failure with the first rollback failure", async () => {
    const fixture = await createPatchProjectFixture("rollback-failure");
    try {
      const paths = ["sources/a.json", "sources/b.json"] as const;
      const originalA = await readFile(join(fixture.projectRoot, paths[0]));
      const writer = vi.fn(async (destination: string, data: Uint8Array) => {
        if (destination.endsWith("b.json")) {
          throw codedError("E_COMMIT");
        }
        if (
          destination.endsWith("a.json") &&
          Buffer.from(data).equals(originalA)
        ) {
          throw codedError("E_ROLLBACK");
        }
        await writeFileAtomically(destination, data);
      });
      const outcome = await applyWith(
        fixture,
        await requestForFiles(fixture, paths),
        {
          ...defaultApplySourcePatchDependencies,
          writeFileAtomically: writer,
        },
      );
      expect(outcome).toMatchObject({
        ok: false,
        diagnostics: [
          {
            code: "E001",
            message:
              "Agent apply-source-patch tool failure (rollback-write/E_ROLLBACK).",
          },
        ],
        error: null,
        failureClass: "tool",
      });
      expect(outcome.ok).toBe(false);
      expect(await readFile(join(fixture.projectRoot, paths[0]))).not.toEqual(
        originalA,
      );
    } finally {
      await fixture.cleanup();
    }
  });
});

describe("D10 real source-chain rechecks", () => {
  it("catches a real ancestor swap at the pre-first-write chain check", async (context) => {
    const fixture = await createPatchProjectFixture("clean");
    try {
      await proveDirectoryLinkCapability(context, fixture);
      const writer = vi.fn(
        defaultApplySourcePatchDependencies.writeFileAtomically,
      );
      let validationCalls = 0;
      const outcome = await applyWith(
        fixture,
        await requestForFiles(fixture, ["sources/a.json"]),
        {
          ...defaultApplySourcePatchDependencies,
          writeFileAtomically: writer,
          async validateSourceChain(project, document) {
            validationCalls += 1;
            if (validationCalls === 1) {
              await swapSourcesDirectoryForLink(fixture);
            }
            return validateProjectSourceChain(
              project,
              document,
              defaultApplySourcePatchDependencies.filesystem,
            );
          },
        },
      );
      expect(outcome).toMatchObject({
        ok: false,
        diagnostics: [],
        error: {
          code: "A003",
          file: "sources/a.json",
          reason: "reparse-point",
        },
        failureClass: "expected",
      });
      expect(writer).not.toHaveBeenCalled();
    } finally {
      await fixture.cleanup();
    }
  });

  it("catches a real ancestor swap at a later per-target recheck and rolls back", async (context) => {
    const fixture = await createPatchProjectFixture("clean");
    try {
      await proveDirectoryLinkCapability(context, fixture);
      const paths = ["sources/a.json", "sources/b.json"] as const;
      const originals = new Map(
        await Promise.all(
          paths.map(
            async (path) =>
              [path, await readFile(join(fixture.projectRoot, path))] as const,
          ),
        ),
      );
      const writer = vi.fn(
        defaultApplySourcePatchDependencies.writeFileAtomically,
      );
      let validationCalls = 0;
      const outcome = await applyWith(
        fixture,
        await requestForFiles(fixture, paths),
        {
          ...defaultApplySourcePatchDependencies,
          writeFileAtomically: writer,
          async validateSourceChain(project, document) {
            validationCalls += 1;
            if (validationCalls === 4) {
              await swapSourcesDirectoryForLink(fixture);
            }
            return validateProjectSourceChain(
              project,
              document,
              defaultApplySourcePatchDependencies.filesystem,
            );
          },
        },
      );
      expect(outcome).toMatchObject({
        ok: false,
        diagnostics: [],
        error: {
          code: "A003",
          file: "sources/b.json",
          reason: "reparse-point",
        },
        failureClass: "expected",
      });
      expect(writer).toHaveBeenCalledTimes(2);
      for (const path of paths) {
        expect(await readFile(join(fixture.projectRoot, path))).toEqual(
          originals.get(path),
        );
      }
    } finally {
      await fixture.cleanup();
    }
  });
});

describe("D10 real controlled-snapshot mutation classes", () => {
  it.each([
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
  ])(
    "returns frozen A004 for a real $name mutation between staging and precommit",
    async ({ kind, diskPath, displayFile, request }) => {
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
        const expectedIntegrity =
          before === undefined ? "missing" : computeFileIntegrity(before);
        const actualIntegrity = computeFileIntegrity(changed);
        expect(outcome).toEqual({
          ok: false,
          diagnostics: [],
          error: {
            code: "A004",
            message: `A004 Guarded file ${JSON.stringify(displayFile)} does not match its required integrity.`,
            file: displayFile,
            expectedIntegrity,
            actualIntegrity,
          },
          failureClass: "expected",
        });
        expect(captureCalls).toBe(2);
      } finally {
        await fixture.cleanup();
      }
    },
  );
});

it("gives an authored presentation its frozen rank before project sources", async () => {
  const fixture = await createPatchProjectFixture("clean");
  try {
    const manifestPath = join(fixture.projectRoot, "system.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<
      string,
      unknown
    >;
    manifest.presentation = "presentation.json";
    await writeFile(
      manifestPath,
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );
    const presentationPath = join(fixture.projectRoot, "presentation.json");
    const presentationBytes = Buffer.from(
      `${JSON.stringify(
        {
          format: "project-presentation/0.1",
          revision: "A",
          backgroundColor: "#ffffff",
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writeFile(presentationPath, presentationBytes);
    const changedPresentation = Buffer.concat([
      presentationBytes,
      Buffer.from("\n", "utf8"),
    ]);
    const sourcePath = join(fixture.projectRoot, "sources", "a.json");
    const sourceBytes = await readFile(sourcePath);
    let captureCalls = 0;
    const filesystem = defaultApplySourcePatchDependencies.filesystem;
    const outcome = await applyWith(
      fixture,
      await requestForFiles(fixture, ["sources/a.json"]),
      {
        ...defaultApplySourcePatchDependencies,
        async captureSnapshot(project) {
          captureCalls += 1;
          if (captureCalls === 2) {
            await writeFile(presentationPath, changedPresentation);
            await writeFile(
              sourcePath,
              Buffer.concat([sourceBytes, Buffer.from("\n", "utf8")]),
            );
          }
          return captureProjectControlledSnapshot(project, filesystem);
        },
      },
    );
    expect(outcome).toEqual({
      ok: false,
      diagnostics: [],
      error: {
        code: "A004",
        message:
          'A004 Guarded file "presentation.json" does not match its required integrity.',
        file: "presentation.json",
        expectedIntegrity: computeFileIntegrity(presentationBytes),
        actualIntegrity: computeFileIntegrity(changedPresentation),
      },
      failureClass: "expected",
    });
    expect(captureCalls).toBe(2);
  } finally {
    await fixture.cleanup();
  }
});

describe("D10 staged warning provenance", () => {
  it("carries staged W901/W902 only to a frozen success", async () => {
    const fixture = await createPatchProjectFixture("clean");
    try {
      const outcome = await applyWith(
        fixture,
        await requestForFiles(fixture, ["sources/a.json"], true),
        dependenciesWithStagedWarnings(),
      );
      expect(outcome).toEqual({
        ok: true,
        diagnostics: STAGED_WARNINGS,
        value: expect.objectContaining({ dryRun: true, applied: false }),
      });
      expect(Object.isFrozen(outcome)).toBe(true);
      expect(Object.isFrozen(outcome.diagnostics)).toBe(true);
    } finally {
      await fixture.cleanup();
    }
  });

  it("discards staged W901/W902 when a later real mutation returns A004", async () => {
    const fixture = await createPatchProjectFixture("clean");
    try {
      const path = join(fixture.projectRoot, "sources", "b.json");
      const before = await readFile(path);
      let captureCalls = 0;
      const filesystem = defaultApplySourcePatchDependencies.filesystem;
      const outcome = await applyWith(
        fixture,
        await requestForFiles(fixture, ["sources/a.json"]),
        dependenciesWithStagedWarnings({
          async captureSnapshot(project) {
            captureCalls += 1;
            if (captureCalls === 2) {
              await writeFile(path, Buffer.concat([before, Buffer.from("\n")]));
            }
            return captureProjectControlledSnapshot(project, filesystem);
          },
        }),
      );
      expect(outcome).toMatchObject({
        ok: false,
        diagnostics: [],
        error: { code: "A004", file: "sources/b.json" },
        failureClass: "expected",
      });
      expect(JSON.stringify(outcome)).not.toContain("W901");
      expect(JSON.stringify(outcome)).not.toContain("W902");
    } finally {
      await fixture.cleanup();
    }
  });

  it("replaces staged W901/W902 with first-failing cleanup E001", async () => {
    const fixture = await createPatchProjectFixture("clean");
    try {
      const cleanup = vi.fn(async () => {
        throw codedError("E_CLEANUP");
      });
      const outcome = await applyWith(
        fixture,
        await requestForFiles(fixture, ["sources/a.json"], true),
        dependenciesWithStagedWarnings({
          filesystem: {
            ...defaultApplySourcePatchDependencies.filesystem,
            rm: cleanup,
          },
        }),
      );
      expect(outcome).toMatchObject({
        ok: false,
        diagnostics: [
          {
            code: "E001",
            message:
              "Agent apply-source-patch tool failure (stage-cleanup/E_CLEANUP).",
          },
        ],
        error: null,
        failureClass: "tool",
      });
      expect(JSON.stringify(outcome)).not.toContain("W901");
      expect(JSON.stringify(outcome)).not.toContain("W902");
      expect(cleanup).toHaveBeenCalledTimes(2);
    } finally {
      await fixture.cleanup();
    }
  });
});

describe("D10 first-failure-wins cleanup provenance", () => {
  it("keeps stage-copy provenance when owned cleanup also fails", async () => {
    const fixture = await createPatchProjectFixture("staged-failure");
    try {
      const cleanup = vi.fn(async () => {
        throw codedError("E_CLEANUP");
      });
      const outcome = await applyWith(
        fixture,
        await requestForFiles(fixture, ["sources/a.json"]),
        dependenciesWithFilesystem(
          { rm: cleanup },
          {
            copyProjectTree: vi.fn(async () => {
              throw codedError("E_COPY");
            }),
          },
        ),
      );
      expect(outcome).toMatchObject({
        ok: false,
        diagnostics: [
          {
            code: "E001",
            message:
              "Agent apply-source-patch tool failure (stage-copy/E_COPY).",
          },
        ],
        error: null,
        failureClass: "tool",
      });
      expect(JSON.stringify(outcome)).not.toContain("E_CLEANUP");
      expect(cleanup).toHaveBeenCalledTimes(2);
      expect(new Set(cleanup.mock.calls.map(([path]) => path)).size).toBe(1);
    } finally {
      await fixture.cleanup();
    }
  });

  it("keeps stage-write provenance when owned cleanup also fails", async () => {
    const fixture = await createPatchProjectFixture("staged-failure");
    try {
      const cleanup = vi.fn(async () => {
        throw codedError("E_CLEANUP");
      });
      const outcome = await applyWith(
        fixture,
        await requestForFiles(fixture, ["sources/a.json"]),
        dependenciesWithFilesystem({
          writeFile: vi.fn(async () => {
            throw codedError("E_STAGE_WRITE");
          }),
          rm: cleanup,
        }),
      );
      expect(outcome).toMatchObject({
        ok: false,
        diagnostics: [
          {
            code: "E001",
            message:
              "Agent apply-source-patch tool failure (stage-write/E_STAGE_WRITE).",
          },
        ],
        error: null,
        failureClass: "tool",
      });
      expect(JSON.stringify(outcome)).not.toContain("E_CLEANUP");
      expect(cleanup).toHaveBeenCalledTimes(2);
    } finally {
      await fixture.cleanup();
    }
  });

  it("keeps the staged-compile call-phase array when cleanup fails", async () => {
    const fixture = await createPatchProjectFixture("staged-failure");
    try {
      const authored: Diagnostic = {
        code: "E100",
        severity: "error",
        message: "Authored staged failure.",
        file: "sources/a.json",
        line: 1,
        column: 1,
        jsonPointer: "/objects",
      };
      const cleanup = vi.fn(async () => {
        throw codedError("E_CLEANUP");
      });
      const outcome = await applyWith(
        fixture,
        await requestForFiles(fixture, ["sources/a.json"]),
        dependenciesWithFilesystem(
          { rm: cleanup },
          {
            compileProject: vi.fn(async () => ({
              ok: false as const,
              diagnostics: [authored],
              toolFailure: false,
            })),
          },
        ),
      );
      expect(outcome).toEqual({
        ok: false,
        diagnostics: [authored],
        error: null,
        failureClass: "expected",
      });
      expect(cleanup).toHaveBeenCalledTimes(2);
    } finally {
      await fixture.cleanup();
    }
  });

  it("keeps A004 when the defensive final cleanup also fails", async () => {
    const fixture = await createPatchProjectFixture("stale");
    try {
      const baseFilesystem = defaultApplySourcePatchDependencies.filesystem;
      let quarantineParent: string | undefined;
      let parentInspectionCalls = 0;
      const cleanup = vi.fn(baseFilesystem.rm);
      const filesystem: PatchFilesystemDependencies = {
        ...baseFilesystem,
        primaryStageRemovalIsConfirmed: () => false,
        async mkdtemp(prefix) {
          const path = await baseFilesystem.mkdtemp(prefix);
          if (prefix.includes(".thermite-schematics-quarantine-")) {
            quarantineParent = path;
          }
          return path;
        },
        async lstat(path) {
          if (path === quarantineParent) {
            parentInspectionCalls += 1;
            if (parentInspectionCalls === 2) {
              throw codedError("E_FINAL_CLEANUP");
            }
          }
          return baseFilesystem.lstat(path);
        },
        rm: cleanup,
      };
      let captureCalls = 0;
      const dependencies: ApplySourcePatchDependencies = {
        ...defaultApplySourcePatchDependencies,
        filesystem,
        async captureSnapshot(project) {
          captureCalls += 1;
          const captured = await captureProjectControlledSnapshot(
            project,
            filesystem,
          );
          if (captureCalls !== 2 || !captured.ok) return captured;
          return {
            ok: true,
            snapshot: Object.freeze(
              captured.snapshot.map((entry, index) =>
                index === 0
                  ? {
                      ...entry,
                      integrity: computeFileIntegrity(
                        Buffer.from("changed", "utf8"),
                      ),
                    }
                  : entry,
              ),
            ),
          };
        },
      };
      const outcome = await applyWith(
        fixture,
        await requestForFiles(fixture, ["sources/a.json"]),
        dependencies,
      );
      expect(outcome).toMatchObject({
        ok: false,
        diagnostics: [],
        error: { code: "A004" },
        failureClass: "expected",
      });
      expect(JSON.stringify(outcome)).not.toContain("E_FINAL_CLEANUP");
      expectQuarantinePathIsInternal(outcome, quarantineParent!);
      expect(cleanup).toHaveBeenCalledTimes(1);
      expect(parentInspectionCalls).toBe(2);
    } finally {
      await fixture.cleanup();
    }
  });

  it("reports final cleanup after commit as the first failure and leaves the commit", async () => {
    const fixture = await createPatchProjectFixture("commit-failure");
    try {
      const path = "sources/a.json";
      const sourcePath = join(fixture.projectRoot, path);
      const before = await readFile(sourcePath);
      const baseFilesystem = defaultApplySourcePatchDependencies.filesystem;
      let quarantineParent: string | undefined;
      let parentInspectionCalls = 0;
      const cleanup = vi.fn(baseFilesystem.rm);
      const filesystem: PatchFilesystemDependencies = {
        ...baseFilesystem,
        primaryStageRemovalIsConfirmed: () => false,
        async mkdtemp(prefix) {
          const created = await baseFilesystem.mkdtemp(prefix);
          if (prefix.includes(".thermite-schematics-quarantine-")) {
            quarantineParent = created;
          }
          return created;
        },
        async lstat(candidate) {
          if (candidate === quarantineParent) {
            parentInspectionCalls += 1;
            if (parentInspectionCalls === 2) {
              throw codedError("E_FINAL_CLEANUP");
            }
          }
          return baseFilesystem.lstat(candidate);
        },
        rm: cleanup,
      };
      const outcome = await applyWith(
        fixture,
        await requestForFiles(fixture, [path]),
        {
          ...defaultApplySourcePatchDependencies,
          filesystem,
        },
      );
      expect(outcome).toMatchObject({
        ok: false,
        diagnostics: [
          {
            code: "E001",
            message:
              "Agent apply-source-patch tool failure (stage-cleanup/E_FINAL_CLEANUP).",
          },
        ],
        error: null,
        failureClass: "tool",
      });
      expect(await readFile(sourcePath)).not.toEqual(before);
      expectQuarantinePathIsInternal(outcome, quarantineParent!);
      expect(cleanup).toHaveBeenCalledTimes(1);
      expect(parentInspectionCalls).toBe(2);
    } finally {
      await fixture.cleanup();
    }
  });
});

type ShippedMatrixChange =
  | "manifest-missing"
  | "manifest-version"
  | "source-mutation"
  | "source-removal";

type ShippedMatrixPhase =
  | "before-project-load"
  | "after-initial-snapshot"
  | "before-precommit-load"
  | "after-precommit-load";

interface ShippedPatchFixture extends PatchProjectFixture {
  readonly coreLibraryRoot: string;
  readonly shippedResolution: ReturnType<typeof resolveShippedCoreLibrary>;
}

interface ShippedMatrixObservations {
  loadCalls: number;
  compileCalls: number;
  captureCalls: number;
  mutationCalls: number;
}

async function createShippedPatchFixture(): Promise<ShippedPatchFixture> {
  const root = await mkdtemp(
    join(resolve(tmpdir()), "thermite-schematics-m8-shipped-matrix-"),
  );
  const projectRoot = join(root, "project");
  const packageRootPath = join(root, "core-package");
  const coreLibraryRoot = join(packageRootPath, "library");
  try {
    await cp(resolve("examples", "motor-starter"), projectRoot, {
      recursive: true,
      dereference: false,
      errorOnExist: true,
      force: false,
      verbatimSymlinks: true,
    });
    await mkdir(packageRootPath);
    await cp(resolve("packages", "core-library", "library"), coreLibraryRoot, {
      recursive: true,
      dereference: false,
      errorOnExist: true,
      force: false,
      verbatimSymlinks: true,
    });
    const shipped = resolveShippedCoreLibrary();
    return {
      kind: "clean",
      root,
      projectRoot,
      coreLibraryRoot,
      shippedResolution: {
        ...shipped,
        packageRootPath,
        libraryRootPath: coreLibraryRoot,
      },
      async cleanup() {
        await rm(root, {
          recursive: true,
          force: true,
          maxRetries: 2,
          retryDelay: 50,
        });
      },
    };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

async function applyShippedMatrixChange(
  fixture: ShippedPatchFixture,
  change: ShippedMatrixChange,
): Promise<void> {
  const manifestPath = join(fixture.coreLibraryRoot, "library.json");
  const sourcePath = join(fixture.coreLibraryRoot, "types", "breaker-3p.json");
  switch (change) {
    case "manifest-missing":
      await unlink(manifestPath);
      return;
    case "manifest-version": {
      const manifest = JSON.parse(
        await readFile(manifestPath, "utf8"),
      ) as Record<string, unknown>;
      manifest.version = "9.9.9";
      await writeFile(
        manifestPath,
        `${JSON.stringify(manifest, undefined, 2)}\n`,
        "utf8",
      );
      return;
    }
    case "source-mutation":
      await writeFile(
        sourcePath,
        Buffer.concat([await readFile(sourcePath), Buffer.from("\n", "utf8")]),
      );
      return;
    case "source-removal":
      await unlink(sourcePath);
  }
}

function expectedShippedDiagnostic(
  change: Exclude<ShippedMatrixChange, "manifest-missing">,
): readonly Diagnostic[] {
  switch (change) {
    case "manifest-version":
      return [
        {
          code: "E028",
          severity: "error",
          message:
            'Dependency version "0.1.0" does not match library version "9.9.9".',
          file: "system.json",
          line: 15,
          column: 46,
          jsonPointer: "/libraries/0/version",
          related: [
            {
              file: "@thermite/core-library/library.json",
              line: 4,
              column: 14,
              note: 'Library declares version "9.9.9".',
            },
          ],
        },
      ];
    case "source-mutation":
      return [
        {
          code: "E108",
          severity: "error",
          message:
            'Library "core" file "types/breaker-3p.json" integrity does not match the lock.',
          file: "@thermite/core-library/types/breaker-3p.json",
          line: 1,
          column: 1,
          jsonPointer: "",
          related: [
            {
              file: "electrical-system.lock.json",
              line: 13,
              column: 34,
              note: 'Locked integrity is "sha256-Y8k6Cj6352pSrxFex6v4tzTsTSO6yk5uyYFtkKEb19c=".',
            },
          ],
        },
      ];
    case "source-removal":
      return [
        {
          code: "E107",
          severity: "error",
          message:
            'Library "core" file set differs: added []; removed ["types/breaker-3p.json"].',
          file: "electrical-system.lock.json",
          line: 11,
          column: 16,
          jsonPointer: "/libraries/core/files",
          related: [
            {
              file: "@thermite/core-library/library.json",
              line: 5,
              column: 14,
              note: "Current library source globs declare this file set.",
            },
          ],
        },
      ];
  }
}

function expectedMatrixDiagnostics(
  change: ShippedMatrixChange,
  missingStage: "project-load" | "stage-compile" | "precommit-load",
): readonly Diagnostic[] {
  return change === "manifest-missing"
    ? [
        {
          code: "E001",
          severity: "error",
          message: `Agent apply-source-patch tool failure (${missingStage}/E001).`,
          file: "@thermite/core-library/library.json",
          line: 1,
          column: 1,
          jsonPointer: "",
        },
      ]
    : expectedShippedDiagnostic(change);
}

function shippedMatrixDependencies(
  fixture: ShippedPatchFixture,
  phase: ShippedMatrixPhase,
  observations: ShippedMatrixObservations,
  change: ShippedMatrixChange,
): ApplySourcePatchDependencies {
  let mutated = false;
  const mutate = async (): Promise<void> => {
    if (mutated) throw new Error("Shipped matrix mutation ran more than once.");
    mutated = true;
    observations.mutationCalls += 1;
    await applyShippedMatrixChange(fixture, change);
  };
  return {
    ...defaultApplySourcePatchDependencies,
    loadProject: async (inputPath, cwd) => {
      observations.loadCalls += 1;
      if (phase === "before-precommit-load" && observations.loadCalls === 2) {
        await mutate();
      }
      const loaded = await loadProject(inputPath, cwd, {
        resolveShippedCoreLibrary: () => fixture.shippedResolution,
      });
      if (
        phase === "after-precommit-load" &&
        observations.loadCalls === 2 &&
        loaded.ok
      ) {
        await mutate();
      }
      return loaded;
    },
    compileProject: async (inputPath, cwd) => {
      observations.compileCalls += 1;
      return compileProject(inputPath, cwd, {
        resolveShippedCoreLibrary: () => fixture.shippedResolution,
      });
    },
    async captureSnapshot(project) {
      observations.captureCalls += 1;
      const captured = await captureProjectControlledSnapshot(
        project,
        defaultApplySourcePatchDependencies.filesystem,
      );
      if (
        phase === "after-initial-snapshot" &&
        observations.captureCalls === 1 &&
        captured.ok
      ) {
        await mutate();
      }
      return captured;
    },
  };
}

async function shippedPresentationRequest(
  fixture: ShippedPatchFixture,
): Promise<ApplySourcePatchRequest> {
  return requestForFiles(fixture, ["presentation.json"], false, () => [
    { op: "replace", path: "/revision", value: "B" },
  ]);
}

describe("D7 shipped-package violation phase matrix", () => {
  it.each([
    {
      phase: "before-project-load" as const,
      change: "manifest-missing" as const,
      missingStage: "project-load" as const,
    },
    {
      phase: "before-project-load" as const,
      change: "manifest-version" as const,
      missingStage: "project-load" as const,
    },
    {
      phase: "before-project-load" as const,
      change: "source-mutation" as const,
      missingStage: "stage-compile" as const,
    },
    {
      phase: "before-project-load" as const,
      change: "source-removal" as const,
      missingStage: "stage-compile" as const,
    },
    {
      phase: "after-initial-snapshot" as const,
      change: "manifest-missing" as const,
      missingStage: "stage-compile" as const,
    },
    {
      phase: "after-initial-snapshot" as const,
      change: "manifest-version" as const,
      missingStage: "stage-compile" as const,
    },
    {
      phase: "after-initial-snapshot" as const,
      change: "source-mutation" as const,
      missingStage: "stage-compile" as const,
    },
    {
      phase: "after-initial-snapshot" as const,
      change: "source-removal" as const,
      missingStage: "stage-compile" as const,
    },
    {
      phase: "before-precommit-load" as const,
      change: "manifest-missing" as const,
      missingStage: "precommit-load" as const,
    },
    {
      phase: "before-precommit-load" as const,
      change: "manifest-version" as const,
      missingStage: "precommit-load" as const,
    },
  ])(
    "returns the exact first diagnostic for $change at $phase with no A-code or commit",
    async ({ phase, change, missingStage }) => {
      const fixture = await createShippedPatchFixture();
      try {
        const observations: ShippedMatrixObservations = {
          loadCalls: 0,
          compileCalls: 0,
          captureCalls: 0,
          mutationCalls: 0,
        };
        const dependencies = shippedMatrixDependencies(
          fixture,
          phase,
          observations,
          change,
        );
        if (phase === "before-project-load") {
          await applyShippedMatrixChange(fixture, change);
          observations.mutationCalls += 1;
        }
        const outcome = await applyWith(
          fixture,
          await shippedPresentationRequest(fixture),
          dependencies,
        );
        expect(outcome).toEqual({
          ok: false,
          diagnostics: expectedMatrixDiagnostics(change, missingStage),
          error: null,
          failureClass: change === "manifest-missing" ? "tool" : "expected",
        });
        expect(JSON.stringify(outcome)).not.toMatch(/"code":"A00[34]"/u);
        expect(
          JSON.parse(
            await readFile(
              join(fixture.projectRoot, "presentation.json"),
              "utf8",
            ),
          ).revision,
        ).toBe("A");
        expect(observations.mutationCalls).toBe(1);
      } finally {
        await fixture.cleanup();
      }
    },
  );

  it.each([
    {
      phase: "before-precommit-load" as const,
      change: "source-mutation" as const,
    },
    {
      phase: "before-precommit-load" as const,
      change: "source-removal" as const,
    },
    {
      phase: "after-precommit-load" as const,
      change: "source-mutation" as const,
    },
    {
      phase: "after-precommit-load" as const,
      change: "source-removal" as const,
    },
  ])(
    "excludes $change at $phase for this invocation and reports it on the next compile",
    async ({ phase, change }) => {
      const fixture = await createShippedPatchFixture();
      try {
        const observations: ShippedMatrixObservations = {
          loadCalls: 0,
          compileCalls: 0,
          captureCalls: 0,
          mutationCalls: 0,
        };
        const dependencies = shippedMatrixDependencies(
          fixture,
          phase,
          observations,
          change,
        );
        const outcome = await applyWith(
          fixture,
          await shippedPresentationRequest(fixture),
          dependencies,
        );
        expect(outcome).toEqual({
          ok: true,
          diagnostics: [],
          value: {
            dryRun: false,
            applied: true,
            atomicity: "per-file",
            files: [
              {
                path: "presentation.json",
                beforeIntegrity:
                  "sha256-mlxEGgG8M991GWqwHjXitHdw08GwJOLQ/RMy3/hP+QA=",
                afterIntegrity:
                  "sha256-TEXwCdEqteuiqJwXCP8RkTqOj/f5UVTkkyutW+Qzzs0=",
                byteLength: 262,
                changed: true,
              },
            ],
          },
        });
        expect(JSON.stringify(outcome)).not.toMatch(/"code":"A00[34]"/u);
        expect(observations).toEqual({
          loadCalls: 2,
          compileCalls: 1,
          captureCalls: 2,
          mutationCalls: 1,
        });

        const nextCompile = await compileProject(
          fixture.projectRoot,
          process.cwd(),
          {
            resolveShippedCoreLibrary: () => fixture.shippedResolution,
          },
        );
        expect(nextCompile).toEqual({
          ok: false,
          diagnostics: expectedShippedDiagnostic(change),
          toolFailure: false,
        });
      } finally {
        await fixture.cleanup();
      }
    },
  );
});
