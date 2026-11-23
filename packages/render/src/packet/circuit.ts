import { headingCapacity } from "../internal/title-data/headings.js";
import { circuitTitleContext } from "./circuit-title.js";
import { circuitPartRows } from "./circuit-part-packing.js";
import { escapeXmlAttribute as attr } from "../svg/escape.js";
import { deviceTagFitDetails } from "./device-tag-fit.js";
import {
  circuitViewFootprint,
  circuitGroupFootprint,
} from "./circuit-footprint.js";
import { nextCircuitLayoutRun } from "../layout/circuit-inline.js";
import { recordPrintedCircuitDrawing } from "../layout/circuit-printed-layouts.js";
import { isInlineLabelFailure } from "../layout/inline-label-error.js";
import {
  CircuitRenderError,
  renderErrorContext,
} from "../render-error-context.js";
import {
  circuitTextLines,
  prepareCircuitView,
  paginateCircuitGroup,
  type CircuitDrawing,
  type CircuitViewRequest,
  type PreparedCircuitView,
} from "../circuit.js";

import type {
  CompiledProjectPresentation,
  ElectricalIr,
} from "@thermite/compiler";

import type { RenderOutcome } from "../types.js";

import type { Draft, PaperPage, DrawingBounds } from "./types.js";
import { failure, record } from "./errors.js";
import { bounds, zone } from "./page.js";
import {
  fieldTextLeft,
  fieldTextWidth,
  n,
  text,
  requestNoteText,
} from "./svg.js";
import { resolveCircuitContinuations } from "./continuations.js";

export async function circuitDrafts(
  ir: Readonly<ElectricalIr>,
  request: CircuitViewRequest,
  presentation: CompiledProjectPresentation | undefined,
  page: PaperPage,
  appearances?: Map<string, string[]>,
): Promise<RenderOutcome<Draft[]>> {
  const run = nextCircuitLayoutRun();
  try {
    return await circuitDraftsUnchecked(
      ir,
      request,
      presentation,
      page,
      appearances,
    );
  } catch (error) {
    if (
      run?.quality &&
      !isInlineLabelFailure(error) &&
      !(error instanceof CircuitRenderError)
    )
      throw error;
    if (error instanceof CircuitRenderError) {
      const { circuitGroups } = circuitSelectionContext(ir, request);
      return {
        ok: false,
        error: {
          ...renderErrorContext(ir, error.error),
          message: `${error.error.message} Selected circuit keys: ${circuitGroups.map((g) => `${g.groupId}: functions ${g.functionKeys.join(", ")}; conductors ${g.conductorKeys.join(", ") || "none"}`).join("; ")}.`,
          details: { ...error.error.details, circuitGroups },
        },
      };
    }
    return failure(
      "unprintable-layout",
      `${error instanceof Error ? error.message : "Circuit view failed."} Selected keys: ${request.groups.map((g) => `${g.id}: functions ${g.functions.map((f) => `${f.device.value}/${f.key}`).join(", ")}; conductors ${g.conductors.join(", ") || "none"}`).join("; ")}.`,
      circuitSelectionContext(ir, request),
    );
  }
}

function circuitCellRefs(
  group: {
    readonly references: readonly {
      readonly deviceUid: string;
      readonly designation: string;
      readonly functions: readonly string[];
      readonly x: number;
      readonly y: number;
    }[];
  },
  x: number,
  top: number,
  b: DrawingBounds,
) {
  return group.references.map((r) => ({
    deviceUid: r.deviceUid,
    designation: r.designation,
    functions: r.functions,
    xMm: x + r.x,
    yMm: top + r.y,
    zone: zone(x + r.x, top + r.y, b),
  }));
}

