import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { compileProject } from "@thermite/compiler";
import {
  REPORT_KINDS,
  createProjectSnapshot,
  parseProjectSnapshot,
  auditContinuity,
  type DeviceFilter,
} from "@thermite/query";
import {
  renderSchematicPacket,
  renderSchematicSheets,
  type PageSettings,
  type SchematicViewRequest,
  type PacketRenderOptions,
  type SchematicPacketRequest,
} from "@thermite/render";
import { parseJson } from "@thermite/schema";
import { Command, CommanderError, Option } from "commander";
import { registerGuideCommand } from "./alpha-guide.js";
import { runCli } from "./index.js";
import { initializeAlphaProject } from "./alpha-init.js";
import { watchAlphaProject } from "./alpha-watch.js";
import { writeAlphaOutput } from "./alpha-output.js";
import { registerAlphaExport } from "./alpha-export.js";
import {
  ArtifactError,
  cableSchedule,
  completenessArtifact,
  csvReport,
  drawingArtifact,
  drawingDiagnostics,
  effectivePacket,
  jsonArtifact,
  makeViewRequest,
  type DrawingRenderer,
  semanticReview,
  type ArtifactFormat,
  type DrawingOptions,
  type ExportRecipe,
} from "./alpha-export-artifact.js";
import { ExportInputError, THERMITE_VERSION } from "./alpha-export-input.js";
import { documentationRequest } from "./alpha-export-plan.js";
import {
  compileFailure,
  reportDiagnostics,
  standaloneCompile,
  standaloneDependency,
  standaloneSnapshot,
  writeStandaloneArtifact,
  writeStandaloneFailure,
} from "./alpha-export-standalone.js";

export { THERMITE_VERSION };
interface Flags {
  project: string;
  output?: string;
  json?: boolean;
  strict?: boolean;
  paper?: PageSettings["size"];
  orientation?: PageSettings["orientation"];
  margin?: string;
  flow?: "left-to-right" | "top-to-bottom";
  power?: boolean;
  actuation?: boolean;
  loads?: boolean;
  conductors?: boolean;
  to?: string;
  includePower?: boolean;
  input?: string;
  layout?: "standard" | "compact";
  index?: boolean;
  device?: string;
  before?: string;
  location?: string;
  filter?: string;
  receipt?: boolean;
}
async function requestJson(
  path: string,
  onSource?: (source: NonNullable<PacketRenderOptions["source"]>) => void,
): Promise<unknown> {
  const chunks: Buffer[] = [];
  if (path === "-") {
    let size = 0;
    for await (const chunk of process.stdin) {
      const bytes = Buffer.from(chunk);
      size += bytes.length;
      if (size > 16 * 1024 * 1024)
        throw new Error("Packet request exceeds 16 MiB.");
      chunks.push(bytes);
    }
  }
  const bytes = path === "-" ? Buffer.concat(chunks) : await readFile(path);
  if (bytes.length > 16 * 1024 * 1024)
    throw new Error("Packet request exceeds 16 MiB.");
  const value = parseJson(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    path,
  );
  if (value.diagnostics.length || value.value === undefined)
    throw new Error(JSON.stringify(value.diagnostics));
  onSource?.({ file: path, nodes: value.nodes });
  return value.value;
}
function pageFlags(flags: Flags): PageSettings | undefined {
  if (
    flags.paper === undefined &&
    flags.orientation === undefined &&
    flags.margin === undefined
  )
    return undefined;
  return {
    ...(flags.paper ? { size: flags.paper } : {}),
    ...(flags.orientation ? { orientation: flags.orientation } : {}),
    ...(flags.margin === undefined ? {} : { marginMm: Number(flags.margin) }),
  };
}
function viewRequest(root: string, flags: Flags): SchematicViewRequest {
  if (
    [
      flags.power,
      flags.actuation,
      flags.loads,
      flags.conductors,
      flags.to !== undefined,
    ].filter(Boolean).length !== 1
  )
    throw new Error(
      "Choose exactly one of --power, --actuation, --loads, --conductors or --to <device>.",
    );
  if (flags.includePower && flags.to === undefined)
    throw new Error("--include-power requires --to.");
  return makeViewRequest(
    root,
    flags.power
      ? "power"
      : flags.actuation
        ? "actuation"
        : flags.loads
          ? "loads"
          : flags.conductors
            ? "conductors"
            : "trace",
    flags.flow,
    flags.to === undefined
      ? undefined
      : { to: flags.to, includePower: flags.includePower ?? false },
  );
}
function drawingOptions(flags: Flags): DrawingOptions {
  const page = pageFlags(flags);
  return {
    ...(page ? { page } : {}),
    ...(flags.layout ? { layout: flags.layout } : {}),
    ...(flags.index ? { index: true } : {}),
  };
}
const receiptOption = "--receipt";
const receiptHelp = "write a freshness sidecar alongside the named output";
function printingOptions(command: Command, report = false): Command {
  return command
    .option("--project <directory>", "electrical project directory", ".")
    .option(
      "-o, --output <file>",
      `write ${report ? ".csv, " : ""}.html, .pdf, single-sheet .svg, or .json`,
    )
    .option(
      "--json",
      report
        ? "return the report packet (SVG sheets, printable HTML and metadata) as JSON"
        : "return all SVG sheets, printable HTML and metadata as JSON",
    )
    .addOption(
      new Option("--paper <size>", "override project paper size").choices([
        "tabloid",
        "letter",
        "a3",
        "a4",
      ]),
    )
    .addOption(
      new Option("--orientation <orientation>", "page orientation").choices([
        "landscape",
        "portrait",
      ]),
    )
    .addOption(
      new Option(
        "--layout <mode>",
        "standard or bounded compact layout",
      ).choices(["standard", "compact"]),
    )
    .option("--index", "include drawing index and device/function references")
    .option("--margin <mm>", "paper margin in millimeters (5–25)");
}
interface AlphaState {
  exitCode: number;
}
type Produce = (
  flags: Flags,
  recipe?: Extract<ExportRecipe, { kind: "view" | "report" }>,
  inputs?: string[],
  snapshot?: Awaited<ReturnType<typeof standaloneSnapshot>>,
) => Promise<void>;
function registerAlphaInit(command: Command) {
  command
    .command("init <directory>")
    .description("create a project with visible, editable core library files")
    .option("--name <name>", "project name", "Thermite Electrical Project")
    .option("--revision <revision>", "drawing revision", "A")
    .addOption(
      new Option("--template <template>", "starter example")
        .choices(["starter", "cabinets"])
        .default("starter"),
    )
    .action(
      async (
        directory: string,
        options: {
          name: string;
          revision: string;
          template: "starter" | "cabinets";
        },
        init: Command,
      ) => {
        // Commander fills the default name; only an explicit --name names it.
        const { name, ...rest } = options;
        await initializeAlphaProject(directory, {
          ...rest,
          ...(init.getOptionValueSource("name") === "cli" ? { name } : {}),
        });
        process.stdout.write(
          `Initialized ${resolve(directory)} with a local core library. Read AGENTS.md; ` +
            "`thermite guide` lists reference topics.\n",
        );
      },
    );
}

