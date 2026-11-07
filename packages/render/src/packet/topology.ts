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
import { bounds, zone } from "./page.js";
import { n, text, wrapReport, assemblyNoteLines } from "./svg.js";
import { communicationPartLines } from "./continuations.js";

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
    const compose = (
      drawing: CommunicationDrawing & { paginated?: boolean },
    ): RenderOutcome<Draft> => {
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
      const noteLines = drawing.note
        .split("\n")
        .flatMap((line) => wrapReport(line, Math.floor(b.w / 1.6)))
        .flatMap((line) => {
          if (!assembly && !drawing.pagination) return [line];
          const measured = assemblyNoteLines(line, b.w);
          // Preserve existing line breaks where their measured text fits.
          return measured.length > 1 ? measured : [line];
        });
      const noteHeight = (noteLines.length + partLines.length) * 3.5;
      let scale = Math.min(
        1,
        b.w / drawing.width,
        (b.h - headingHeight - 6) / drawing.height,
      );
      const reserveNotes =
        (assembly || !!drawing.pagination) &&
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
      if (scale < 2.5 / 2.7 || !Number.isFinite(scale))
        return failure(
          "unprintable-layout",
          reserveNotes && assembly
            ? "Connector assembly notes and diagram cannot fit at readable size. Shorten notes, select fewer assemblies or use larger paper."
            : wiring
              ? "Wiring view cannot fit at readable text size. Select fewer conductors or larger paper."
              : signalLoop
                ? "Signal loop cannot fit at readable text size. Use larger paper or another flow."
                : assembly
                  ? "Connector assembly view cannot fit at readable text size. Select fewer assemblies or larger paper; omitted ports remain identified."
                  : "Communication view cannot fit at readable text size. Select fewer devices or larger paper; boundary links will remain visible.",
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
          communicationHeight: height,
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
            note,
        },
      };
    };
    const drawings = wiring
      ? [await prepareWiringDrawing(ir, request)]
      : signalLoop
        ? [await prepareSignalLoopDrawing(ir, request)]
        : assembly
          ? await prepareConnectorAssemblyPages(
              ir,
              request,
              (d) => compose(d).ok,
            )
          : await prepareCommunicationPages(ir, request, (d) => compose(d).ok);
    const drafts: Draft[] = [];
    for (const drawing of drawings) {
      const result = compose(drawing);
      if (!result.ok) return result;
      drafts.push(result.value);
    }
    return { ok: true, value: drafts };
  } catch (e) {
    return failure(
      "unprintable-layout",
      e instanceof Error ? e.message : "Topology view failed.",
    );
  }
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