async function circuitDraftsUnchecked(
  ir: Readonly<ElectricalIr>,
  request: CircuitViewRequest,
  presentation: CompiledProjectPresentation | undefined,
  page: PaperPage,
  appearances?: Map<string, string[]>,
): Promise<RenderOutcome<Draft[]>> {
  const prepared = await prepareCircuitView(ir, request, appearances);
  const title = circuitTitleContext(ir, prepared, presentation);
  const capacity = headingCapacity(title, presentation);
  if (capacity) return capacity;
  const b = bounds(title, page);
  const notes = prepared.notes.flatMap((s) =>
    circuitTextLines(s, fieldTextWidth(b.w)),
  );
  const { headingLines, headerHeight, available } = circuitViewFootprint(
    prepared.title,
    b.w,
    b.h,
  );
  if (available < 35)
    return failure(
      "unprintable-layout",
      "Circuit notes leave insufficient readable drawing space.",
    );
  const columnWidth = (b.w - 8 * (prepared.columns - 1)) / prepared.columns;
  const drafts: Draft[] = [];
  let column = 0,
    cursors = [0, 0];
  const newDraft = (): Draft => ({
    view: {
      format: "documentation-view/0.1",
      kind: "circuit",
      title: prepared.title,
    },
    title,
    drawingBounds: b,
    references: [],
    links: [],
    note: "Source-selected circuits · [+N]: connections outside group",
    coverage: [],
    content: headingLines
      .map((s, i) =>
        text(fieldTextLeft(b.x), b.y + 3.5 + i * 4.5, s, 3.5, "start", 700),
      )
      .join(""),
  });
  drafts.push(newDraft());
  const fits = (group: CircuitDrawing) => {
    const width = group.width > columnWidth + 0.001 ? b.w : columnWidth;
    return (
      group.width <= width + 0.001 &&
      circuitGroupFootprint(group, width).height <= available
    );
  };
  const groups: CircuitDrawing[] = [];
  for (const [index, group] of prepared.groups.entries())
    groups.push(
      ...(await paginateCircuitGroup(
        ir,
        request,
        index,
        group,
        fits,
        appearances,
        { ...b, h: available },
      )),
    );
  const rows = circuitPartRows(groups, {
    flow: request.flow,
    columns: prepared.columns,
    authoredGroups: request.groups.length,
    columnWidth,
    fieldWidth: b.w,
    available,
    noteLines: notes.length,
  });
  for (const row of rows) {
    const spanning = row.width > columnWidth + 0.001;
    const height = row.height;
    for (const { group, width } of row.cells) {
      if (group.width > width + 0.001)
        return failure(
          "unprintable-layout",
          `Circuit ${group.id} needs ${n(group.width)} mm at readable size; select a narrower circuit group, another flow, or larger paper.${deviceTagFitDetails(group, width, available).message}`,
          {
            groupId: group.id,
            devices: group.references,
            ...deviceTagFitDetails(group, width, available),
          },
        );
      const { height } = circuitGroupFootprint(group, width);
      if (height > available)
        return failure(
          "unprintable-layout",
          `Circuit ${group.id} cannot fit as a complete group at readable size. Split its source selection into smaller circuit or channel groups.${deviceTagFitDetails(group, width, available).message}`,
          {
            groupId: group.id,
            devices: group.references,
            ...deviceTagFitDetails(group, width, available),
          },
        );
    }
    let offset = spanning ? Math.max(...cursors) : cursors[column]!;
    if (offset + height > available) {
      if (
        !spanning &&
        column + 1 < prepared.columns &&
        cursors[column + 1]! + height <= available
      )
        column++;
      else {
        drafts.push(newDraft());
        column = 0;
        cursors = [0, 0];
      }
      offset = spanning ? Math.max(...cursors) : cursors[column]!;
    }
    const draft = drafts.at(-1)!;
    const rowX = b.x + (spanning ? 0 : column * (columnWidth + 8));
    const y = b.y + headerHeight + offset;
    for (const { group, width, x: dx } of row.cells) {
      const x =
        rowX +
        dx +
        circuitPeerLeftMargin(request.flow, row.cells.length, group, width);
      const { headings, headHeight } = circuitGroupFootprint(group, width);
      if (group.diagnostics?.length)
        (draft.diagnostics ??= []).push(...group.diagnostics);
      draft.coverage!.push({
        kind: "circuit",
        group: group.id,
        conductorIds: [...group.coverage.conductorIds],
        functionIds: [...group.coverage.functionIds],
      });
      draft.content +=
        headings
          .map((s, i) =>
            groupHeading(fieldTextLeft(x), y + 2.7 + i * 3.5, s, group.id),
          )
          .join("") +
        `<g transform="translate(${n(x)} ${n(y + headHeight)})">${group.content}</g>`;
      recordPrintedCircuitDrawing(group);
      if (group.pagination) {
        draft.note =
          "Circuit parts · [+N]: outside part · P/S: repeated physical terminal · full wires retained";
        (draft.circuitParts ??= []).push({
          drawing: group,
          x: fieldTextLeft(x),
          y: y + headHeight + group.height + 4,
          width: fieldTextWidth(width),
        });
      }
      draft.references!.push(...circuitCellRefs(group, x, y + headHeight, b));
    }
    if (spanning) {
      cursors = [offset + height, offset + height];
      column = 0;
    } else cursors[column] = offset + height;
  }
  if (notes.length) {
    const noted = appendCircuitNotes(
      drafts,
      prepared,
      { b, columnWidth, headerHeight, cursors, available, gap: 8 },
      notes,
      newDraft,
    );
    if (!noted.ok) return noted;
  }
  resolveCircuitContinuations(drafts, request.flow === "top-to-bottom");
  return { ok: true, value: drafts };
}

