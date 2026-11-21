import type { CompileResult } from "@thermite/compiler";
import { analyzeCompleteness } from "@thermite/compiler";
import {
  buildCableSchedule,
  buildDocumentation,
  createProjectSnapshot,
  createQueryEngine,
  documentationCsv,
  reviewProject,
  type DocumentationRequest,
  type ProjectSnapshot,
} from "@thermite/query";
import type {
  PacketRenderOptions,
  PageSettings,
  RenderedPacket,
  SchematicPacketRequest,
  SchematicViewRequest,
  renderSchematicPacket,
} from "@thermite/render";
import { completenessCsv, completenessText } from "./alpha-diagnostics.js";
import { isJsonObject, type InputBinding } from "./alpha-export-input.js";
import { packetPdf } from "./alpha-pdf.js";
import { embedPrintableFont, fontBudgetFailure } from "./printable-font.js";
import { singleSheetSvg } from "./terminal-report-svg.js";

export type Compiled = Extract<CompileResult, { ok: true }>;
export type ArtifactFormat = "json" | "svg" | "html" | "pdf" | "csv" | "txt";
export type DrawingOptions = Pick<
  SchematicPacketRequest,
  "layout" | "index"
> & {
  page?: PageSettings;
};
type DrawingView =
  | { kind: "view"; request: SchematicViewRequest; drawing: DrawingOptions }
  | { kind: "report"; request: DocumentationRequest; drawing: DrawingOptions };
export type ExportRecipe = (
  | DrawingView
  | {
      kind: "packet";
      request: Record<string, unknown>;
      strict: boolean;
      source?: NonNullable<PacketRenderOptions["source"]>;
    }
  | { kind: "diagnostics"; scope: { device?: string; location?: string } }
  | { kind: "cable"; designation: string }
  | { kind: "review"; baseline: ProjectSnapshot }
) & { inputs: InputBinding[] };

export function jsonArtifact(value: unknown): string {
  return JSON.stringify(value, null, 2) + "\n";
}

export function artifactIntent(recipe: ExportRecipe, format: ArtifactFormat) {
  return {
    kind: recipe.kind,
    format,
    inputs: recipe.inputs,
    options: artifactOptions(recipe, format),
  };
}

function artifactOptions(recipe: ExportRecipe, format: ArtifactFormat) {
  switch (recipe.kind) {
    case "packet":
      return { request: recipe.request, strict: recipe.strict };
    case "view":
    case "report":
      return {
        request: recipe.request,
        ...(format === "csv" ? {} : recipe.drawing),
      };
    case "diagnostics":
      return recipe.scope;
    case "cable":
      return { designation: recipe.designation };
    case "review":
      return {};
  }
}

/** Shared request construction for CLI flags and explicit delivery jobs. */
export function makeViewRequest(
  designation: string,
  intent: "power" | "actuation" | "loads" | "conductors" | "trace",
  flow: "left-to-right" | "top-to-bottom" = "left-to-right",
  trace?: { to: string; includePower: boolean },
): SchematicViewRequest {
  const root = { by: "designation" as const, value: designation };
  if (intent === "power" || intent === "actuation")
    return {
      format: "schematic-view-request/0.1",
      root,
      family: intent === "power" ? "power" : "control",
      flow,
    };
  if (intent === "trace") {
    if (!trace) throw new Error("A trace requires a destination device.");
    return {
      format: "schematic-view-request/0.2",
      root,
      flow,
      intent: {
        kind: "trace",
        to: { by: "designation", value: trace.to },
        includePower: trace.includePower,
      },
    };
  }
  return {
    format: "schematic-view-request/0.2",
    root,
    flow,
    intent: { kind: intent },
  };
}

export function effectivePacket(
  value: unknown,
  { page, layout, index }: DrawingOptions,
) {
  if (!isJsonObject(value))
    throw new Error("Packet request must be a JSON object.");
  const authoredPage = isJsonObject(value.page) ? value.page : undefined;
  if (Object.hasOwn(value, "page") && !authoredPage)
    throw new Error("Packet page must be a JSON object.");
  // The renderer validates the complete discriminated packet and view schemas.
  return {
    ...value,
    ...(layout ? { layout } : {}),
    ...(index ? { index: true } : {}),
    ...(page === undefined
      ? {}
      : {
          page: {
            ...authoredPage,
            ...page,
          },
        }),
  };
}

export type DrawingRecipe = Extract<
  ExportRecipe,
  { kind: "packet" | "view" | "report" }
>;
export type DrawingRenderer = (
  compiled: Compiled,
  recipe: DrawingRecipe,
) => ReturnType<typeof renderSchematicPacket>;

export class ArtifactError extends Error {
  constructor(readonly finding: { code: string; message: string }) {
    super(finding.message);
  }
}

function multipleSheetError(packet: RenderedPacket) {
  const seen = new Set<string>();
  return {
    code: "R006",
    message: `This view requires ${packet.sheets.length} sheets. Use .html, .pdf or .json to retain the complete drawing.`,
    details: {
      devices: packet.sheets.flatMap((s) =>
        s.references
          .filter(({ deviceUid }) => {
            if (seen.has(deviceUid)) return false;
            seen.add(deviceUid);
            return true;
          })
          .map(({ deviceUid, designation }) => ({
            deviceUid,
            designation,
          })),
      ),
    },
  };
}

export async function drawingArtifact(
  packet: RenderedPacket,
  format: ArtifactFormat,
  title: string,
) {
  try {
    switch (format) {
      case "json":
        return jsonArtifact(packet);
      case "svg": {
        const svg = singleSheetSvg(packet);
        if (svg === undefined)
          throw new ArtifactError(multipleSheetError(packet));
        return embedPrintableFont(svg);
      }
      case "pdf":
        return await packetPdf(packet, title);
      case "html":
        return packet.html;
      default:
        throw new Error("Use thermite report <kind> to export a CSV schedule.");
    }
  } catch (error) {
    const failure = fontBudgetFailure(error);
    if (failure) throw new ArtifactError(failure);
    throw error;
  }
}

export function csvReport(compiled: Compiled, request: DocumentationRequest) {
  const table = buildDocumentation(compiled.ir, request, undefined, {
    output: "csv",
  });
  return { content: documentationCsv(table), selection: table.selection };
}

export function completenessArtifact(
  compiled: Compiled,
  scope: { device?: string; location?: string },
  format: ArtifactFormat,
) {
  let report;
  try {
    report = analyzeCompleteness(compiled.ir, scope);
  } catch (error) {
    throw new ArtifactError({
      code: "Q001",
      message: error instanceof Error ? error.message : "Invalid scope.",
    });
  }
  return format === "json"
    ? jsonArtifact(report)
    : format === "csv"
      ? completenessCsv(report)
      : completenessText(report);
}

export function cableSchedule(compiled: Compiled, designation: string) {
  const resolved = createQueryEngine(compiled.ir).cable({
    by: "designation",
    value: designation,
  });
  if (!resolved.ok) throw new ArtifactError(resolved.error);
  return buildCableSchedule(compiled.ir, resolved.value.cable.uid);
}

export function semanticReview(compiled: Compiled, baseline: ProjectSnapshot) {
  return reviewProject(baseline, createProjectSnapshot(compiled.ir));
}