function registerAlphaDiagnostics(command: Command, state: AlphaState) {
  command
    .command("diagnostics")
    .description(
      "audit required, unused and unfinished connections without changing the design",
    )
    .option("--project <directory>", "project directory", ".")
    .option("--device <designation>", "limit the inventory to one device")
    .option(
      "--location <name>",
      "limit the inventory to an exact location name",
    )
    .option("--json", "structured completeness inventory and findings")
    .option("-o, --output <file>", "write .txt, .json or .csv")
    .option(receiptOption, receiptHelp)
    .action(async (flags: Flags) => {
      const extension = flags.output ? extname(flags.output).toLowerCase() : "";
      if (flags.output && ![".txt", ".json", ".csv"].includes(extension))
        throw new Error("Diagnostics output must use .txt, .json or .csv.");
      if (flags.json && flags.output && extension !== ".json")
        throw new Error("--json output must use a .json filename.");
      const snapshot = await standaloneSnapshot(flags);
      const c = await standaloneCompile(flags, snapshot);
      if (!c.ok) {
        state.exitCode = compileFailure(c);
        return;
      }
      const scope = {
        ...(flags.device === undefined ? {} : { device: flags.device }),
        ...(flags.location === undefined ? {} : { location: flags.location }),
      };
      const format =
        flags.json || extension === ".json"
          ? "json"
          : extension === ".csv"
            ? "csv"
            : "txt";
      try {
        const content = completenessArtifact(c, scope, format);
        if (flags.output) {
          await writeStandaloneArtifact(
            flags,
            snapshot,
            { kind: "diagnostics", scope, inputs: [] },
            format,
            content,
          );
          process.stdout.write(`Wrote ${resolve(flags.output)}\n`);
        } else process.stdout.write(content);
        reportDiagnostics(c.diagnostics);
      } catch (error) {
        state.exitCode = artifactFailure(error, c.diagnostics);
      }
    });
}