function circuitPeerLeftMargin(
  flow: CircuitViewRequest["flow"],
  cellCount: number,
  group: CircuitDrawing,
  width: number,
) {
  return flow !== "top-to-bottom" &&
    cellCount === 1 &&
    group.coverage.conductorIds.length === 0 &&
    group.content.includes("data-outside-connections=") &&
    width > group.width
    ? Math.min(44, width - group.width)
    : 0;
}

export function circuitSelectionContext(
  ir: Readonly<ElectricalIr>,
  request: CircuitViewRequest,
) {
  return {
    circuitGroups: (Array.isArray(request.groups) ? request.groups : [])
      .filter(record)
      .map((g) => {
        const functions = (
          Array.isArray(g.functions) ? g.functions : []
        ).filter(
          (f) =>
            record(f) && record(f.device) && typeof f.device.value === "string",
        );
        return {
          groupId: g.id,
          functionKeys: functions.map((f) => `${f.device.value}/${f.key}`),
          functionDisplayKeys: functions.map(
            (f) => `${circuitDeviceName(ir, f.device)}/${f.key}`,
          ),
          conductorKeys: Array.isArray(g.conductors) ? g.conductors : [],
        };
      }),
  };
}

function circuitDeviceName(
  ir: Readonly<ElectricalIr>,
  selector: CircuitViewRequest["groups"][number]["functions"][number]["device"],
): string {
  return (
    (selector.by === "uid"
      ? ir.devices.find((d) => d.uid === selector.value)?.designation
      : undefined) ?? selector.value
  );
}

function appendCircuitNotes(
  drafts: Draft[],
  prepared: Pick<PreparedCircuitView, "notes" | "columns">,
  layout: CircuitNoteLayout,
  notes: string[],
  newDraft: () => Draft,
): RenderOutcome<void> {
  const { b, columnWidth, headerHeight, cursors, available, gap } = layout;
  let printedNotes = notes,
    noteColumn = 0,
    noteOffset = Math.max(...cursors),
    noteHeight = 5 + notes.length * 3.5;
  if (noteOffset + noteHeight > available && prepared.columns === 2) {
    const narrow = prepared.notes.flatMap((s) =>
      circuitTextLines(s, fieldTextWidth(columnWidth)),
    );
    if (cursors[1]! + 5 + narrow.length * 3.5 <= available) {
      printedNotes = narrow;
      noteColumn = 1;
      noteOffset = cursors[1]!;
      noteHeight = 5 + narrow.length * 3.5;
    }
  }
  if (noteHeight > available)
    return failure(
      "unprintable-layout",
      "Circuit notes cannot fit at readable size; shorten the notes or use larger paper.",
    );
  if (noteOffset + noteHeight > available) {
    drafts.push(newDraft());
    noteColumn = 0;
    noteOffset = 0;
  }
  const x = fieldTextLeft(b.x + noteColumn * (columnWidth + gap)),
    y = b.y + headerHeight + noteOffset;
  drafts.at(-1)!.content +=
    text(x, y + 3, "View notes", 2.7, "start", 700) +
    printedNotes
      .map((s, i) => requestNoteText(x, y + 7 + i * 3.5, s, 2.5))
      .join("");
  return { ok: true, value: undefined };
}

interface CircuitNoteLayout {
  b: DrawingBounds;
  columnWidth: number;
  headerHeight: number;
  cursors: readonly number[];
  available: number;
  gap: number;
}

function groupHeading(x: number, y: number, label: string, id: string): string {
  return text(x, y, label, 2.7, "start", 700).replace(
    "<text ",
    `<text data-circuit-source-heading="${attr(id)}" `,
  );
}
