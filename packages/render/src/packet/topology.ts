import { deviceTagFitDetails } from "./device-tag-fit.js";
import { CircuitRenderError } from "../render-error-context.js";
import { wrapText } from "../text-metrics.js";
import { prepareWiringDrawing, type WiringViewRequest } from "../wiring.js";
import { circuitTextLines } from "../circuit.js";
import {
  prepareCommunicationPages,
  type CommunicationViewRequest,
  type CommunicationDrawing,
} from "../communication.js";
import {
  prepareConnectorAssemblyPages,
  type ConnectorAssemblyViewRequest,
} from "../connector-assembly.js";
import {
  prepareSignalLoopDrawing,
  type SignalLoopViewRequest,
} from "../signal-loop.js";

import type {
  CompiledProjectPresentation,
  ElectricalIr,
} from "@thermite/compiler";

import type { SchematicTitleContext } from "../title-block.js";
import type { RenderOutcome } from "../types.js";

import type { Draft, PaperPage } from "./types.js";
import { failure } from "./errors.js";
import { topologySelectionContext } from "./selection-context.js";
import { bounds, zone } from "./page.js";
import { n, text, wrapReport, assemblyNoteLines } from "./svg.js";
import { communicationPartLines } from "./continuations.js";

type NotedDrawing = CommunicationDrawing & {
  paginated?: boolean;
  engineNotes?: readonly string[];
};
function topologyNoteLines(
  drawing: NotedDrawing,
  width: number,
  assembly: boolean,
) {
  return drawing.note
    .split("\n")
    .flatMap((line) =>
      drawing.engineNotes
        ? wrapText(line, width, 2.5)
        : wrapReport(line, Math.floor(width / 1.6)),
    )
    .flatMap((line) => {
      if (!assembly && !drawing.pagination) return [line];
      const measured = assemblyNoteLines(line, width);
      return measured.length > 1 ? measured : [line];
    });
}
function loopFitRefusal(
  page: PaperPage,
  request: { format: string; loopPower?: unknown },
) {
  const kind = request.loopPower ? "Series" : "Signal";
  const alternatives =
    page.size === "tabloid"
      ? "another orientation or flow, or fewer devices or shorter notes"
      : "another orientation or flow, larger paper, or fewer devices or shorter notes";
  return `${kind} loop notes and diagram cannot fit at readable size. Try ${alternatives}.`;
}
export async function topologyDrafts(
  ir: Readonly<ElectricalIr>,
  request:
    | CommunicationViewRequest
    | ConnectorAssemblyViewRequest
    | SignalLoopViewRequest
    | WiringViewRequest,
  presentation: CompiledProjectPresentation | undefined,
  page: PaperPage,
): Promise<RenderOutcome<Draft[]>> {
  try {
    const wiring = request.format === "wiring-view-request/0.1";
    const signalLoop = request.format === "signal-loop-view-request/0.1";
    const assembly = request.format === "connector-assembly-view-request/0.1";
    const compose = (drawing: NotedDrawing): RenderOutcome<Draft> => {
      const title = topologyTitle(
        ir.project.name,
        drawing.title,
        wiring,
        signalLoop,
        assembly,
        presentation,
      );
      const b = bounds(title, page);
      const headingLines = assembly
        ? circuitTextLines(drawing.title, b.w, 4)
        : [drawing.title];
      const headingHeight = 9 + (headingLines.length - 1) * 4.8;
      const partLines = communicationPartLines(drawing, b.w);
      const noteLines = topologyNoteLines(drawing, b.w, assembly);
      const noteHeight = (noteLines.length + partLines.length) * 3.5;
      let scale = Math.min(
        1,
        b.w / drawing.width,
        (b.h - headingHeight - 6) / drawing.height,
      );
      const reserveNotes =
        (assembly || !!drawing.pagination || !!drawing.engineNotes) &&
        headingHeight + drawing.height * scale + 4 + noteHeight > b.h;
      if (reserveNotes) {
        // Reserve notes before fitting; round down to the emitted SVG precision.
        scale =
          Math.floor(
            Math.min(
              scale,
              (b.h - headingHeight - 4 - noteHeight) / drawing.height,
            ) * 1000,
          ) / 1000;
      }
      const tagFit = topologyTagFit(
        drawing,
        b,
        headingHeight,
        reserveNotes ? 4 + noteHeight : 6,
      );
      if (scale < 2.5 / 2.7 || !Number.isFinite(scale))
        return topologyFitFailure(
          drawing,
          page,
          request,
          { wiring, signalLoop, assembly, reserveNotes },
          tagFit,
        );
      const x = b.x + (b.w - drawing.width * scale) / 2,
        y = b.y + headingHeight;
      const references = drawing.references.map((r) => ({
        deviceUid: r.deviceUid,
        designation: r.designation,
        functions: "functions" in r ? (r.functions as string[]) : [],
        zone: zone(x + r.x * scale, y + r.y * scale, b),
        xMm: x + r.x * scale,
        yMm: y + r.y * scale,
      }));
      const height = headingHeight + drawing.height * scale + 4 + noteHeight;
      if (height > b.h)
        return failure(
          "unprintable-layout",
          "Diagram notes exceed the sheet bounds.",
          { devices: drawing.references },
        );
      const note = noteLines
        .map((v, i) =>
          text(
            b.x,
            b.y + height - (partLines.length + noteLines.length - 1 - i) * 3.5,
            v,
            2.5,
          ),
        )
        .join("\n");
      return {
        ok: true,
        value: {
          view: {
            format: "documentation-view/0.1",
            kind: wiring
              ? "wiring"
              : signalLoop
                ? "signal-loop"
                : assembly
                  ? "connector-assembly"
                  : "communication",
            title: drawing.title,
          },
          title,
          drawingBounds: b,
          // Keep complete series notes with their view through compact packing.
          ...(drawing.engineNotes ? {} : { communicationHeight: height }),
          ...(drawing.pagination
            ? {
                communicationBlock: {
                  view: 0,
                  part: drawing.pagination.part,
                  x: b.x,
                  y: b.y + height - (partLines.length - 1) * 3.5,
                  width: b.w,
                  rows: drawing.pagination.devices.map((d) => ({
                    deviceUid: d.deviceUid,
                    label: d.designation,
                    targets: d.parts.map((part) => ({ part, sheet: part })),
                  })),
                },
              }
            : {}),
          references,
          ...(drawing.engineNotes
            ? { referenceNotes: drawing.engineNotes }
            : {}),
          links: [],
          note: wiring
            ? "Selected physical wiring - terminal details and other connections in schedules"
            : signalLoop
              ? "Field-device hookup - verify selected connector pinout before construction"
              : assembly
                ? drawing.paginated
                  ? "Protective caps - pin mapping not applicable; no inferred electrical continuity"
                  : "Connector assemblies only - unresolved pin mapping; no inferred electrical continuity"
                : "Port connections - see link schedule for protocol and status",
          coverage:
            "coverage" in drawing && drawing.coverage ? [drawing.coverage] : [],
          topologyCoverage: drawing.topologyCoverage
            ? [drawing.topologyCoverage]
            : [],
          content:
            headingLines
              .map((line, i) =>
                text(b.x, b.y + 3 + i * 4.8, line, 4, "start", 700),
              )
              .join("") +
            `<g transform="translate(${n(x)} ${n(y)}) scale(${n(scale)})">${drawing.content}</g>` +
            (drawing.engineNotes
              ? `<g data-engine-notes="true">${note}</g>`
              : note),
        },
      };
    };
    const fits = (drawing: NotedDrawing) => compose(drawing).ok;
    const unfit = topologyUnfit(compose);
    const drawings = wiring
      ? [await prepareWiringDrawing(ir, request)]
      : signalLoop
        ? [await prepareSignalLoopDrawing(ir, request)]
        : assembly
          ? await prepareConnectorAssemblyPages(ir, request, fits, unfit)
          : await prepareCommunicationPages(ir, request, fits, unfit);
    const drafts: Draft[] = [];
    for (const drawing of drawings) {
      const result = compose(drawing);
      if (!result.ok) return result;
      drafts.push(result.value);
    }
    return { ok: true, value: drafts };
  } catch (e) {
    return topologyFailure(ir, request, e);
  }
}

