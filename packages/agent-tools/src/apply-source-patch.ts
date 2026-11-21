import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

import {
  compileProject,
  computeFileIntegrity,
  PROJECT_WRITE_LOCK_FILE_NAME,
  loadProjectForSourcePatch,
  writeFileAtomically,
  type AtomicWriteOptions,
  type CompileResult,
  type LoadedDocument,
  type SourcePatchProject,
  type SourcePatchLoadResult,
} from "@thermite/compiler";
import type { Diagnostic } from "@thermite/schema";

import type {
  AgentToolOutcome,
  DeepReadonly,
  JsonValue,
} from "./common/contracts.js";
import {
  createA003Error,
  createA004Error,
  createA006Error,
  type AgentToolError,
} from "./common/errors.js";
import { detachedFrozenCopy } from "./common/immutable.js";
import {
  diagnosticForReadToolException,
  sanitizedErrorCode,
  sanitizeToolFailureDiagnostics,
  type ReadToolFailureStage,
} from "./common/tool-failure.js";
import {
  captureProjectControlledSnapshot,
  captureOwnedStageDirectory,
  compareProjectControlledSnapshots,
  copyOrdinaryProjectTree,
  createOwnedStageCleanup,
  defaultPatchFilesystemDependencies,
  ownedStageCleanupNeedsFinalAttempt,
  removeOwnedStageDirectory,
  scanOrdinaryProjectTree,
  isSourceChainMismatchError,
  stageDirectoryPrefix,
  validateProjectSourceChain,
  type FileStatus,
  type OwnedStageCleanup,
  type PatchFilesystemDependencies,
  type ProjectControlledSnapshot,
  type ProjectControlledSnapshotResult,
} from "./patch-filesystem.js";
import { reserveProjectWrite } from "./project-write-lock.js";
import {
  createSourcePatchPlan,
  type SourcePatchTargetSnapshot,
} from "./source-patch.js";
import {
  validateApplySourcePatchRequest,
  type ApplySourcePatchRequest,
} from "./source-patch-request.js";
import type {
  AppliedSourceFile,
  SourceByteProposal,
} from "./source-serializer.js";

export interface ApplySourcePatchValue {
  readonly dryRun: boolean;
  readonly applied: boolean;
  readonly atomicity: "per-file";
  readonly files: readonly AppliedSourceFile[];
}

export interface InternalApplySourcePatchOptions {
  readonly cwd?: string;
}

export interface ApplySourcePatchDependencies {
  readonly compileProject: (
    inputPath: string | undefined,
    cwd: string,
  ) => Promise<CompileResult>;
  readonly loadProject: (
    inputPath: string | undefined,
    cwd: string,
  ) => Promise<SourcePatchLoadResult>;
  readonly writeFileAtomically: (
    destinationPath: string,
    data: Uint8Array,
    options?: AtomicWriteOptions,
  ) => Promise<void>;
  readonly filesystem: PatchFilesystemDependencies;
  readonly reserveProjectWrite?: typeof reserveProjectWrite;
  readonly captureSnapshot?: (
    project: SourcePatchProject,
  ) => Promise<ProjectControlledSnapshotResult>;
  readonly copyProjectTree?: (
    sourceRoot: string,
    destinationRoot: string,
  ) => Promise<void>;
  readonly scanProjectTree?: (root: string) => Promise<string | undefined>;
  readonly validateSourceChain?: (
    project: SourcePatchProject,
    document: LoadedDocument<unknown>,
  ) => Promise<boolean>;
}

export interface InternalApplySourcePatchTool {
  readonly applySourcePatch: (
    request: DeepReadonly<ApplySourcePatchRequest>,
  ) => Promise<AgentToolOutcome<ApplySourcePatchValue, AgentToolError>>;
}

export const defaultApplySourcePatchDependencies: ApplySourcePatchDependencies =
  Object.freeze({
    compileProject,
    loadProject: loadProjectForSourcePatch,
    writeFileAtomically,
    filesystem: defaultPatchFilesystemDependencies,
  });

type PatchOutcome = AgentToolOutcome<ApplySourcePatchValue, AgentToolError>;
type PatchFailureOutcome = Extract<PatchOutcome, { readonly ok: false }>;
type ProjectSourceDocument = LoadedDocument<unknown>;

