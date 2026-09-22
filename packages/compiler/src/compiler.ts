import {
  DIAGNOSTIC_CATALOG,
  normalizeDiagnosticFile,
  normalizeDiagnostics,
  type Diagnostic,
} from "@thermite/schema";

import { expandResolvedProject } from "./expansion.js";
import { normalizeProjectGraph } from "./graph.js";
import { assembleElectricalIr, type ElectricalIr } from "./ir.js";
import {
  loadProject,
  type LoadedProject,
  type LoadProjectOptions,
} from "./loader.js";
import { verifyLibraryLock } from "./lock.js";
import { deriveProjectNets } from "./nets.js";
import { resolveLoadedProject } from "./resolution.js";
import { evaluateRules } from "./rules/index.js";

export interface CompiledProjectPresentation {
  readonly format: "project-presentation/0.1" | "project-presentation/0.2";
  readonly revision: string;
  readonly backgroundColor: string;
  readonly titleBlockLines: readonly string[];
  readonly page?: {
    readonly size?: "letter" | "tabloid" | "a4" | "a3";
    readonly orientation?: "landscape" | "portrait";
    readonly marginMm?: number;
  };
}

export type CompileResult =
  | {
      ok: true;
      diagnostics: Diagnostic[];
      ir: ElectricalIr;
      presentation: CompiledProjectPresentation;
    }
  | { ok: false; diagnostics: Diagnostic[]; toolFailure: boolean };

interface CompilerStages {
  evaluateRules(ir: ElectricalIr): readonly Diagnostic[];
}

const DEFAULT_COMPILER_STAGES: CompilerStages = Object.freeze({
  evaluateRules,
});

function hasError(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === "error");
}

function compileProjectPresentation(
  project: LoadedProject,
): CompiledProjectPresentation {
  const authored = project.presentation?.value;
  const titleBlockLines = Object.freeze(
    authored === undefined ? [] : [...(authored.titleBlock?.lines ?? [])],
  );
  return Object.freeze({
    format: authored?.format ?? "project-presentation/0.1",
    revision: authored?.revision ?? "UNSPECIFIED",
    backgroundColor: authored?.backgroundColor ?? "#ffffff",
    titleBlockLines,
    ...(authored?.page === undefined
      ? {}
      : { page: Object.freeze({ ...authored.page }) }),
  });
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : "unknown failure";
}

function compilerFailure(
  project: LoadedProject,
  error: unknown,
): CompileResult {
  const diagnostic: Diagnostic = {
    code: "E001",
    severity: DIAGNOSTIC_CATALOG.E001.severity,
    message: `Compilation tool failure (${errorDetail(error)}).`,
    file: normalizeDiagnosticFile(project.manifest.file),
    line: 1,
    column: 1,
    jsonPointer: "",
  };
  return {
    ok: false,
    diagnostics: normalizeDiagnostics([
      ...(project.structuralDiagnostics ?? []),
      diagnostic,
    ]),
    toolFailure: true,
  };
}

/** Internal stage-injection seam used to prove compiler gates and failure routing. */
export function compileLoadedProjectWithStages(
  project: LoadedProject,
  stages: CompilerStages,
): CompileResult {
  const structuralDiagnostics = normalizeDiagnostics(
    project.structuralDiagnostics ?? [],
  );

  if (hasError(structuralDiagnostics)) {
    return {
      ok: false,
      diagnostics: structuralDiagnostics,
      toolFailure: false,
    };
  }

  try {
    const verified = verifyLibraryLock(project);
    const lockDiagnostics = normalizeDiagnostics([
      ...structuralDiagnostics,
      ...verified.diagnostics,
    ]);

    if (!verified.ok) {
      return {
        ok: false,
        diagnostics: lockDiagnostics,
        toolFailure: verified.toolFailure,
      };
    }

    const resolution = resolveLoadedProject(project);
    const diagnostics = normalizeDiagnostics([
      ...lockDiagnostics,
      ...resolution.diagnostics,
    ]);

    if (!resolution.ok || hasError(diagnostics)) {
      return { ok: false, diagnostics, toolFailure: false };
    }

    const expansion = expandResolvedProject(resolution);
    const graph = normalizeProjectGraph(expansion, resolution);
    const derived = deriveProjectNets(expansion, graph);
    const ir = assembleElectricalIr(
      project,
      verified.lock,
      expansion,
      graph,
      derived,
    );
    const ruleDiagnostics = stages.evaluateRules(ir);
    const finalDiagnostics = normalizeDiagnostics([
      ...diagnostics,
      ...ruleDiagnostics,
    ]);

    if (hasError(finalDiagnostics)) {
      return {
        ok: false,
        diagnostics: finalDiagnostics,
        toolFailure: false,
      };
    }

    return {
      ok: true,
      diagnostics: finalDiagnostics,
      ir,
      presentation: compileProjectPresentation(project),
    };
  } catch (error) {
    return compilerFailure(project, error);
  }
}

/** Compiles one structurally loaded, frozen project snapshot through D2 stages 2-6. */
export function compileLoadedProject(project: LoadedProject): CompileResult {
  return compileLoadedProjectWithStages(project, DEFAULT_COMPILER_STAGES);
}

/** Internal stage-injection seam used by compiler pipeline tests. */
export async function compileProjectWithStages(
  inputPath: string | undefined,
  cwd: string,
  stages: CompilerStages,
  loadOptions: LoadProjectOptions = {},
): Promise<CompileResult> {
  const loaded = await loadProject(inputPath, cwd, loadOptions);

  if (!loaded.ok) {
    return loaded;
  }

  return compileLoadedProjectWithStages(loaded.project, stages);
}

export async function compileProject(
  inputPath?: string,
  cwd = process.cwd(),
  loadOptions: LoadProjectOptions = {},
): Promise<CompileResult> {
  return compileProjectWithStages(
    inputPath,
    cwd,
    DEFAULT_COMPILER_STAGES,
    loadOptions,
  );
}
