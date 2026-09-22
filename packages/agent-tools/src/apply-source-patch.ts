import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

import {
  compileProject,
  loadProject,
  writeFileAtomically,
  type CompileResult,
  type LoadedDocument,
  type LoadedProject,
  type LoadedProjectSourceFile,
  type LoadResult,
} from "@thermite/compiler";
import type { Diagnostic, ProjectPresentationFile } from "@thermite/schema";

import type {
  AgentToolOutcome,
  DeepReadonly,
  JsonValue,
} from "./common/contracts.js";
import { createA003Error, type AgentToolError } from "./common/errors.js";
import { detachedFrozenCopy } from "./common/immutable.js";
import {
  diagnosticForReadToolException,
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
  stageDirectoryPrefix,
  validateProjectSourceChain,
  type OwnedStageCleanup,
  type PatchFilesystemDependencies,
  type ProjectControlledSnapshot,
  type ProjectControlledSnapshotResult,
} from "./patch-filesystem.js";
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
  ) => Promise<LoadResult>;
  readonly writeFileAtomically: (
    destinationPath: string,
    data: Uint8Array,
  ) => Promise<void>;
  readonly filesystem: PatchFilesystemDependencies;
  readonly captureSnapshot?: (
    project: LoadedProject,
  ) => Promise<ProjectControlledSnapshotResult>;
  readonly copyProjectTree?: (
    sourceRoot: string,
    destinationRoot: string,
  ) => Promise<void>;
  readonly scanProjectTree?: (root: string) => Promise<string | undefined>;
  readonly validateSourceChain?: (
    project: LoadedProject,
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
    loadProject,
    writeFileAtomically,
    filesystem: defaultPatchFilesystemDependencies,
  });

type PatchOutcome = AgentToolOutcome<ApplySourcePatchValue, AgentToolError>;
type PatchFailureOutcome = Extract<PatchOutcome, { readonly ok: false }>;
type ProjectSourceDocument =
  | LoadedDocument<LoadedProjectSourceFile>
  | LoadedDocument<ProjectPresentationFile>;

function failureOutcome(
  diagnostics: readonly Diagnostic[],
  error: AgentToolError | null,
  failureClass: "expected" | "tool",
): PatchFailureOutcome {
  return { ok: false, diagnostics, error, failureClass };
}

function successOutcome(
  diagnostics: readonly Diagnostic[],
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
  result: Extract<LoadResult | CompileResult, { readonly ok: false }>,
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
    null,
    result.toolFailure ? "tool" : "expected",
  );
}

function manifestRelativePath(project: LoadedProject): string | undefined {
  const value = relative(project.logicalRootPath, project.manifest.logicalPath);
  return value !== "" &&
    value !== ".." &&
    !value.startsWith(`..${sep}`) &&
    !isAbsolute(value)
    ? value
    : undefined;
}

function patchableProjectDocuments(
  project: LoadedProject,
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
  project: LoadedProject,
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
  project: LoadedProject,
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
  project: LoadedProject,
  dependencies: ApplySourcePatchDependencies,
): Promise<ProjectControlledSnapshotResult> {
  return dependencies.captureSnapshot === undefined
    ? captureProjectControlledSnapshot(project, dependencies.filesystem)
    : dependencies.captureSnapshot(project);
}