function failureOutcome(
  diagnostics: readonly DeepReadonly<Diagnostic>[],
  error: AgentToolError | null,
  failureClass: "expected" | "tool",
): PatchFailureOutcome {
  return { ok: false, diagnostics, error, failureClass };
}

function successOutcome(
  diagnostics: readonly DeepReadonly<Diagnostic>[],
  value: ApplySourcePatchValue,
): PatchOutcome {
  return { ok: true, diagnostics, value };
}

function exceptionOutcome(
  stage: ReadToolFailureStage,
  error: unknown,
  file?: string,
): PatchFailureOutcome {
  return failureOutcome(
    diagnosticForReadToolException("apply-source-patch", stage, error, file),
    null,
    "tool",
  );
}

function finish(outcome: PatchOutcome): PatchOutcome {
  try {
    return detachedFrozenCopy(outcome) as PatchOutcome;
  } catch (error) {
    return detachedFrozenCopy(exceptionOutcome("unexpected", error));
  }
}

function returnedCallFailure(
  result: Extract<
    SourcePatchLoadResult | CompileResult,
    { readonly ok: false }
  >,
  stage: "project-load" | "stage-compile" | "precommit-load",
): PatchFailureOutcome {
  const diagnostics = result.toolFailure
    ? sanitizeToolFailureDiagnostics(
        "apply-source-patch",
        stage,
        result.diagnostics,
      )
    : result.diagnostics;
  return failureOutcome(
    diagnostics,
    !result.toolFailure ? unpatchableJsonError(diagnostics) : null,
    result.toolFailure ? "tool" : "expected",
  );
}

function unpatchableJsonError(
  diagnostics: readonly Diagnostic[],
): AgentToolError | null {
  const parserError = diagnostics.find(
    ({ code }) => code === "E002" || code === "E003",
  );
  return parserError === undefined
    ? null
    : createA006Error(parserError.file, parserError.line, parserError.column);
}

function manifestRelativePath(project: SourcePatchProject): string | undefined {
  const value = relative(project.logicalRootPath, project.manifest.logicalPath);
  return value !== "" &&
    value !== ".." &&
    !value.startsWith(`..${sep}`) &&
    !isAbsolute(value)
    ? value
    : undefined;
}

function patchableProjectDocuments(
  project: SourcePatchProject,
): readonly ProjectSourceDocument[] {
  const documents: ProjectSourceDocument[] = [
    ...project.sources,
    ...(project.presentation === undefined ? [] : [project.presentation]),
  ];
  return documents.filter(
    (document) =>
      document.owner.kind === "project" &&
      (document.kind === "project_source" ||
        document.kind === "project_presentation"),
  );
}

function projectTargets(
  project: SourcePatchProject,
): ReadonlyMap<string, SourcePatchTargetSnapshot> {
  return new Map(
    patchableProjectDocuments(project).map((document) => [
      document.file,
      {
        rawBytes: document.rawBytes,
        value: document.value as unknown as JsonValue,
      },
    ]),
  );
}

function projectDocuments(
  project: SourcePatchProject,
): ReadonlyMap<string, ProjectSourceDocument> {
  return new Map(
    patchableProjectDocuments(project).map((document) => [
      document.file,
      document,
    ]),
  );
}

async function scanProject(
  root: string,
  dependencies: ApplySourcePatchDependencies,
): Promise<string | undefined> {
  return dependencies.scanProjectTree === undefined
    ? scanOrdinaryProjectTree(root, dependencies.filesystem)
    : dependencies.scanProjectTree(root);
}

async function copyProject(
  sourceRoot: string,
  destinationRoot: string,
  dependencies: ApplySourcePatchDependencies,
): Promise<void> {
  if (dependencies.copyProjectTree !== undefined) {
    await dependencies.copyProjectTree(sourceRoot, destinationRoot);
    return;
  }
  await copyOrdinaryProjectTree(
    sourceRoot,
    destinationRoot,
    dependencies.filesystem,
  );
}

async function snapshotProject(
  project: SourcePatchProject,
  dependencies: ApplySourcePatchDependencies,
): Promise<ProjectControlledSnapshotResult> {
  return dependencies.captureSnapshot === undefined
    ? captureProjectControlledSnapshot(project, dependencies.filesystem)
    : dependencies.captureSnapshot(project);
}