function topologyUnfit(
  compose: (drawing: NotedDrawing) => RenderOutcome<Draft>,
) {
  return (drawing: NotedDrawing, message: string) => {
    const result = compose(drawing);
    return result.ok || result.error.code !== "R006"
      ? new Error(message)
      : new CircuitRenderError({
          ...result.error,
          message: `${message} ${result.error.message}`,
        });
  };
}

function topologyFitFailure(
  drawing: NotedDrawing,
  page: PaperPage,
  request: { format: string; loopPower?: unknown },
  flags: {
    wiring: boolean;
    signalLoop: boolean;
    assembly: boolean;
    reserveNotes: boolean;
  },
  tagFit: ReturnType<typeof deviceTagFitDetails>,
) {
  const { wiring, signalLoop, assembly, reserveNotes } = flags;
  return failure(
    "unprintable-layout",
    (drawing.engineNotes
      ? loopFitRefusal(page, request)
      : reserveNotes && assembly
        ? "Connector assembly notes and diagram cannot fit at readable size. Shorten notes, select fewer assemblies or use larger paper."
        : wiring
          ? "Wiring view cannot fit at readable text size. Select fewer conductors or larger paper."
          : signalLoop
            ? "Signal loop cannot fit at readable text size. Use larger paper or another flow."
            : assembly
              ? "Connector assembly view cannot fit at readable text size. Select fewer assemblies or larger paper; omitted ports remain identified."
              : "Communication view cannot fit at readable text size. Select fewer devices or larger paper; boundary links will remain visible.") +
      tagFit.message,
    { devices: drawing.references, ...tagFit },
  );
}

function topologyTagFit(
  drawing: NotedDrawing,
  b: { w: number; h: number },
  heading: number,
  footer: number,
) {
  return deviceTagFitDetails(
    drawing,
    b.w / (2.5 / 2.7),
    (b.h - heading - footer) / (2.5 / 2.7),
  );
}

function topologyFailure(
  ir: Readonly<ElectricalIr>,
  request: unknown,
  error: unknown,
) {
  const fit = error instanceof CircuitRenderError ? error.error : undefined;
  return failure(
    "unprintable-layout",
    error instanceof Error ? error.message : "Topology view failed.",
    { ...topologySelectionContext(ir, request), ...fit?.details },
  );
}

function topologyTitle(
  projectName: string,
  drawingTitle: string,
  wiring: boolean,
  signalLoop: boolean,
  assembly: boolean,
  presentation: CompiledProjectPresentation | undefined,
): SchematicTitleContext {
  return {
    projectName: projectName,
    revision: presentation?.revision ?? "UNSPECIFIED",
    backgroundColor: "#ffffff",
    toolVersion: "0.3.0-alpha.2",
    lines: [
      {
        ownerKind: "view",
        ownerId: wiring
          ? "wiring"
          : signalLoop
            ? "signal-loop"
            : assembly
              ? "connector-assembly"
              : "communication",
        field: "title.view-line",
        value: drawingTitle,
      },
      ...(presentation?.titleBlockLines ?? []).map((value) => ({
        ownerKind: "presentation" as const,
        ownerId: "presentation",
        field: "title.authored-line" as const,
        value,
      })),
    ],
  };
}
