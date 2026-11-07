import type { Diagnostic, SchemaRegistry } from "@thermite/schema";
import type { SourcePatchProject } from "./loader-types.js";
import { loadLibraryLockSnapshot } from "./loader-lock.js";

export async function sourcePatchFailureSnapshot(
  project:
    | Omit<SourcePatchProject, "libraryLock" | "structuralDiagnostics">
    | undefined,
  diagnostics: Diagnostic[],
  toolFailure: boolean,
  registry: SchemaRegistry | undefined,
): Promise<{ sourcePatchProject?: SourcePatchProject }> {
  if (toolFailure || project === undefined || registry === undefined) return {};
  const patchable = new Set([
    ...project.sources.map((d) => d.file),
    ...(project.presentation ? [project.presentation.file] : []),
  ]);
  if (
    !diagnostics.every(
      (d) =>
        d.severity !== "error" ||
        (d.code !== "E002" && d.code !== "E003" && patchable.has(d.file)),
    )
  )
    return {};
  return {
    sourcePatchProject: {
      ...project,
      libraryLock: await loadLibraryLockSnapshot(
        project.logicalRootPath,
        registry,
      ),
      structuralDiagnostics: diagnostics,
    },
  };
}