async function sourceChainIsValid(
  project: SourcePatchProject,
  document: ProjectSourceDocument,
  dependencies: ApplySourcePatchDependencies,
): Promise<boolean> {
  return dependencies.validateSourceChain === undefined
    ? validateProjectSourceChain(
        project,
        document,
        dependencies.filesystem,
        true,
      )
    : dependencies.validateSourceChain(project, document);
}

function proposalValue(
  request: ApplySourcePatchRequest,
  proposals: readonly SourceByteProposal[],
  applied: boolean,
): ApplySourcePatchValue {
  return {
    dryRun: request.dryRun,
    applied,
    atomicity: "per-file",
    files: proposals.map(({ file }) => file),
  };
}

interface SourceIdentity {
  readonly directories: readonly {
    readonly path: string;
    readonly status: FileStatus;
  }[];
}

function sameIdentity(a: FileStatus, b: FileStatus): boolean {
  return a.dev === b.dev && a.ino === b.ino && !b.isSymbolicLink();
}

async function captureSourceIdentity(
  project: SourcePatchProject,
  document: ProjectSourceDocument,
  dependencies: ApplySourcePatchDependencies,
): Promise<SourceIdentity> {
  const directories = [];
  let path = dirname(document.logicalPath);
  while (true) {
    directories.push({
      path,
      status: await dependencies.filesystem.lstat(path),
    });
    if (path === project.logicalRootPath) break;
    const parent = dirname(path);
    if (parent === path)
      throw new TypeError("Source identity escaped the project.");
    path = parent;
  }
  return { directories };
}

class SourceWriteGuardError extends Error {
  readonly code = "PATCH_WRITE_GUARD_MISMATCH";
  constructor(readonly agentError: AgentToolError) {
    super("Source write guard changed.");
  }
}

async function requireWriteGuard(
  project: SourcePatchProject,
  document: ProjectSourceDocument,
  identity: SourceIdentity,
  expectedIntegrity: string,
  dependencies: ApplySourcePatchDependencies,
  assertReservationHeld: () => void,
): Promise<void> {
  const chainChanged = () =>
    new SourceWriteGuardError(createA003Error(document.file, "reparse-point"));
  assertReservationHeld();
  try {
    if (!(await sourceChainIsValid(project, document, dependencies)))
      throw chainChanged();
    for (const directory of identity.directories) {
      const current = await dependencies.filesystem.lstat(directory.path);
      if (!current.isDirectory() || !sameIdentity(directory.status, current))
        throw chainChanged();
    }
    // Atomic replacement by an editor with identical bytes is safe. Directory
    // identities and the ordinary path chain protect placement; bytes guard content.
    const actualIntegrity = computeFileIntegrity(
      await dependencies.filesystem.readFile(document.logicalPath),
    );
    if (actualIntegrity !== expectedIntegrity)
      throw new SourceWriteGuardError(
        createA004Error(document.file, expectedIntegrity, actualIntegrity),
      );
  } catch (error) {
    if (isSourceChainMismatchError(error)) throw chainChanged();
    throw error;
  }
  assertReservationHeld();
}

async function rollbackFiles(
  project: SourcePatchProject,
  committed: readonly SourceByteProposal[],
  documents: ReadonlyMap<string, ProjectSourceDocument>,
  identities: ReadonlyMap<string, SourceIdentity>,
  dependencies: ApplySourcePatchDependencies,
  assertReservationHeld: () => void,
): Promise<{
  readonly firstFailure:
    { readonly error: unknown; readonly file: string } | undefined;
  readonly diagnostic: Diagnostic | undefined;
}> {
  let firstFailure:
    { readonly error: unknown; readonly file: string } | undefined;
  const restored: string[] = [];
  const notRestored: { file: string; reason: string }[] = [];
  for (let index = committed.length - 1; index >= 0; index -= 1) {
    const proposal = committed[index]!;
    const document = documents.get(proposal.file.path)!;
    const validateDestination = () =>
      requireWriteGuard(
        project,
        document,
        identities.get(document.file)!,
        proposal.file.afterIntegrity,
        dependencies,
        assertReservationHeld,
      );
    try {
      await validateDestination();
      await dependencies.writeFileAtomically(
        document.logicalPath,
        document.rawBytes,
        { validateDestination },
      );
      restored.push(document.file);
    } catch (error) {
      firstFailure ??= { error, file: document.file };
      notRestored.push({
        file: document.file,
        reason:
          error instanceof SourceWriteGuardError
            ? error.agentError.code === "A004"
              ? "content changed"
              : "chain changed"
            : `I/O (${sanitizedErrorCode(error)})`,
      });
    }
  }
  return {
    firstFailure,
    diagnostic:
      notRestored.length === 0
        ? undefined
        : {
            code: "E001",
            severity: "error",
            message: `Source patch rollback restored ${JSON.stringify(restored.sort())}; not restored ${JSON.stringify(notRestored.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0)))}. Only successfully replaced files were candidates for restoration.`,
            file: "<project>",
            line: 1,
            column: 1,
            jsonPointer: "",
          },
  };
}

