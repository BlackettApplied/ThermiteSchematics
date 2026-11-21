import { extname, resolve } from "node:path";
import type { LoadedProject } from "@thermite/compiler";
import {
  parseProjectSnapshot,
  REPORT_KINDS,
  resolveDeviceFilter,
  type DocumentationRequest,
} from "@thermite/query";
import {
  artifactIntent,
  effectivePacket,
  makeViewRequest,
  type ArtifactFormat,
  type DrawingOptions,
  type ExportRecipe,
} from "./alpha-export-artifact.js";
import {
  ExportInputError,
  isJsonObject,
  namedExportInput,
  portablePath,
  readExportJson,
} from "./alpha-export-input.js";

export const DELIVERY_FORMAT = "export-delivery-request/1";
export const MANIFEST_PATH = "export-manifest.json";
export const RECEIPT_SUFFIX = ".receipt.json";

const drawingFormats = ["json", "svg", "html", "pdf"] as const;
const printingKeys = ["page", "layout", "index"];
const flowChoices = ["left-to-right", "top-to-bottom"] as const;
const viewIntents = [
  "power",
  "actuation",
  "loads",
  "conductors",
  "trace",
] as const;

function fields(value: unknown, keys?: readonly string[]) {
  if (!isJsonObject(value))
    throw new ExportInputError(
      "Expected a JSON object in the delivery request.",
    );
  for (const key of Object.keys(value)) {
    if (keys && !keys.includes(key))
      throw new ExportInputError(`Unknown delivery field ${key}.`);
  }
  return value;
}

function text(value: unknown, key: string): string {
  if (typeof value !== "string" || !value.trim())
    throw new ExportInputError(`${key} must be a nonempty string.`);
  return value;
}

function option<T extends string>(
  value: unknown,
  choices: readonly T[],
  key: string,
): T {
  const match = choices.find((choice) => choice === value);
  if (!match)
    throw new ExportInputError(`${key} must be one of ${choices.join(", ")}.`);
  return match;
}

function flag(value: unknown, key: string) {
  if (value === undefined) return false;
  if (typeof value !== "boolean")
    throw new ExportInputError(`${key} must be a boolean.`);
  return value;
}

function printing(job: Record<string, unknown>): DrawingOptions {
  return {
    ...(flag(job.index, "index") ? { index: true } : {}),
    ...(job.layout === undefined
      ? {}
      : {
          layout: option(
            job.layout,
            ["compact", "standard"] as const,
            "layout",
          ),
        }),
    ...(job.page === undefined ? {} : { page: pageOverride(job.page) }),
  };
}

function pageOverride(value: unknown) {
  const page = fields(value, ["size", "orientation", "marginMm"]);
  const margin = page.marginMm;
  if (
    margin !== undefined &&
    (typeof margin !== "number" ||
      !Number.isFinite(margin) ||
      margin < 5 ||
      margin > 25)
  )
    throw new ExportInputError(
      "page.marginMm must be a number between 5 and 25.",
    );
  return {
    ...(page.size === undefined
      ? {}
      : {
          size: option(
            page.size,
            ["tabloid", "letter", "a3", "a4"] as const,
            "page.size",
          ),
        }),
    ...(page.orientation === undefined
      ? {}
      : {
          orientation: option(
            page.orientation,
            ["landscape", "portrait"] as const,
            "page.orientation",
          ),
        }),
    ...(margin === undefined ? {} : { marginMm: margin }),
  };
}

interface Output {
  path: string;
  format: ArtifactFormat;
}

function outputs(value: unknown, allowed: readonly ArtifactFormat[]): Output[] {
  const result = Object.entries(fields(value, allowed)).map(([key, value]) => {
    const format = option(key, allowed, "output format");
    const path = portablePath(text(value, "output path"));
    if (extname(path).toLowerCase() !== "." + format)
      throw new ExportInputError(
        `Output ${path} must use the .${format} extension.`,
      );
    return { path, format };
  });
  if (!result.length)
    throw new ExportInputError("Each job requires at least one output.");
  return result;
}

export function documentationRequest(
  kind: DocumentationRequest["kind"],
  device?: string,
  filter?: unknown,
): DocumentationRequest {
  return {
    format: "documentation-view-request/0.1",
    kind,
    ...(device === undefined ? {} : { device }),
    ...(filter === undefined
      ? {}
      : { filter: resolveDeviceFilter(undefined, filter) }),
  };
}

export interface DeliveryJob {
  recipe: ExportRecipe;
  outputs: Output[];
}

type ReadDependency = (path: string) => ReturnType<typeof namedExportInput>;

async function packetJob(
  value: unknown,
  read: ReadDependency,
): Promise<DeliveryJob> {
  const job = fields(value, [
    "kind",
    "outputs",
    "input",
    "strict",
    ...printingKeys,
  ]);
  const input = await read(text(job.input, "packet input"));
  let request;
  try {
    request = effectivePacket(input.value, printing(job));
  } catch (error) {
    throw new ExportInputError(
      error instanceof Error ? error.message : "Invalid packet request.",
    );
  }
  return {
    recipe: {
      kind: "packet",
      request,
      strict: flag(job.strict, "strict"),
      source: input.source,
      inputs: [input.binding],
    },
    outputs: outputs(job.outputs, drawingFormats),
  };
}