async function sourceChainIsValid(
  project: LoadedProject,
  document: ProjectSourceDocument,
  dependencies: ApplySourcePatchDependencies,
): Promise<boolean> {
  return dependencies.validateSourceChain === undefined
    ? validateProjectSourceChain(project, document, dependencies.filesystem)
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

async function rollbackFiles(
  committed: readonly SourceByteProposal[],
  documents: ReadonlyMap<string, ProjectSourceDocument>,
  dependencies: ApplySourcePatchDependencies,
): Promise<{ readonly error: unknown; readonly file: string } | undefined> {
  let firstFailure:
    { readonly error: unknown; readonly file: string } | undefined;
  for (let index = committed.length - 1; index >= 0; index -= 1) {
    const proposal = committed[index]!;
    const document = documents.get(proposal.file.path)!;
    try {
      await dependencies.writeFileAtomically(
        document.logicalPath,
        document.rawBytes,
      );
    } catch (error) {
      firstFailure ??= { error, file: document.file };
    }
  }
  return firstFailure;
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
  project: LoadedProject,
  proposals: readonly SourceByteProposal[],
  documents: ReadonlyMap<string, ProjectSourceDocument>,
  dependencies: ApplySourcePatchDependencies,
): Promise<CommitResult> {
  for (const proposal of proposals) {
    const document = documents.get(proposal.file.path)!;
    if (!(await sourceChainIsValid(project, document, dependencies))) {
      return {
        ok: false,
        outcome: failureOutcome(
          [],
          createA003Error(proposal.file.path, "reparse-point"),
          "expected",
        ),
      };
    }
  }

  const committed: SourceByteProposal[] = [];
  for (const proposal of proposals.filter(({ file }) => file.changed)) {
    const document = documents.get(proposal.file.path)!;
    let primaryFailure: PatchFailureOutcome | undefined;
    if (!(await sourceChainIsValid(project, document, dependencies))) {
      primaryFailure = failureOutcome(
        [],
        createA003Error(proposal.file.path, "reparse-point"),
        "expected",
      );
    } else {
      try {
        await dependencies.writeFileAtomically(
          document.logicalPath,
          proposal.proposalBytes,
        );
        committed.push(proposal);
      } catch (error) {
        primaryFailure = exceptionOutcome("commit-write", error, document.file);
      }
    }
    if (primaryFailure === undefined) continue;

    const rollbackFailure = await rollbackFiles(
      committed,
      documents,
      dependencies,
    );
    return {
      ok: false,
      outcome:
        rollbackFailure === undefined
          ? primaryFailure
          : exceptionOutcome(
              "rollback-write",
              rollbackFailure.error,
              rollbackFailure.file,
            ),
    };
  }
  return {
    ok: true,
    applied: proposals.some(({ file }) => file.changed),
  };
}

async function runStagedPatch(
  request: ApplySourcePatchRequest,
  cwd: string,
  project: LoadedProject,
  resolvedManifestRelativePath: string,
  initialSnapshot: ProjectControlledSnapshot,
  proposals: readonly SourceByteProposal[],
  documents: ReadonlyMap<string, ProjectSourceDocument>,
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
      let reloadedProject: LoadedProject | undefined;
      try {
        const reloaded = await dependencies.loadProject(
          project.manifest.logicalPath,
          cwd,
        );
        if (reloaded.ok) {
          reloadedProject = reloaded.project;
        } else {
          terminal = returnedCallFailure(reloaded, "precommit-load");
        }
      } catch (error) {
        terminal = exceptionOutcome(
          "precommit-load",
          error,
          project.manifest.file,
        );
      }

      let precommitSnapshot: ProjectControlledSnapshot | undefined;
      if (terminal === undefined && reloadedProject !== undefined) {
        try {
          const captured = await snapshotProject(reloadedProject, dependencies);
          if (captured.ok) {
            precommitSnapshot = captured.snapshot;
          } else {
            terminal = failureOutcome([], captured.error, "expected");
          }
        } catch (error) {
          terminal = exceptionOutcome(
            "precommit-read",
            error,
            reloadedProject.manifest.file,
          );
        }
      }

      if (terminal === undefined && precommitSnapshot !== undefined) {
        const mismatch = compareProjectControlledSnapshots(
          initialSnapshot,
          precommitSnapshot,
        );
        if (mismatch !== undefined) {
          terminal = failureOutcome([], mismatch, "expected");
        }
      }

      if (terminal === undefined) {
        try {
          const reparseFile = await scanProject(
            project.logicalRootPath,
            dependencies,
          );
          if (reparseFile !== undefined) {
            terminal = failureOutcome(
              [],
              createA003Error(reparseFile, "reparse-point"),
              "expected",
            );
          }
        } catch (error) {
          terminal = exceptionOutcome(
            "reparse-scan",
            error,
            project.manifest.file,
          );
        }
      }

      if (terminal === undefined) {
        const committed = await commitProposals(
          project,
          proposals,
          documents,
          dependencies,
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
  let loaded: LoadResult;
  try {
    loaded = await dependencies.loadProject(request.project, cwd);
  } catch (error) {
    return exceptionOutcome("project-load", error);
  }
  if (!loaded.ok) {
    return returnedCallFailure(loaded, "project-load");
  }

  const project = loaded.project;
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

  return runStagedPatch(
    request,
    cwd,
    project,
    resolvedManifestRelativePath,
    initialSnapshot.snapshot,
    planned.proposals,
    documents,
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