async function cleanupOwnedStage(
  cleanup: OwnedStageCleanup,
  dependencies: ApplySourcePatchDependencies,
  attempt: "primary" | "final",
): Promise<void> {
  await removeOwnedStageDirectory(cleanup, dependencies.filesystem, attempt);
}

type CommitResult =
  | { readonly ok: true; readonly applied: boolean }
  | { readonly ok: false; readonly outcome: PatchFailureOutcome };

async function commitProposals(
  project: SourcePatchProject,
  proposals: readonly SourceByteProposal[],
  documents: ReadonlyMap<string, ProjectSourceDocument>,
  identities: ReadonlyMap<string, SourceIdentity>,
  dependencies: ApplySourcePatchDependencies,
  assertReservationHeld: () => void,
): Promise<CommitResult> {
  try {
    assertReservationHeld();
    for (const proposal of proposals) {
      const document = documents.get(proposal.file.path)!;
      if (!(await sourceChainIsValid(project, document, dependencies)))
        return {
          ok: false,
          outcome: failureOutcome(
            [],
            createA003Error(document.file, "reparse-point"),
            "expected",
          ),
        };
    }
    assertReservationHeld();
  } catch (error) {
    return { ok: false, outcome: exceptionOutcome("commit-write", error) };
  }

  const committed: SourceByteProposal[] = [];
  for (const proposal of proposals.filter(({ file }) => file.changed)) {
    const document = documents.get(proposal.file.path)!;
    let primaryFailure: PatchFailureOutcome | undefined;
    try {
      const validateDestination = () =>
        requireWriteGuard(
          project,
          document,
          identities.get(document.file)!,
          proposal.file.beforeIntegrity,
          dependencies,
          assertReservationHeld,
        );
      await validateDestination();
      await dependencies.writeFileAtomically(
        document.logicalPath,
        proposal.proposalBytes,
        { validateDestination },
      );
      committed.push(proposal);
      // A host can handle a signal while the OS replacement is pending. Record
      // the replacement first so any interrupted batch is accounted for.
      assertReservationHeld();
    } catch (error) {
      primaryFailure =
        error instanceof SourceWriteGuardError
          ? failureOutcome([], error.agentError, "expected")
          : exceptionOutcome("commit-write", error, document.file);
    }
    if (primaryFailure === undefined) continue;

    const rollback = await rollbackFiles(
      project,
      committed,
      documents,
      identities,
      dependencies,
      assertReservationHeld,
    );
    const rollbackFailure = rollback.firstFailure;
    const outcome =
      rollbackFailure === undefined
        ? primaryFailure
        : failureOutcome(
            [
              ...primaryFailure.diagnostics,
              ...diagnosticForReadToolException(
                "apply-source-patch",
                "rollback-write",
                rollbackFailure.error,
                rollbackFailure.file,
              ),
            ],
            primaryFailure.error,
            "tool",
          );
    return {
      ok: false,
      outcome:
        rollback.diagnostic === undefined
          ? outcome
          : {
              ...outcome,
              diagnostics: [...outcome.diagnostics, rollback.diagnostic],
            },
    };
  }
  return {
    ok: true,
    applied: proposals.some(({ file }) => file.changed),
  };
}

