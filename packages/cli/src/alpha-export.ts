import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileLoadedProject } from "@thermite/compiler";
import type { Diagnostic } from "@thermite/schema";
import type { DocumentationSelection } from "@thermite/query";
import type { Command } from "commander";
import {
  ArtifactError,
  artifactIntent,
  cableSchedule,
  completenessArtifact,
  csvReport,
  drawingArtifact,
  drawingDiagnostics,
  jsonArtifact,
  type DrawingRenderer,
  type DrawingRecipe,
  semanticReview,
  type ArtifactFormat,
  type Compiled,
  type ExportRecipe,
} from "./alpha-export-artifact.js";
import {
  checkBundle,
  checkSidecars,
  ExportCheck,
} from "./alpha-export-check.js";
import {
  ExportInputError,
  exportProducer,
  loadExportSnapshot,
  sha256,
} from "./alpha-export-input.js";
import {
  loadDeliveryPlan,
  MANIFEST_PATH,
  plannedArtifacts,
  stableJson,
  type DeliveryPlan,
} from "./alpha-export-plan.js";
import {
  deliveryTargets,
  guardTarget,
  guardTargets,
  outputDirectory,
  publishArtifact,
  retireMarker,
  type ExportTarget,
} from "./alpha-export-publish.js";
import {
  checkExportReservations,
  withExportReservations,
} from "./alpha-export-lock.js";
import {
  equalJson,
  MANIFEST_FORMAT,
  type ArtifactRecord,
  type BundleRecord,
} from "./alpha-export-record.js";

interface ExportFlags {
  project: string;
  input: string;
  outDir: string;
  json?: boolean;
  receipts?: boolean;
}

async function prepare(flags: ExportFlags, receipts = false) {
  const directory = await outputDirectory(flags.outDir);
  const snapshot = await loadExportSnapshot(flags.project);
  const plan = await loadDeliveryPlan(snapshot.project, flags.input);
  const artifacts = plannedArtifacts(plan);
  const targets = deliveryTargets(
    directory,
    artifacts.map(({ path }) => path),
    receipts,
  );
  await guardTargets(snapshot.project, targets, plan.protectedInputs);
  return { directory, snapshot, plan, artifacts, targets };
}

async function runCheck(flags: ExportFlags): Promise<number> {
  const check = new ExportCheck();
  try {
    const { directory, snapshot, plan, artifacts } = await prepare(
      flags,
      flags.receipts,
    );
    const expected = {
      source: snapshot.fingerprint,
      producer: exportProducer(),
    };
    if (flags.receipts)
      await checkSidecars(check, directory, artifacts, expected);
    else
      await checkBundle(
        check,
        directory,
        artifacts,
        expected,
        plan.requestSha256,
      );
  } catch (error) {
    check.failure(
      error instanceof ExportInputError
        ? (error.path ?? "delivery request")
        : "delivery",
      error,
    );
  }
  const result = check.result();
  if (flags.json) process.stdout.write(jsonArtifact(result));
  else
    process.stdout.write(
      result.fresh
        ? "Export is fresh.\n"
        : result.reasons
            .map(
              ({ path, code, message }) =>
                `${path} ${code}${message ? ` (${message})` : ""}\n`,
            )
            .join(""),
    );
  return check.exitCode();
}

function renderOnce(compiled: Compiled, renderDrawing: DrawingRenderer) {
  const drawings = new Map<string, ReturnType<DrawingRenderer>>();
  return async (recipe: DrawingRecipe) => {
    const options = recipe.kind === "packet" ? undefined : recipe.drawing;
    const key = stableJson([recipe.kind, recipe.request, options]);
    const pending = drawings.get(key) ?? renderDrawing(compiled, recipe);
    drawings.set(key, pending);
    const result = await pending;
    if (!result.ok) throw new ArtifactError(result.error);
    return result.value;
  };
}

type JobDiagnostics = BundleRecord["jobDiagnostics"];
async function produce(
  compiled: Compiled,
  recipe: ExportRecipe,
  format: ArtifactFormat,
  render: ReturnType<typeof renderOnce>,
  scope: JobDiagnostics[number],
): Promise<{
  content: string | Uint8Array;
  selection?: DocumentationSelection | undefined;
}> {
  switch (recipe.kind) {
    case "cable":
      return {
        content: jsonArtifact(cableSchedule(compiled, recipe.designation)),
      };
    case "review":
      return {
        content: jsonArtifact(semanticReview(compiled, recipe.baseline)),
      };
    case "diagnostics":
      return { content: completenessArtifact(compiled, recipe.scope, format) };
    case "report":
      if (format === "csv") {
        try {
          return csvReport(compiled, recipe.request);
        } catch (error) {
          throw new ArtifactError({
            code: "Q001",
            message:
              error instanceof Error
                ? error.message
                : "Invalid report request.",
          });
        }
      }
      break;
  }
  const packet = await render(recipe);
  scope.diagnostics = drawingDiagnostics(packet, recipe.kind);
  if (
    recipe.kind === "packet" &&
    recipe.strict &&
    [...compiled.diagnostics, ...scope.diagnostics].some(
      (d) => d.severity === "warning",
    )
  )
    throw new ArtifactError({
      code: "strict_warnings",
      message: "Strict packet output rejected warnings.",
    });
  return {
    content: await drawingArtifact(packet, format, compiled.ir.project.name),
  };
}