function registerAlphaContinuity(command: Command, state: AlphaState) {
  command
    .command("continuity")
    .description(
      "check declared physical continuity obligations without inferring device behavior",
    )
    .option("--project <directory>", "project directory", ".")
    .requiredOption(
      "--input <file>",
      "continuity-check-request/0.1 JSON file, or - for stdin",
    )
    .option("--json", "structured physical continuity report")
    .option("-o, --output <file>", "write .txt or .json")
    .action(async (flags: Flags) => {
      const extension = flags.output ? extname(flags.output).toLowerCase() : "";
      if (flags.output && ![".txt", ".json"].includes(extension))
        throw new Error("Continuity output must use .txt or .json.");
      if (flags.json && flags.output && extension !== ".json")
        throw new Error("--json output must use a .json filename.");
      const compiled = await compileProject(flags.project);
      if (!compiled.ok) {
        process.stderr.write(
          JSON.stringify({ diagnostics: compiled.diagnostics }) + "\n",
        );
        state.exitCode = compiled.toolFailure ? 2 : 1;
        return;
      }
      let report;
      try {
        report = auditContinuity(compiled.ir, await requestJson(flags.input!));
      } catch (error) {
        process.stderr.write(
          JSON.stringify({
            diagnostics: compiled.diagnostics,
            error: {
              code: "Q001",
              message:
                error instanceof Error
                  ? error.message
                  : "Invalid continuity request.",
            },
          }) + "\n",
        );
        state.exitCode = 1;
        return;
      }
      const content =
        flags.json || extension === ".json"
          ? JSON.stringify(report, null, 2) + "\n"
          : `${report.counts.satisfied}/${report.counts.total} physical continuity obligations satisfied; ${report.counts.missingModeledPath} missing modeled paths; ${report.counts.indeterminate} indeterminate\n${report.checks.map((check) => `${check.status.toUpperCase()} ${check.id}: ${check.reason}${check.errors.length ? " - " + check.errors.map((e) => e.error.message).join("; ") : ""}`).join("\n")}\n${report.limitations.join("\n")}\n`;
      if (flags.output) {
        await writeAlphaOutput(
          flags.project,
          flags.output,
          content,
          flags.input === "-" ? [] : [flags.input!],
          { allowText: true },
        );
        process.stdout.write(`Wrote ${resolve(flags.output)}\n`);
      } else process.stdout.write(content);
      process.stderr.write(
        JSON.stringify({ diagnostics: compiled.diagnostics, error: null }) +
          "\n",
      );
      if (!report.passed) state.exitCode = 1;
    });
}

function artifactFailure(
  error: unknown,
  diagnostics: import("@thermite/schema").Diagnostic[],
) {
  if (error instanceof ArtifactError) {
    reportDiagnostics(diagnostics, error.finding);
    return 1;
  }
  if (error instanceof ExportInputError) {
    writeStandaloneFailure(error, diagnostics);
    return error.exitCode;
  }
  throw error;
}

function registerAlphaCable(command: Command, state: AlphaState) {
  command
    .command("cable <designation>")
    .description(
      "list every physical core, including spare and unassigned cores",
    )
    .option("--project <directory>", "project directory", ".")
    .option("--json", "structured core inventory")
    .option("-o, --output <file>", "write the core inventory as .json")
    .option(receiptOption, receiptHelp)
    .addHelpText(
      "after",
      "\nPrint the conductors with thermite view <designation> --conductors -o <file>.pdf.",
    )
    .action(async (designation: string, flags: Flags) => {
      if (flags.output && extname(flags.output).toLowerCase() !== ".json")
        throw new Error("Cable output must use .json.");
      const snapshot = await standaloneSnapshot(flags);
      const compiled = await standaloneCompile(flags, snapshot);
      if (!compiled.ok) {
        state.exitCode = compileFailure(compiled);
        return;
      }
      try {
        const schedule = cableSchedule(compiled, designation);
        if (flags.output) {
          await writeStandaloneArtifact(
            flags,
            snapshot,
            { kind: "cable", designation, inputs: [] },
            "json",
            jsonArtifact(schedule),
          );
          process.stdout.write(`Wrote ${resolve(flags.output)}\n`);
        } else
          process.stdout.write(
            flags.json
              ? jsonArtifact(schedule)
              : `${schedule.designation}: ${schedule.counts.total} cores, ${schedule.counts.spare} spare, ${schedule.counts.unassigned} unassigned\n${schedule.cores.map((core) => `${core.id.padEnd(8)} ${core.color.padEnd(12)} ${core.usage.padEnd(12)} ${core.endpoints[0]?.display ?? "unterminated"} → ${core.endpoints[1]?.display ?? "unterminated"}`).join("\n")}\n`,
          );
        reportDiagnostics(compiled.diagnostics);
      } catch (error) {
        state.exitCode = artifactFailure(error, compiled.diagnostics);
      }
    });
}