async function loadPatchProject(
  input: string | undefined,
  cwd: string,
  dependencies: ApplySourcePatchDependencies,
  targetFiles: readonly string[] = [],
): Promise<SourcePatchLoadResult> {
  const result = await dependencies.loadProject(input, cwd);
  if (
    result.ok ||
    result.toolFailure ||
    result.sourcePatchProject !== undefined ||
    result.sourcePatchCapable === true
  )
    return result;
  return {
    ...result,
    diagnostics: result.diagnostics.map((d) =>
      d.severity === "error" &&
      /^E(?:01[0-6]|020)$/.test(d.code) &&
      targetFiles.includes(d.file)
        ? {
            ...d,
            message: `${d.message} This injected loadProject does not provide guarded schema-repair snapshots; delegate to loadProjectForSourcePatch to support repairs.`,
          }
        : d,
    ),
  };
}

async function precommitFailure(
  project: SourcePatchProject,
  cwd: string,
  initialSnapshot: ProjectControlledSnapshot,
  dependencies: ApplySourcePatchDependencies,
): Promise<PatchFailureOutcome | undefined> {
  let reloadedProject: SourcePatchProject;
  try {
    const loaded = await loadPatchProject(
      project.manifest.logicalPath,
      cwd,
      dependencies,
    );
    const snapshot = loaded.ok ? loaded.project : loaded.sourcePatchProject;
    if (!loaded.ok && snapshot === undefined)
      return returnedCallFailure(loaded, "precommit-load");
    reloadedProject = snapshot!;
  } catch (error) {
    return exceptionOutcome("precommit-load", error, project.manifest.file);
  }
  try {
    const captured = await snapshotProject(reloadedProject, dependencies);
    if (!captured.ok) return failureOutcome([], captured.error, "expected");
    const mismatch = compareProjectControlledSnapshots(
      initialSnapshot,
      captured.snapshot,
    );
    if (mismatch !== undefined) return failureOutcome([], mismatch, "expected");
  } catch (error) {
    return exceptionOutcome(
      "precommit-read",
      error,
      reloadedProject.manifest.file,
    );
  }
  try {
    const reparseFile = await scanProject(
      project.logicalRootPath,
      dependencies,
    );
    if (reparseFile !== undefined)
      return failureOutcome(
        [],
        createA003Error(reparseFile, "reparse-point"),
        "expected",
      );
  } catch (error) {
    return exceptionOutcome("reparse-scan", error, project.manifest.file);
  }
  return undefined;
}

