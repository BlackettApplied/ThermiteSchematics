import { basename, dirname, extname, resolve } from "node:path";
import { compileLoadedProject, compileProject } from "@thermite/compiler";
import type { Diagnostic } from "@thermite/schema";
import {
  artifactIntent,
  jsonArtifact,
  type ArtifactFormat,
  type ExportRecipe,
} from "./alpha-export-artifact.js";
import {
  ExportInputError,
  exportProducer,
  loadExportSnapshot,
  namedExportInput,
  portablePath,
  sha256,
  standaloneInputPath,
} from "./alpha-export-input.js";
import {
  deliveryTargets,
  guardTarget,
  guardTargets,
  publishArtifact,
  retireMarker,
} from "./alpha-export-publish.js";
import { withExportReservations } from "./alpha-export-lock.js";
import {
  equalJson,
  RECEIPT_FORMAT,
  type ArtifactRecord,
  type ReceiptRecord,
} from "./alpha-export-record.js";
import { writeAlphaOutput } from "./alpha-output.js";

type Snapshot = Awaited<ReturnType<typeof loadExportSnapshot>>;
export interface ReceiptFlags {
  project: string;
  output?: string;
  receipt?: boolean;
}

export async function standaloneSnapshot(
  flags: ReceiptFlags,
): Promise<Snapshot | undefined> {
  if (!flags.receipt) return undefined;
  if (!flags.output || flags.output === "-")
    throw new ExportInputError("--receipt requires a named output file.", 2);
  return loadExportSnapshot(flags.project);
}

export function standaloneCompile(flags: ReceiptFlags, snapshot?: Snapshot) {
  return snapshot
    ? compileLoadedProject(snapshot.project)
    : compileProject(flags.project);
}

export async function standaloneDependency(snapshot: Snapshot, path: string) {
  return namedExportInput(
    snapshot.project,
    await standaloneInputPath(snapshot.project, path),
  );
}

export async function writeStandaloneArtifact(
  flags: ReceiptFlags,
  snapshot: Snapshot | undefined,
  recipe: ExportRecipe,
  format: ArtifactFormat,
  content: string | Uint8Array,
  protectedInputs: string[] = [],
  metadata: Pick<ArtifactRecord, "diagnostics" | "selection"> = {},
) {
  if (!flags.output) throw new Error("A named output is required.");
  if (!snapshot) {
    await writeAlphaOutput(
      flags.project,
      flags.output,
      content,
      protectedInputs,
      { allowText: recipe.kind === "diagnostics" },
    );
    return;
  }
  const file = resolve(flags.output);
  const name = portablePath(basename(file));
  if (extname(name).toLowerCase() !== "." + format)
    throw new ExportInputError(
      "The receipt requires an output filename matching its format.",
      2,
    );
  const [target, sidecar] = deliveryTargets(dirname(file), [name], true);
  if (!target || !sidecar) throw new Error("Missing planned receipt target.");
  const targets = [target, sidecar];
  await guardTargets(snapshot.project, targets, protectedInputs);
  const producer = exportProducer();
  const receipt: ReceiptRecord = {
    format: RECEIPT_FORMAT,
    producer,
    source: snapshot.fingerprint,
    artifact: {
      path: target.label,
      sha256: sha256(content),
      intent: artifactIntent(recipe, format),
      ...metadata,
    },
  };
  await withExportReservations(targets, async (assertHeld) => {
    const current = await loadExportSnapshot(flags.project);
    if (!equalJson(snapshot.fingerprint, current.fingerprint))
      throw new ExportInputError(
        "Source changed during export. Retry with the current inputs.",
      );
    for (const input of recipe.inputs) {
      const dependency = await namedExportInput(current.project, input.path);
      if (!equalJson(input, dependency.binding))
        throw new ExportInputError(
          `Request input ${input.path} changed during export. Retry with the current inputs.`,
        );
    }
    await guardTargets(current.project, targets, protectedInputs);
    async function validate(candidate: (typeof targets)[number]) {
      await assertHeld();
      await guardTarget(current.project, candidate, protectedInputs);
    }
    await retireMarker(sidecar, () => validate(sidecar));
    await publishArtifact(target, content, () => validate(target));
    await publishArtifact(sidecar, jsonArtifact(receipt), () =>
      validate(sidecar),
    );
  });
}

export function writeStandaloneFailure(
  error: ExportInputError,
  diagnostics: Diagnostic[] = [],
) {
  process.stderr.write(
    JSON.stringify({
      diagnostics: [...diagnostics, ...error.diagnostics],
      error: { code: "unverifiable_input", message: error.message },
    }) + "\n",
  );
}

export function reportDiagnostics(
  diagnostics: readonly import("@thermite/schema").Diagnostic[],
  error: unknown = null,
) {
  process.stderr.write(JSON.stringify({ diagnostics, error }) + "\n");
}
export function compileFailure(
  result: Extract<import("@thermite/compiler").CompileResult, { ok: false }>,
) {
  process.stderr.write(
    JSON.stringify({ diagnostics: result.diagnostics }) + "\n",
  );
  return result.toolFailure ? 2 : 1;
}
