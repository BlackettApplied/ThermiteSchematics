import { THERMITE_RELEASE_VERSION } from "@thermite/schema";
import {
  plannedTitleContext,
  headingCapacity,
} from "../internal/title-data/headings.js";
import { deviceTagFitDetails } from "./device-tag-fit.js";
import { escapeXmlAttribute as attr } from "../svg/escape.js";
import { CircuitRenderError } from "../render-error-context.js";
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
import {
  fieldTextLeft,
  fieldTextRightExtent,
  n,
  text,
  requestNoteText,
  wrapFieldText,
} from "./svg.js";
import {
  communicationPartBlock,
  communicationPortSelection,
} from "./native-part-labels.js";
import { communicationPartLines } from "./continuations.js";

type NotedDrawing = CommunicationDrawing & {
  paginated?: boolean;
  engineNotes?: readonly string[];
};
function topologyNoteLines(
  drawing: NotedDrawing,
  width: number,
  request: { format: string; notes?: readonly string[] },
) {
  const authoredNotes = request.notes ?? [];
  // Preparers append request.notes verbatim. Resolve that trailing source span,
  // rather than exempting every occurrence of matching text in generated notes.
  const suffix = "\n" + authoredNotes.join("\n");
  const authoredStart =
    authoredNotes.length && drawing.note.endsWith(suffix)
      ? drawing.note.length - suffix.length + 1
      : Infinity;
  let offset = 0;
  return drawing.note.split("\n").flatMap((line) => {
    const authored = offset >= authoredStart;
    offset += line.length + 1;
    const split = (value: string) => wrapFieldText(value, width, 2.5);
    const replacement =
      !authored && drawing.documentNeeds?.length
        ? line
            .replace("; see wire schedule.", ".")
            .replace(
              "see communication schedule for status and unconnected ports.",
              "Other port details may be outside this view.",
            )
            .replace(
              "core details remain in the conductor view.",
              "other core details are outside this view.",
            )
        : line;
    const changed = replacement !== line ? split(replacement) : undefined;
    return split(line).map((text, i) => ({
      text,
      authored,
      ...(changed ? { replacement: changed[i] ?? "" } : {}),
    }));
  });
}
function topologyNoteSvg(
  v: { authored: boolean; text: string; replacement?: string },
  x: number,
  y: number,
) {
  return (v.authored ? requestNoteText : text)(x, y, v.text, 2.5).replace(
    "<text ",
    v.replacement === undefined
      ? "<text "
      : `<text data-document-note-replacement="${attr(v.replacement)}" `,
  );
}
function topologyHeadingSvg(lines: readonly string[], x: number, y: number) {
  return lines
    .map((line, i) =>
      text(
        fieldTextLeft(x, line, 4, true),
        y + 3 + i * 4.8,
        line,
        4,
        "start",
        700,
      ),
    )
    .join("");
}
function topologyTextLayout(
  drawing: NotedDrawing,
  b: ReturnType<typeof bounds>,
  request: { format: string; notes?: readonly string[] },
  ports: ReturnType<ReturnType<typeof communicationPortSelection>>,
) {
  const headingLines = circuitTextLines(drawing.title, b.w, 4, (line, size) =>
    fieldTextRightExtent(line, size, true),
  );
  const partLines = communicationPartLines(drawing, b.w, ports);
  const noteLines = topologyNoteLines(drawing, b.w, request);
  return {
    headingLines,
    headingHeight: 9 + (headingLines.length - 1) * 4.8,
    partLines,
    noteLines,
    noteHeight: (noteLines.length + partLines.length) * 3.5,
  };
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
    const selectedPorts = communicationPortSelection();
    const compose = (
      drawing: NotedDrawing,
      observeScale?: (scale: number) => void,
    ): RenderOutcome<Draft> => {
      const title = topologyTitle(
        ir.project.name,
        drawing.title,
        wiring,
        signalLoop,
        assembly,
        presentation,
      );
      const capacity = headingCapacity(title, presentation);
      if (capacity) return capacity;
      const b = bounds(title, page);
      const t = topologyTextLayout(drawing, b, request, selectedPorts(drawing));
      const { scale, reserveNotes } = topologyScale(
        drawing,
        b,
        t.headingHeight,
        t.noteHeight,
        assembly || !!drawing.pagination || !!drawing.engineNotes,
      );
      const tagFit = topologyTagFit(
        drawing,
        b,
        t.headingHeight,
        reserveNotes ? 4 + t.noteHeight : 6,
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
        y = b.y + t.headingHeight;
      const references = drawing.references.map((r) => ({
        deviceUid: r.deviceUid,
        designation: r.designation,
        functions: "functions" in r ? (r.functions as string[]) : [],
        zone: zone(x + r.x * scale, y + r.y * scale, b),
        xMm: x + r.x * scale,
        yMm: y + r.y * scale,
      }));
      const height =
        t.headingHeight + drawing.height * scale + 4 + t.noteHeight;
      if (height > b.h)
        return failure(
          "unprintable-layout",
          "Diagram notes exceed the sheet bounds.",
          { devices: drawing.references },
        );
      const note = t.noteLines
        .map((v, i) =>
          topologyNoteSvg(
            v,
            fieldTextLeft(b.x, v.text, 2.5),
            b.y +
              height -
              (t.partLines.length + t.noteLines.length - 1 - i) * 3.5,
          ),
        )
        .join("\n");
      observeScale?.(Number(n(scale)));
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
          documentNeeds: drawing.documentNeeds ?? [],
          drawingBounds: b,
          // Keep complete series notes with their view through compact packing.
          ...(drawing.engineNotes ? {} : { communicationHeight: height }),
          ...(drawing.pagination
            ? {
                communicationBlock: communicationPartBlock(
                  drawing,
                  b,
                  height,
                  t.partLines.length,
                  selectedPorts(drawing),
                ),
              }
            : {}),
          references,
          ...(drawing.engineNotes
            ? { referenceNotes: drawing.engineNotes }
            : {}),
          links: [],
          note: wiring
            ? "Selected physical wiring - device internals are not shown"
            : signalLoop
              ? "Field-device hookup - verify selected connector pinout before construction"
              : assembly
                ? drawing.paginated
                  ? "Protective caps - pin mapping not applicable; no inferred electrical continuity"
                  : "Connector assemblies only - unresolved pin mapping; no inferred electrical continuity"
                : "Selected port connections - diagram is partial",
          coverage:
            "coverage" in drawing && drawing.coverage ? [drawing.coverage] : [],
          topologyCoverage: drawing.topologyCoverage
            ? [drawing.topologyCoverage]
            : [],
          content:
            topologyHeadingSvg(t.headingLines, b.x, b.y) +
            `<g transform="translate(${n(x)} ${n(y)}) scale(${n(scale)})">${drawing.content}</g>` +
            (drawing.engineNotes
              ? `<g data-engine-notes="true">${note}</g>`
              : note),
        },
      };
    };
    const fits = topologyFits(compose);
    const unfit = topologyUnfit(compose);
    const stagger = topologyStaggerGuard(compose);
    const drawings = wiring
      ? [await prepareWiringDrawing(ir, request, fits.wiring)]
      : signalLoop
        ? [await prepareSignalLoopDrawing(ir, request, stagger.accept)]
        : assembly
          ? await prepareConnectorAssemblyPages(ir, request, fits, unfit)
          : await prepareCommunicationPages(ir, request, fits, unfit);
    const drafts: Draft[] = [];
    for (const drawing of drawings) {
      const result = signalLoop ? stagger.compose(drawing) : compose(drawing);
      if (!result.ok) return result;
      drafts.push(result.value);
    }
    return { ok: true, value: drafts };
  } catch (e) {
    return topologyFailure(ir, request, e);
  }
}