async function runStagedPatch(
  request: ApplySourcePatchRequest,
  cwd: string,
  project: SourcePatchProject,
  resolvedManifestRelativePath: string,
  initialSnapshot: ProjectControlledSnapshot,
  proposals: readonly SourceByteProposal[],
  documents: ReadonlyMap<string, ProjectSourceDocument>,
  identities: ReadonlyMap<string, SourceIdentity>,
  dependencies: ApplySourcePatchDependencies,
): Promise<PatchOutcome> {
  const stagingParent = dirname(project.logicalRootPath);
  let ownedStagePath: string;
  try {
    ownedStagePath = await dependencies.filesystem.mkdtemp(
      stageDirectoryPrefix(stagingParent, dependencies.filesystem),
    );
  } catch (error) {
    return exceptionOutcome("stage-create", error, project.manifest.file);
  }

  let ownedStage;
  try {
    ownedStage = await captureOwnedStageDirectory(
      ownedStagePath,
      dependencies.filesystem,
    );
  } catch (error) {
    return exceptionOutcome("stage-create", error, project.manifest.file);
  }

  const stageCleanup = createOwnedStageCleanup(ownedStage, stagingParent);
  let terminal: PatchFailureOutcome | undefined;
  let provisionalSuccess: PatchOutcome | undefined;
  let stagedDiagnostics: readonly Diagnostic[] | undefined;
  let stagedCompileSucceeded = false;
  let releaseWriteReservation: (() => void) | undefined;
  let assertWriteReservationHeld: (() => void) | undefined;
  let writeReservationPath: string | undefined;

  try {
    try {
      try {
        await copyProject(
          project.logicalRootPath,
          ownedStagePath,
          dependencies,
        );
      } catch (error) {
        terminal = exceptionOutcome("stage-copy", error, project.manifest.file);
      }

      if (terminal === undefined) {
        const proposalByPath = new Map(
          proposals.map((proposal) => [proposal.file.path, proposal]),
        );
        for (const file of request.files) {
          const proposal = proposalByPath.get(file.path)!;
          const document = documents.get(file.path)!;
          try {
            await dependencies.filesystem.writeFile(
              resolve(ownedStagePath, file.path),
              proposal.proposalBytes,
            );
          } catch (error) {
            terminal = exceptionOutcome("stage-write", error, document.file);
            break;
          }
        }
      }

      if (terminal === undefined) {
        const stagedManifestFile = resolve(
          ownedStagePath,
          resolvedManifestRelativePath,
        );
        try {
          const compiled = await dependencies.compileProject(
            stagedManifestFile,
            cwd,
          );
          if (compiled.ok) {
            stagedCompileSucceeded = true;
            stagedDiagnostics = compiled.diagnostics;
          } else {
            terminal = returnedCallFailure(compiled, "stage-compile");
          }
        } catch (error) {
          terminal = exceptionOutcome(
            "stage-compile",
            error,
            project.manifest.file,
          );
        }
      }
    } catch (error) {
      terminal ??= exceptionOutcome("unexpected", error, project.manifest.file);
    } finally {
      try {
        await cleanupOwnedStage(stageCleanup, dependencies, "primary");
      } catch (error) {
        terminal ??= exceptionOutcome(
          "stage-cleanup",
          error,
          project.manifest.file,
        );
      }
    }

    if (terminal === undefined && !stagedCompileSucceeded) {
      terminal = exceptionOutcome(
        "unexpected",
        new TypeError("Staged compilation did not produce an outcome."),
        project.manifest.file,
      );
    }

    if (terminal === undefined && request.dryRun) {
      provisionalSuccess = successOutcome(
        stagedDiagnostics!,
        proposalValue(request, proposals, false),
      );
    }

    if (terminal === undefined && !request.dryRun) {
      try {
        const reservation = (
          dependencies.reserveProjectWrite ?? reserveProjectWrite
        )(project);
        if (reservation.ok) {
          releaseWriteReservation = reservation.release;
          assertWriteReservationHeld = reservation.assertHeld;
          writeReservationPath = reservation.path;
        } else terminal = failureOutcome([], reservation.error, "expected");
      } catch (error) {
        terminal = exceptionOutcome(
          "write-reserve",
          error,
          project.manifest.file,
        );
      }
    }

    if (terminal === undefined && !request.dryRun) {
      terminal = await precommitFailure(
        project,
        cwd,
        initialSnapshot,
        dependencies,
      );

      if (terminal === undefined) {
        const committed = await commitProposals(
          project,
          proposals,
          documents,
          identities,
          dependencies,
          assertWriteReservationHeld!,
        );
        if (committed.ok) {
          provisionalSuccess = successOutcome(
            stagedDiagnostics!,
            proposalValue(request, proposals, committed.applied),
          );
        } else {
          terminal = committed.outcome;
        }
      }
    }
  } catch (error) {
    terminal ??= exceptionOutcome("unexpected", error, project.manifest.file);
  } finally {
    if (ownedStageCleanupNeedsFinalAttempt(stageCleanup)) {
      try {
        await cleanupOwnedStage(stageCleanup, dependencies, "final");
      } catch (error) {
        terminal ??= exceptionOutcome(
          "stage-cleanup",
          error,
          project.manifest.file,
        );
      }
    }
    if (releaseWriteReservation !== undefined) {
      try {
        releaseWriteReservation();
      } catch (error) {
        const releaseDiagnostics = diagnosticForReadToolException(
          "apply-source-patch",
          "write-release",
          error,
          PROJECT_WRITE_LOCK_FILE_NAME,
        ).map((diagnostic) => ({
          ...diagnostic,
          message: `${diagnostic.message} Write reservation ${JSON.stringify(writeReservationPath)} remains; once this command has exited and no other writer is running, it is safe to remove that reservation.`,
        }));
        const failure = failureOutcome(releaseDiagnostics, null, "tool");
        if (terminal === undefined && provisionalSuccess?.ok) {
          provisionalSuccess = successOutcome(
            [
              ...provisionalSuccess.diagnostics,
              {
                code: "W801",
                severity: "warning",
                file: PROJECT_WRITE_LOCK_FILE_NAME,
                line: 1,
                column: 1,
                jsonPointer: "",
                message: `Source patch ${provisionalSuccess.value.applied ? "changes were committed" : "completed without source changes"}. Could not release write reservation ${JSON.stringify(writeReservationPath)} (write-release/${sanitizedErrorCode(error)}). Do not replay the patch. Verify the committed project. Once this command has exited and no other writer is running, it is safe to remove that reservation.`,
              },
            ],
            provisionalSuccess.value,
          );
        } else {
          terminal =
            terminal === undefined
              ? failure
              : {
                  ...terminal,
                  diagnostics: [
                    ...terminal.diagnostics,
                    ...failure.diagnostics,
                  ],
                };
        }
      }
    }
  }

  return (
    terminal ??
    provisionalSuccess ??
    exceptionOutcome(
      "unexpected",
      new TypeError("Source patch processing did not produce an outcome."),
      project.manifest.file,
    )
  );
}