async function packetRecipe(
  flags: Flags,
  snapshot: Awaited<ReturnType<typeof standaloneSnapshot>>,
) {
  const path = flags.input!;
  const input = snapshot
    ? await standaloneDependency(snapshot, path)
    : undefined;
  let source: PacketRenderOptions["source"] = input?.source;
  const value = input
    ? input.value
    : await requestJson(path, (parsed) => {
        source = parsed;
      });
  return {
    kind: "packet" as const,
    request: effectivePacket(value, drawingOptions(flags)),
    strict: flags.strict ?? false,
    ...(source ? { source } : {}),
    inputs: input ? [input.binding] : [],
  };
}

const renderDrawing: DrawingRenderer = (compiled, recipe) => {
  if (recipe.kind === "packet") {
    // The renderer dispatches on the authored packet version and validates all fields.
    const request = recipe.request as unknown as SchematicPacketRequest;
    return renderSchematicPacket(
      compiled.ir,
      request,
      compiled.presentation,
      recipe.source ? { source: recipe.source } : undefined,
    );
  }
  const { page, ...options } = recipe.drawing;
  return renderSchematicSheets(
    compiled.ir,
    recipe.request,
    compiled.presentation,
    page,
    options,
  );
};

async function producePacket(
  state: AlphaState,
  flags: Flags,
  recipe?: Extract<ExportRecipe, { kind: "view" | "report" }>,
  inputs: string[] = [],
  prepared?: Awaited<ReturnType<typeof standaloneSnapshot>>,
) {
  const snapshot = prepared ?? (await standaloneSnapshot(flags));
  const compiled = await standaloneCompile(flags, snapshot);
  if (!compiled.ok) {
    state.exitCode = compileFailure(compiled);
    return;
  }
  const diagnostics = [...compiled.diagnostics];
  try {
    const request = recipe ?? (await packetRecipe(flags, snapshot));
    const result = await renderDrawing(compiled, request);
    if (!result.ok) throw new ArtifactError(result.error);
    const coverage = drawingDiagnostics(result.value, request.kind);
    diagnostics.push(...coverage);
    if (flags.strict && diagnostics.some((d) => d.severity === "warning")) {
      reportDiagnostics(diagnostics);
      state.exitCode = 1;
      return;
    }
    const extension =
      flags.output === undefined
        ? undefined
        : extname(flags.output).toLowerCase();
    if (flags.json && extension !== undefined && extension !== ".json")
      throw new Error("--json output must use a .json filename.");
    const format: ArtifactFormat =
      flags.json || extension === ".json"
        ? "json"
        : extension === ".svg"
          ? "svg"
          : extension === ".pdf"
            ? "pdf"
            : extension === ".csv"
              ? "csv"
              : "html";
    const content = await drawingArtifact(
      result.value,
      format,
      compiled.ir.project.name,
    );
    if (flags.output) {
      const protectedInputs =
        flags.input && flags.input !== "-" ? [flags.input] : inputs;
      await writeStandaloneArtifact(
        flags,
        snapshot,
        request,
        format,
        content,
        protectedInputs,
        coverage.length ? { diagnostics: coverage } : {},
      );
      process.stdout.write(
        `Wrote ${result.value.sheets.length} sheet(s) to ${resolve(flags.output)}\n`,
      );
    } else process.stdout.write(content);
    reportDiagnostics(diagnostics);
  } catch (error) {
    state.exitCode = artifactFailure(error, diagnostics);
  }
}