function topologyFits(
  compose: (
    drawing: NotedDrawing,
    observeScale?: (scale: number) => void,
  ) => RenderOutcome<Draft>,
) {
  const ordinary = (drawing: NotedDrawing) => compose(drawing).ok;
  return Object.assign(ordinary, {
    wiring: (
      candidate: CommunicationDrawing,
      original: CommunicationDrawing,
    ) => {
      let beforeScale = 0,
        afterScale = 0;
      const before = compose(original, (s) => {
        beforeScale = s;
      });
      const after = compose(candidate, (s) => {
        afterScale = s;
      });
      return after.ok && (!before.ok || afterScale >= beforeScale);
    },
  });
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
  return plannedTitleContext(
    {
      projectName: projectName,
      revision: presentation?.revision ?? "UNSPECIFIED",
      backgroundColor: "#ffffff",
      toolVersion: THERMITE_RELEASE_VERSION,
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
    },
    presentation,
  );
}

function topologyScale(
  drawing: NotedDrawing,
  b: { w: number; h: number },
  headingHeight: number,
  noteHeight: number,
  canReserveNotes: boolean,
) {
  let scale = Math.min(
    1,
    b.w / drawing.width,
    (b.h - headingHeight - 6) / drawing.height,
  );
  const reserveNotes =
    canReserveNotes &&
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
  return { scale, reserveNotes };
}

/** Use the full composer, including notes and readable-size refusals. Compare
 * the same three-decimal scale that is emitted, without a width tolerance. */
function topologyStaggerGuard(
  compose: (
    drawing: NotedDrawing,
    observeScale?: (scale: number) => void,
  ) => RenderOutcome<Draft>,
) {
  let native:
    | {
        drawing: NotedDrawing | undefined;
        outcome: RenderOutcome<Draft> | undefined;
        scale: number;
      }
    | undefined;
  let accepted:
    { drawing: NotedDrawing; outcome: RenderOutcome<Draft> } | undefined;
  return {
    accept(candidate: NotedDrawing, fallback: NotedDrawing | undefined) {
      if (!native) {
        let scale = 0;
        const outcome = fallback
          ? compose(fallback, (value) => {
              scale = value;
            })
          : undefined;
        native = { drawing: fallback, outcome, scale };
      }
      let afterScale = 0;
      const after = compose(candidate, (scale) => {
        afterScale = scale;
      });
      const allows =
        after.ok && (!native.outcome?.ok || afterScale >= native.scale);
      if (allows) accepted = { drawing: candidate, outcome: after };
      return allows;
    },
    compose(drawing: NotedDrawing) {
      if (native?.drawing === drawing && native.outcome) return native.outcome;
      if (accepted?.drawing === drawing) return accepted.outcome;
      return compose(drawing);
    },
  };
}