function viewJob(value: unknown): DeliveryJob {
  const job = fields(value, [
    "kind",
    "outputs",
    "designation",
    "intent",
    "flow",
    "to",
    "includePower",
    ...printingKeys,
  ]);
  const intent = option(job.intent, viewIntents, "view intent");
  if (
    intent !== "trace" &&
    (job.to !== undefined || job.includePower !== undefined)
  )
    throw new ExportInputError(
      "to and includePower require the trace view intent.",
    );
  const request = makeViewRequest(
    text(job.designation, "view designation"),
    intent,
    job.flow === undefined ? undefined : option(job.flow, flowChoices, "flow"),
    intent === "trace"
      ? {
          to: text(job.to, "trace destination"),
          includePower: flag(job.includePower, "includePower"),
        }
      : undefined,
  );
  return {
    recipe: { kind: "view", request, drawing: printing(job), inputs: [] },
    outputs: outputs(job.outputs, drawingFormats),
  };
}

async function reportJob(
  value: unknown,
  read: ReadDependency,
): Promise<DeliveryJob> {
  const job = fields(value, [
    "kind",
    "outputs",
    "report",
    "device",
    "filter",
    ...printingKeys,
  ]);
  const filter =
    job.filter === undefined
      ? undefined
      : await read(text(job.filter, "filter"));
  const device =
    job.device === undefined ? undefined : text(job.device, "device");
  if (device && filter)
    throw new ExportInputError("Choose either a report device or a filter.");
  const kind = option(job.report, REPORT_KINDS, "report kind");
  let request;
  try {
    request = documentationRequest(kind, device, filter?.value);
  } catch (error) {
    throw new ExportInputError(
      error instanceof Error ? error.message : "Invalid device filter.",
    );
  }
  return {
    recipe: {
      kind: "report",
      request,
      drawing: printing(job),
      inputs: filter ? [filter.binding] : [],
    },
    outputs: outputs(job.outputs, [...drawingFormats, "csv"]),
  };
}

function diagnosticsJob(value: unknown): DeliveryJob {
  const job = fields(value, ["kind", "outputs", "device", "location"]);
  const scope = {
    ...(job.device === undefined ? {} : { device: text(job.device, "device") }),
    ...(job.location === undefined
      ? {}
      : { location: text(job.location, "location") }),
  };
  return {
    recipe: { kind: "diagnostics", scope, inputs: [] },
    outputs: outputs(job.outputs, ["json", "txt", "csv"]),
  };
}

async function reviewJob(
  value: unknown,
  read: ReadDependency,
): Promise<DeliveryJob> {
  const job = fields(value, ["kind", "outputs", "before"]);
  const before = await read(text(job.before, "review baseline"));
  let baseline;
  try {
    baseline = parseProjectSnapshot(before.value);
  } catch (error) {
    throw new ExportInputError(
      error instanceof Error ? error.message : "Invalid review baseline.",
    );
  }
  return {
    recipe: { kind: "review", baseline, inputs: [before.binding] },
    outputs: outputs(job.outputs, ["json"]),
  };
}

async function deliveryJob(
  value: unknown,
  read: ReadDependency,
): Promise<DeliveryJob> {
  switch (fields(value).kind) {
    case "packet":
      return packetJob(value, read);
    case "view":
      return viewJob(value);
    case "report":
      return reportJob(value, read);
    case "diagnostics":
      return diagnosticsJob(value);
    case "review":
      return reviewJob(value, read);
    case "cable": {
      const job = fields(value, ["kind", "outputs", "designation"]);
      return {
        recipe: {
          kind: "cable",
          designation: text(job.designation, "cable designation"),
          inputs: [],
        },
        outputs: outputs(job.outputs, ["json"]),
      };
    }
    default:
      throw new ExportInputError("Unknown delivery job kind.");
  }
}

export interface DeliveryPlan {
  jobs: DeliveryJob[];
  protectedInputs: string[];
  requestSha256: string;
}

export async function loadDeliveryPlan(
  project: LoadedProject,
  path: string,
): Promise<DeliveryPlan> {
  if (path === "-")
    throw new ExportInputError("The delivery request must be a named file.", 2);
  const file = resolve(path);
  const input = await readExportJson(file, "delivery request");
  const request = fields(input.value, ["format", "jobs"]);
  if (request.format !== DELIVERY_FORMAT)
    throw new ExportInputError(`Expected delivery format ${DELIVERY_FORMAT}.`);
  if (!Array.isArray(request.jobs) || !request.jobs.length)
    throw new ExportInputError(
      "The delivery request requires a nonempty jobs array.",
    );
  const dependencies = new Map<string, ReturnType<ReadDependency>>();
  function read(path: string) {
    const pending = dependencies.get(path) ?? namedExportInput(project, path);
    dependencies.set(path, pending);
    return pending;
  }
  const jobs: DeliveryJob[] = [];
  for (const value of request.jobs) jobs.push(await deliveryJob(value, read));
  return {
    jobs,
    protectedInputs: [
      file,
      ...(await Promise.all(dependencies.values())).map(
        (dependency) => dependency.file,
      ),
    ],
    requestSha256: input.sha256,
  };
}

export interface PlannedArtifact extends Output {
  intent: ReturnType<typeof artifactIntent>;
}
export function plannedArtifacts(plan: DeliveryPlan): PlannedArtifact[] {
  return plan.jobs.flatMap(({ recipe, outputs }) =>
    outputs.map((output) => ({
      ...output,
      intent: artifactIntent(recipe, output.format),
    })),
  );
}

export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        )
      : item,
  );
}