function registerAlphaView(command: Command, produce: Produce) {
  printingOptions(
    command
      .command("view <designation>")
      .description("generate readable fixed-paper SVG sheets"),
  )
    .option(receiptOption, receiptHelp)
    .option("--power", "power circuit")
    .option("--actuation", "control circuit")
    .option("--loads", "loads supplied by this device")
    .option("--conductors", "all cores of this cable")
    .option("--to <device>", "trace to another device")
    .option("--include-power", "include trace supply and return")
    .addOption(
      new Option("--flow <flow>", "drawing flow")
        .choices(["left-to-right", "top-to-bottom"])
        .default("left-to-right"),
    )
    .action(async (root: string, flags: Flags) =>
      produce(flags, {
        kind: "view",
        request: viewRequest(root, flags),
        drawing: drawingOptions(flags),
        inputs: [],
      }),
    );
}

function registerAlphaPacket(command: Command, produce: Produce) {
  printingOptions(
    command
      .command("packet")
      .description("combine views into consistently numbered printable sheets"),
  )
    .option(receiptOption, receiptHelp)
    .option(
      "--strict",
      "reject packet output when validation or coverage has warnings",
    )
    .requiredOption(
      "--input <file>",
      "schematic-packet-request/0.1 or schematic-packet-request/0.2 JSON file (titleData uses fixed slots and needs presentation 0.3), or - for stdin",
    )
    .action(async (flags: Flags) => produce(flags));
}

function registerAlphaReport(
  command: Command,
  state: AlphaState,
  produce: Produce,
) {
  printingOptions(
    command
      .command("report <kind>")
      .description(`generate a report; kinds: ${REPORT_KINDS.join(", ")}`),
    true,
  )
    .option(receiptOption, receiptHelp)
    .option(
      "--device <designation>",
      "limit terminal or I/O report to one device",
    )
    .option(
      "--filter <file>",
      "device/type/location filter JSON file, or - for stdin",
    )
    .action((kind: string, flags: Flags) =>
      produceReport(kind, flags, state, produce),
    );
}

async function produceReport(
  kind: string,
  flags: Flags,
  state: AlphaState,
  produce: Produce,
) {
  const report = REPORT_KINDS.find((value) => value === kind);
  if (!report)
    throw new Error(`Report kind must be ${REPORT_KINDS.join(", ")}.`);
  const snapshot = await standaloneSnapshot(flags);
  const input =
    snapshot && flags.filter
      ? await standaloneDependency(snapshot, flags.filter)
      : undefined;
  const filter = input
    ? input.value
    : flags.filter
      ? await requestJson(flags.filter)
      : undefined;
  const request = documentationRequest(
    report,
    flags.device || undefined,
    filter as DeviceFilter | undefined,
  );
  const recipe = {
    kind: "report" as const,
    request,
    drawing: drawingOptions(flags),
    inputs: input ? [input.binding] : [],
  };
  const protectedInputs = input ? [input.file] : [];
  if (!flags.output?.toLowerCase().endsWith(".csv")) {
    await produce(flags, recipe, protectedInputs, snapshot);
    return;
  }
  if (flags.json) throw new Error("--json output must use a .json filename.");
  const c = await standaloneCompile(flags, snapshot);
  if (!c.ok) {
    state.exitCode = compileFailure(c);
    return;
  }
  try {
    const { content, selection } = csvReport(c, request);
    await writeStandaloneArtifact(
      flags,
      snapshot,
      recipe,
      "csv",
      content,
      protectedInputs,
      selection ? { selection } : {},
    );
    process.stdout.write(`Wrote ${resolve(flags.output)}\n`);
    process.stderr.write(
      JSON.stringify({
        diagnostics: c.diagnostics,
        error: null,
        ...(selection ? { selection } : {}),
      }) + "\n",
    );
  } catch (error) {
    state.exitCode = artifactFailure(error, c.diagnostics);
  }
}

function registerAlphaSnapshot(command: Command, state: AlphaState) {
  command
    .command("snapshot")
    .description("save semantic source state for later review")
    .option("--project <directory>", "project directory", ".")
    .requiredOption("-o, --output <file>", "snapshot .json file")
    .action(async (flags: Flags) => {
      if (!flags.output?.toLowerCase().endsWith(".json"))
        throw new Error("Snapshot output must use .json.");
      const c = await compileProject(flags.project);
      if (!c.ok) {
        process.stderr.write(
          JSON.stringify({ diagnostics: c.diagnostics }) + "\n",
        );
        state.exitCode = c.toolFailure ? 2 : 1;
        return;
      }
      await writeAlphaOutput(
        flags.project,
        flags.output,
        JSON.stringify(createProjectSnapshot(c.ir), null, 2) + "\n",
      );
      process.stdout.write(`Saved ${resolve(flags.output)}\n`);
      process.stderr.write(
        JSON.stringify({ diagnostics: c.diagnostics, error: null }) + "\n",
      );
    });
}