async function runValidatedPatch(
  request: ApplySourcePatchRequest,
  cwd: string,
  dependencies: ApplySourcePatchDependencies,
): Promise<PatchOutcome> {
  let loaded: SourcePatchLoadResult;
  try {
    loaded = await loadPatchProject(
      request.project,
      cwd,
      dependencies,
      request.files.map((file) => file.path),
    );
  } catch (error) {
    return exceptionOutcome("project-load", error);
  }
  if (!loaded.ok && loaded.sourcePatchProject === undefined) {
    return returnedCallFailure(loaded, "project-load");
  }

  const project = loaded.ok ? loaded.project : loaded.sourcePatchProject!;
  const resolvedManifestRelativePath = manifestRelativePath(project);
  if (resolvedManifestRelativePath === undefined) {
    return exceptionOutcome(
      "project-load",
      new TypeError("The resolved manifest is not beneath the project root."),
      project.manifest.file,
    );
  }

  const documents = projectDocuments(project);
  const planned = createSourcePatchPlan(request, projectTargets(project));
  if (!planned.ok) {
    return failureOutcome([], planned.error, "expected");
  }

  try {
    const reparseFile = await scanProject(
      project.logicalRootPath,
      dependencies,
    );
    if (reparseFile !== undefined) {
      return failureOutcome(
        [],
        createA003Error(reparseFile, "reparse-point"),
        "expected",
      );
    }
  } catch (error) {
    return exceptionOutcome("reparse-scan", error, project.manifest.file);
  }

  let initialSnapshot: ProjectControlledSnapshotResult;
  try {
    initialSnapshot = await snapshotProject(project, dependencies);
  } catch (error) {
    return exceptionOutcome("reachable-read", error, project.manifest.file);
  }
  if (!initialSnapshot.ok) {
    return failureOutcome([], initialSnapshot.error, "expected");
  }

  const identities = new Map<string, SourceIdentity>();
  try {
    for (const proposal of planned.proposals) {
      const document = documents.get(proposal.file.path)!;
      identities.set(
        document.file,
        await captureSourceIdentity(project, document, dependencies),
      );
    }
  } catch (error) {
    return exceptionOutcome("reachable-read", error, project.manifest.file);
  }

  return runStagedPatch(
    request,
    cwd,
    project,
    resolvedManifestRelativePath,
    initialSnapshot.snapshot,
    planned.proposals,
    documents,
    identities,
    dependencies,
  );
}

export function createInternalApplySourcePatchTool(
  options: InternalApplySourcePatchOptions = {},
  dependencies: ApplySourcePatchDependencies = defaultApplySourcePatchDependencies,
): InternalApplySourcePatchTool {
  const cwd = resolve(options.cwd ?? process.cwd());
  return Object.freeze({
    async applySourcePatch(
      request: DeepReadonly<ApplySourcePatchRequest>,
    ): Promise<PatchOutcome> {
      try {
        const validated = validateApplySourcePatchRequest(request);
        if (!validated.ok) {
          return finish(failureOutcome([], validated.error, "expected"));
        }
        return finish(
          await runValidatedPatch(validated.value, cwd, dependencies),
        );
      } catch (error) {
        return finish(exceptionOutcome("unexpected", error));
      }
    },
  });
}
