import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { analyzeCompleteness, compileProject } from "@thermite/compiler";
import {
  buildDocumentation,
  documentationCsv,
  REPORT_KINDS,
  createProjectSnapshot,
  parseProjectSnapshot,
  reviewProject,
  type DocumentationRequest,
  type ReportKind,
  buildCableSchedule,
  createQueryEngine,
} from "@thermite/query";
import {
  renderSchematicPacket,
  renderSchematicSheets,
  type PageSettings,
  type SchematicPacketRequest,
  type SchematicViewRequest,
} from "@thermite/render";
import { parseJson } from "@thermite/schema";
import { Command, CommanderError, Option } from "commander";
import { runCli } from "./index.js";
import { initializeAlphaProject } from "./alpha-init.js";
import { watchAlphaProject } from "./alpha-watch.js";
import { packetPdf } from "./alpha-pdf.js";
import { completenessText, completenessCsv } from "./alpha-diagnostics.js";
import { writeAlphaOutput } from "./alpha-output.js";

export const THERMITE_VERSION = "0.3.0-alpha.2";
interface Flags {
  project: string;
  output?: string;
  json?: boolean;
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
}
async function requestJson(path: string): Promise<unknown> {
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
  const selector = { by: "designation" as const, value: root },
    flow = flags.flow ?? "left-to-right";
  if (flags.power || flags.actuation)
    return {
      format: "schematic-view-request/0.1",
      root: selector,
      family: flags.power ? "power" : "control",
      flow,
    };
  return {
    format: "schematic-view-request/0.2",
    root: selector,
    flow,
    intent:
      flags.to !== undefined
        ? {
            kind: "trace",
            to: { by: "designation", value: flags.to },
            includePower: flags.includePower ?? false,
          }
        : { kind: flags.loads ? "loads" : "conductors" },
  };
}
function printingOptions(command: Command): Command {
  return command
    .option("--project <directory>", "electrical project directory", ".")
    .option(
      "-o, --output <file>",
      "write .html, .pdf, single-sheet .svg, or .json",
    )
    .option("--json", "return all SVG sheets and metadata as JSON")
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
  let exitCode = 0;
  const command = new Command("thermite")
    .description(
      "Thermite Schematics — electrical JSON to printable ELK drawings",
    )
    .version(THERMITE_VERSION)
    .exitOverride();
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
      ) => {
        await initializeAlphaProject(directory, options);
        process.stdout.write(
          `Initialized ${resolve(directory)} with a local core library.\n`,
        );
      },
    );
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
    .action(async (flags: Flags) => {
      const extension = flags.output ? extname(flags.output).toLowerCase() : "";
      if (flags.output && ![".txt", ".json", ".csv"].includes(extension))
        throw new Error("Diagnostics output must use .txt, .json or .csv.");
      if (flags.json && flags.output && extension !== ".json")
        throw new Error("--json output must use a .json filename.");
      const c = await compileProject(flags.project);
      if (!c.ok) {
        process.stderr.write(
          JSON.stringify({ diagnostics: c.diagnostics }) + "\n",
        );
        exitCode = c.toolFailure ? 2 : 1;
        return;
      }
      let report;
      try {
        report = analyzeCompleteness(c.ir, {
          ...(flags.device === undefined ? {} : { device: flags.device }),
          ...(flags.location === undefined ? {} : { location: flags.location }),
        });
      } catch (error) {
        process.stderr.write(
          JSON.stringify({
            diagnostics: c.diagnostics,
            error: {
              code: "Q001",
              message:
                error instanceof Error ? error.message : "Invalid scope.",
            },
          }) + "\n",
        );
        exitCode = 1;
        return;
      }
      const content =
        flags.json || extension === ".json"
          ? JSON.stringify(report, null, 2) + "\n"
          : extension === ".csv"
            ? completenessCsv(report)
            : completenessText(report);
      if (flags.output) {
        await writeAlphaOutput(flags.project, flags.output, content, [], {
          allowText: true,
        });
        process.stdout.write(`Wrote ${resolve(flags.output)}\n`);
      } else process.stdout.write(content);
      process.stderr.write(
        JSON.stringify({ diagnostics: c.diagnostics, error: null }) + "\n",
      );
    });
  command
    .command("cable <designation>")
    .description(
      "list every physical core, including spare and unassigned cores",
    )
    .option("--project <directory>", "project directory", ".")
    .option("--json", "structured core inventory")
    .action(async (designation: string, flags: Flags) => {
      const compiled = await compileProject(flags.project);
      if (!compiled.ok) {
        process.stderr.write(
          JSON.stringify({ diagnostics: compiled.diagnostics }) + "\n",
        );
        exitCode = compiled.toolFailure ? 2 : 1;
        return;
      }
      const resolved = createQueryEngine(compiled.ir).cable({
        by: "designation",
        value: designation,
      });
      if (!resolved.ok) {
        process.stderr.write(
          JSON.stringify({
            diagnostics: compiled.diagnostics,
            error: resolved.error,
          }) + "\n",
        );
        exitCode = 1;
        return;
      }
      const schedule = buildCableSchedule(
        compiled.ir,
        resolved.value.cable.uid,
      );
      process.stdout.write(
        flags.json
          ? JSON.stringify(schedule, null, 2) + "\n"
          : `${schedule.designation}: ${schedule.counts.total} cores, ${schedule.counts.spare} spare, ${schedule.counts.unassigned} unassigned\n${schedule.cores.map((core) => `${core.id.padEnd(8)} ${core.color.padEnd(12)} ${core.usage.padEnd(12)} ${core.endpoints[0]?.display ?? "unterminated"} → ${core.endpoints[1]?.display ?? "unterminated"}`).join("\n")}\n`,
      );
      process.stderr.write(
        JSON.stringify({ diagnostics: compiled.diagnostics, error: null }) +
          "\n",
      );
    });
  async function produce(
    flags: Flags,
    view?: SchematicViewRequest | DocumentationRequest,
  ) {
    const compiled = await compileProject(flags.project);
    if (!compiled.ok) {
      process.stderr.write(
        JSON.stringify({ diagnostics: compiled.diagnostics }) + "\n",
      );
      exitCode = compiled.toolFailure ? 2 : 1;
      return;
    }
    const page = pageFlags(flags);
    let packet: SchematicPacketRequest | undefined;
    if (view === undefined) {
      const value = await requestJson(flags.input!);
      if (typeof value !== "object" || value === null || Array.isArray(value))
        throw new Error("Packet request must be a JSON object.");
      const authoredPage = (value as { page?: unknown }).page;
      if (
        Object.hasOwn(value, "page") &&
        (typeof authoredPage !== "object" ||
          authoredPage === null ||
          Array.isArray(authoredPage))
      )
        throw new Error("Packet page must be a JSON object.");
      packet = {
        ...value,
        ...(flags.layout ? { layout: flags.layout } : {}),
        ...(flags.index ? { index: true } : {}),
        ...(page === undefined
          ? {}
          : {
              page: {
                ...(authoredPage as Record<string, unknown> | undefined),
                ...page,
              },
            }),
      } as SchematicPacketRequest;
    }
    const result = await renderSchematicPacket(
      compiled.ir,
      packet ?? {
        format: "schematic-packet-request/0.1",
        views: [view!],
        ...(page ? { page } : {}),
        ...(flags.layout ? { layout: flags.layout } : {}),
        ...(flags.index ? { index: true } : {}),
      },
      compiled.presentation,
    );
    if (!result.ok) {
      process.stderr.write(
        JSON.stringify({
          diagnostics: compiled.diagnostics,
          error: result.error,
        }) + "\n",
      );
      exitCode = 1;
      return;
    }
    let content: string | Buffer;
    const extension =
      flags.output === undefined
        ? undefined
        : extname(flags.output).toLowerCase();
    if (flags.json && extension !== undefined && extension !== ".json")
      throw new Error("--json output must use a .json filename.");
    if (flags.json || extension === ".json")
      content = JSON.stringify(result.value, null, 2) + "\n";
    else if (extension === ".svg") {
      if (result.value.sheets.length !== 1) {
        process.stderr.write(
          JSON.stringify({
            diagnostics: compiled.diagnostics,
            error: {
              code: "R006",
              message: `This view requires ${result.value.sheets.length} sheets. Use .html, .pdf or .json to retain the complete drawing.`,
            },
          }) + "\n",
        );
        exitCode = 1;
        return;
      }
      content = result.value.sheets[0]!.svg;
    } else if (extension === ".pdf")
      content = await packetPdf(result.value, compiled.ir.project.name);
    else if (extension === ".csv")
      throw new Error("Use thermite report <kind> to export a CSV schedule.");
    else content = result.value.html;
    if (flags.output) {
      await writeAlphaOutput(
        flags.project,
        flags.output,
        content,
        flags.input && flags.input !== "-" ? [flags.input] : [],
      );
      process.stdout.write(
        `Wrote ${result.value.sheets.length} sheet(s) to ${resolve(flags.output)}\n`,
      );
    } else process.stdout.write(content);
    process.stderr.write(
      JSON.stringify({ diagnostics: compiled.diagnostics, error: null }) + "\n",
    );
  }
  printingOptions(
    command
      .command("view <designation>")
      .description("generate readable fixed-paper SVG sheets"),
  )
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
      produce(flags, viewRequest(root, flags)),
    );
  printingOptions(
    command
      .command("packet")
      .description("combine views into consistently numbered printable sheets"),
  )
    .requiredOption(
      "--input <file>",
      "schematic-packet-request/0.1 JSON file, or - for stdin",
    )
    .action(async (flags: Flags) => produce(flags));
  printingOptions(
    command
      .command("report <kind>")
      .description(
        "generate BOM, wire/cable/network schedules, terminal and I/O plans",
      ),
  )
    .option(
      "--device <designation>",
      "limit terminal or I/O report to one device",
    )
    .action(async (kind: string, flags: Flags) => {
      if (!REPORT_KINDS.includes(kind as ReportKind))
        throw new Error(`Report kind must be ${REPORT_KINDS.join(", ")}.`);
      const request: DocumentationRequest = {
        format: "documentation-view-request/0.1",
        kind: kind as ReportKind,
        ...(flags.device ? { device: flags.device } : {}),
      };
      if (flags.output?.toLowerCase().endsWith(".csv")) {
        if (flags.json)
          throw new Error("--json output must use a .json filename.");
        const c = await compileProject(flags.project);
        if (!c.ok) {
          process.stderr.write(
            JSON.stringify({ diagnostics: c.diagnostics }) + "\n",
          );
          exitCode = c.toolFailure ? 2 : 1;
          return;
        }
        await writeAlphaOutput(
          flags.project,
          flags.output,
          documentationCsv(buildDocumentation(c.ir, request)),
        );
        process.stdout.write(`Wrote ${resolve(flags.output)}\n`);
        process.stderr.write(
          JSON.stringify({ diagnostics: c.diagnostics, error: null }) + "\n",
        );
      } else await produce(flags, request);
    });
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
        exitCode = c.toolFailure ? 2 : 1;
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
  command
    .command("review")
    .description("compare the current project with a saved semantic snapshot")
    .option("--project <directory>", "project directory", ".")
    .requiredOption("--before <file>", "baseline snapshot")
    .option("--json", "structured semantic review")
    .option("-o, --output <file>", "review .json file")
    .action(async (flags: Flags) => {
      if (flags.output && !flags.output.toLowerCase().endsWith(".json"))
        throw new Error("Review output must use .json.");
      const baseline = parseProjectSnapshot(await requestJson(flags.before!));
      const c = await compileProject(flags.project);
      if (!c.ok) {
        process.stderr.write(
          JSON.stringify({ diagnostics: c.diagnostics }) + "\n",
        );
        exitCode = c.toolFailure ? 2 : 1;
        return;
      }
      const review = reviewProject(baseline, createProjectSnapshot(c.ir));
      const json = JSON.stringify(review, null, 2) + "\n";
      if (flags.output)
        await writeAlphaOutput(flags.project, flags.output, json, [
          flags.before!,
        ]);
      else
        process.stdout.write(
          flags.json
            ? json
            : `${review.changes.length} semantic changes\n${review.changes.map((c) => `${c.operation.toUpperCase()} ${c.kind} ${c.label}: ${c.summary}`).join("\n")}\nDirectly affected devices: ${review.affectedDevices.map((d) => d.designation).join(", ") || "None"}\n`,
        );
      process.stderr.write(
        JSON.stringify({ diagnostics: c.diagnostics, error: null }) + "\n",
      );
    });
  printingOptions(
    command
      .command("watch")
      .description("regenerate a packet after local JSON changes (macOS)"),
  )
    .requiredOption("--input <file>", "packet request file")
    .action(async (flags: Flags) => {
      if (!flags.output) throw new Error("Watch requires an output file.");
      await watchAlphaProject(
        flags.project,
        flags.input!,
        flags.output,
        async () => {
          exitCode = 0;
          await produce(flags);
        },
      );
    });
  command.addHelpText(
    "after",
    "\nExisting commands: validate, lock, compile, inspect, neighbors, trace, net, render, agent.\nUse thermite agent --help for the six guarded, stateless agent tools.\n",
  );
  try {
    await command.parseAsync(argv);
    return exitCode;
  } catch (error) {
    if (error instanceof CommanderError) return error.exitCode === 0 ? 0 : 2;
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