function registerAlphaReview(command: Command, state: AlphaState) {
  command
    .command("review")
    .description("compare the current project with a saved semantic snapshot")
    .option("--project <directory>", "project directory", ".")
    .requiredOption("--before <file>", "baseline snapshot")
    .option("--json", "structured semantic review")
    .option("-o, --output <file>", "review .json file")
    .option(receiptOption, receiptHelp)
    .action(async (flags: Flags) => {
      if (flags.output && !flags.output.toLowerCase().endsWith(".json"))
        throw new Error("Review output must use .json.");
      const snapshot = await standaloneSnapshot(flags);
      const before = flags.before!;
      const input = snapshot
        ? await standaloneDependency(snapshot, before)
        : undefined;
      const baseline = parseProjectSnapshot(
        input ? input.value : await requestJson(before),
      );
      const c = await standaloneCompile(flags, snapshot);
      if (!c.ok) {
        state.exitCode = compileFailure(c);
        return;
      }
      const review = semanticReview(c, baseline);
      const json = jsonArtifact(review);
      if (flags.output) {
        try {
          await writeStandaloneArtifact(
            flags,
            snapshot,
            { kind: "review", baseline, inputs: input ? [input.binding] : [] },
            "json",
            json,
            [before],
          );
        } catch (error) {
          state.exitCode = artifactFailure(error, c.diagnostics);
          return;
        }
      } else
        process.stdout.write(
          flags.json
            ? json
            : `${review.changes.length} semantic changes\n${review.changes.map((c) => `${c.operation.toUpperCase()} ${c.kind} ${c.label}: ${c.summary}`).join("\n")}\nDirectly affected devices: ${review.affectedDevices.map((d) => d.designation).join(", ") || "None"}\n`,
        );
      process.stderr.write(
        JSON.stringify({ diagnostics: c.diagnostics, error: null }) + "\n",
      );
    });
}

function registerAlphaWatch(
  command: Command,
  state: AlphaState,
  produce: Produce,
) {
  printingOptions(
    command
      .command("watch")
      .description(
        "poll declared inputs and the request to regenerate a packet (macOS, Linux, Windows)",
      ),
  )
    .requiredOption("--input <file>", "packet request file")
    .action(async (flags: Flags) => {
      if (!flags.output) throw new Error("Watch requires an output file.");
      await watchAlphaProject(
        flags.project,
        flags.input!,
        flags.output,
        async () => {
          state.exitCode = 0;
          await produce(flags);
        },
      );
    });
}
/** Alpha entry point; existing thermite and its six guarded agent tools remain compatible. */
export async function runThermite(argv = process.argv): Promise<number> {
  const forwarded = [
    "validate",
    "lock",
    "compile",
    "inspect",
    "neighbors",
    "trace",
    "net",
    "render",
    "agent",
  ];
  if (forwarded.includes(argv[2] ?? "")) return runCli(argv);
  const state: AlphaState = { exitCode: 0 };
  const command = new Command("thermite")
    .description(
      "Thermite Schematics — electrical JSON to printable ELK drawings",
    )
    .version(THERMITE_VERSION)
    .exitOverride();
  registerGuideCommand(command);
  registerAlphaInit(command);
  registerAlphaDiagnostics(command, state);
  registerAlphaContinuity(command, state);
  registerAlphaCable(command, state);
  const produce: Produce = (...args) => producePacket(state, ...args);
  registerAlphaView(command, produce);
  registerAlphaPacket(command, produce);
  registerAlphaReport(command, state, produce);
  registerAlphaSnapshot(command, state);
  registerAlphaReview(command, state);
  registerAlphaWatch(command, state, produce);
  registerAlphaExport(command, state, renderDrawing);
  command.addHelpText(
    "after",
    "\nExisting commands: validate, lock, compile, inspect, neighbors, trace, net, render, agent.\nUse thermite agent --help for the six guarded, stateless agent tools.\n",
  );
  try {
    await command.parseAsync(argv);
    return state.exitCode;
  } catch (error) {
    if (error instanceof CommanderError) return error.exitCode === 0 ? 0 : 2;
    if (error instanceof ExportInputError) {
      writeStandaloneFailure(error);
      return error.exitCode;
    }
    process.stderr.write(
      JSON.stringify({
        error: {
          code: "T001",
          message: error instanceof Error ? error.message : "Command failed.",
        },
      }) + "\n",
    );
    return 2;
  }
}