async function stageBundle(
  directory: string,
  compiled: Compiled,
  plan: DeliveryPlan,
  jobDiagnostics: JobDiagnostics,
  renderDrawing: DrawingRenderer,
) {
  const render = renderOnce(compiled, renderDrawing);
  const artifacts: ArtifactRecord[] = [];
  for (const job of plan.jobs) {
    const scope: JobDiagnostics[number] = {
      outputs: job.outputs.map(({ path }) => path),
      diagnostics: [],
    };
    try {
      for (const { path, format } of job.outputs) {
        const result = await produce(
          compiled,
          job.recipe,
          format,
          render,
          scope,
        );
        const record: ArtifactRecord = {
          path,
          sha256: sha256(result.content),
          intent: artifactIntent(job.recipe, format),
        };
        if (result.selection) record.selection = result.selection;
        await writeFile(
          join(directory, String(artifacts.length)),
          result.content,
          { flag: "wx" },
        );
        artifacts.push(record);
      }
    } finally {
      if (scope.diagnostics.length) jobDiagnostics.push(scope);
    }
  }
  return artifacts;
}

async function publishBundle(
  flags: ExportFlags,
  staged: string,
  prepared: Awaited<ReturnType<typeof prepare>>,
  manifest: BundleRecord,
) {
  const { targets, plan, snapshot, artifacts } = prepared;
  const marker = targets.find((target) => target.label === MANIFEST_PATH);
  if (!marker) throw new Error("Missing planned manifest target.");
  await withExportReservations(targets, async (assertHeld) => {
    const current = await prepare(flags);
    if (
      !equalJson(snapshot.fingerprint, current.snapshot.fingerprint) ||
      plan.requestSha256 !== current.plan.requestSha256 ||
      !equalJson(artifacts, current.artifacts) ||
      !equalJson(targets, current.targets)
    )
      throw new ExportInputError(
        "Source or request changed during export. Retry with the current inputs.",
      );

    function validate(target: ExportTarget) {
      return async () => {
        await assertHeld();
        await guardTarget(
          current.snapshot.project,
          target,
          current.plan.protectedInputs,
        );
      };
    }
    await retireMarker(marker, validate(marker));
    for (const [index, target] of targets.entries()) {
      if (target !== marker)
        await publishArtifact(
          target,
          await readFile(join(staged, String(index))),
          validate(target),
        );
    }
    await publishArtifact(marker, jsonArtifact(manifest), validate(marker));
  });
}

async function runBundle(
  flags: ExportFlags,
  renderDrawing: DrawingRenderer,
): Promise<number> {
  let diagnostics: readonly Diagnostic[] = [];
  const jobDiagnostics: JobDiagnostics = [];
  let staged: string | undefined;
  let failure: { code: string; message: string } | null = null;
  try {
    const prepared = await prepare(flags);
    checkExportReservations(prepared.targets);
    const compiled = compileLoadedProject(prepared.snapshot.project);
    diagnostics = compiled.diagnostics;
    if (!compiled.ok) return compiled.toolFailure ? 2 : 1;
    const producer = exportProducer();
    staged = await mkdtemp(join(await realpath(tmpdir()), "thermite-export-"));
    const artifacts = await stageBundle(
      staged,
      compiled,
      prepared.plan,
      jobDiagnostics,
      renderDrawing,
    );
    const manifest: BundleRecord = {
      format: MANIFEST_FORMAT,
      producer,
      source: prepared.snapshot.fingerprint,
      requestSha256: prepared.plan.requestSha256,
      diagnostics,
      artifacts,
      jobDiagnostics,
    };
    await publishBundle(flags, staged, prepared, manifest);
    process.stdout.write(
      `Wrote ${artifacts.length} artifact(s) and ${MANIFEST_PATH} to ${prepared.directory}\n`,
    );
    return 0;
  } catch (error) {
    if (
      error instanceof ExportInputError &&
      error.diagnostics.length &&
      !diagnostics.length
    )
      diagnostics = error.diagnostics;
    failure =
      error instanceof ArtifactError
        ? error.finding
        : {
            code:
              error instanceof ExportInputError ? "unverifiable_input" : "T001",
            message: error instanceof Error ? error.message : "Export failed.",
          };
    return error instanceof ArtifactError
      ? 1
      : error instanceof ExportInputError
        ? error.exitCode
        : 2;
  } finally {
    if (staged) await rm(staged, { recursive: true, force: true });
    process.stderr.write(
      JSON.stringify({ diagnostics, jobs: jobDiagnostics, error: failure }) +
        "\n",
    );
  }
}

export function registerAlphaExport(
  command: Command,
  state: { exitCode: number },
  renderDrawing: DrawingRenderer,
) {
  const exports = command
    .command("export")
    .description("publish or verify a planned delivery");
  function options(command: Command) {
    return command
      .option("--project <directory>", "electrical project directory", ".")
      .requiredOption("--input <file>", "export-delivery-request/1 JSON file")
      .requiredOption("--out-dir <directory>", "delivery directory");
  }
  options(
    exports
      .command("bundle")
      .description("compile once and publish artifacts with a manifest"),
  ).action(async (flags: ExportFlags) => {
    state.exitCode = await runBundle(flags, renderDrawing);
  });
  options(
    exports
      .command("check")
      .description("check input and artifact hashes without rendering"),
  )
    .option("--json", "structured freshness findings")
    .option("--receipts", "check standalone sidecars for this custom delivery")
    .action(async (flags: ExportFlags) => {
      state.exitCode = await runCheck(flags);
    });
}
