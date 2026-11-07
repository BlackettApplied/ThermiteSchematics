import { CircuitRenderError } from "../render-error-context.js";
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

import type { SchematicTitleContext } from "../title-block.js";
import type { RenderOutcome } from "../types.js";

import type { Draft, PaperPage, DrawingBounds } from "./types.js";
import { failure } from "./errors.js";
import { bounds, zone } from "./page.js";
import { n, text } from "./svg.js";
import {
  circuitPartHeight,
  resolveCircuitContinuations,
} from "./continuations.js";

export async function circuitDrafts(
  ir: Readonly<ElectricalIr>,
  request: CircuitViewRequest,
  presentation: CompiledProjectPresentation | undefined,
  page: PaperPage,
  appearances?: Map<string, string[]>,
): Promise<RenderOutcome<Draft[]>> {
  try {
    const prepared = await prepareCircuitView(ir, request, appearances);
    const title: SchematicTitleContext = {
      projectName: ir.project.name,
      revision: presentation?.revision ?? "UNSPECIFIED",
      backgroundColor: "#ffffff",
      toolVersion: "0.3.0-alpha.2",
      lines: [
        {
          ownerKind: "view",
          ownerId: "circuit",
          field: "title.view-line",
          value: prepared.title,
        },
        ...(presentation?.titleBlockLines ?? []).map((value) => ({
          ownerKind: "presentation" as const,
          ownerId: "presentation",
          field: "title.authored-line" as const,
          value,
        })),
      ],
    };
    const b = bounds(title, page);
    const notes = prepared.notes.flatMap((s) => circuitTextLines(s, b.w));
    const headingLines = circuitTextLines(prepared.title, b.w, 3.5),
      headerHeight = headingLines.length * 4.5 + 3;
    const available = b.h - headerHeight - 1;
    if (available < 35)
      return failure(
        "unprintable-layout",
        "Circuit notes leave insufficient readable drawing space.",
      );
    const gap = 8,
      columnWidth = (b.w - gap * (prepared.columns - 1)) / prepared.columns;
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
      note: "Source-selected circuits · [+N]: connections outside group · device/function references in index",
      coverage: [],
      content: headingLines
        .map((s, i) => text(b.x, b.y + 3.5 + i * 4.5, s, 3.5, "start", 700))
        .join(""),
    });
    drafts.push(newDraft());
    const fits = (group: CircuitDrawing) => {
      const width = group.width > columnWidth + 0.001 ? b.w : columnWidth;
      const heading = [
        group.lineReference ? `Ref. ${group.lineReference}` : undefined,
        group.label,
      ]
        .filter(Boolean)
        .join(" · ");
      return (
        group.width <= width + 0.001 &&
        circuitTextLines(heading, width, 2.7).length * 3.5 +
          1 +
          group.height +
          circuitPartHeight(group, width) +
          3 <=
          available
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
        )),
      );
    for (const group of groups) {
      const spanning = group.width > columnWidth + 0.001;
      const width = spanning ? b.w : columnWidth;
      if (group.width > width + 0.001)
        return failure(
          "unprintable-layout",
          `Circuit ${group.id} needs ${n(group.width)} mm at readable size; select a narrower circuit group, another flow, or larger paper.`,
        );
      const heading = [
        group.lineReference ? `Ref. ${group.lineReference}` : undefined,
        group.label,
      ]
        .filter(Boolean)
        .join(" · ");
      const headings = circuitTextLines(heading, width, 2.7);
      const headHeight = headings.length * 3.5 + 1;
      const height =
        headHeight + group.height + circuitPartHeight(group, width) + 3;
      if (height > available)
        return failure(
          "unprintable-layout",
          `Circuit ${group.id} cannot fit as a complete group at readable size. Split its source selection into smaller circuit or channel groups.`,
        );
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
      if (group.diagnostics?.length)
        (draft.diagnostics ??= []).push(...group.diagnostics);
      draft.coverage!.push({
        kind: "circuit",
        group: group.id,
        conductorIds: [...group.coverage.conductorIds],
        functionIds: [...group.coverage.functionIds],
      });
      const x = b.x + (spanning ? 0 : column * (columnWidth + gap)),
        y = b.y + headerHeight + offset;
      draft.content +=
        headings
          .map((s, i) => text(x, y + 2.7 + i * 3.5, s, 2.7, "start", 700))
          .join("") +
        `<g transform="translate(${n(x)} ${n(y + headHeight)})">${group.content}</g>`;
      if (group.pagination) {
        draft.note =
          "Circuit parts · [+N]: outside part · P/S: repeated physical terminal · full wires retained";
        (draft.circuitParts ??= []).push({
          drawing: group,
          x,
          y: y + headHeight + group.height + 4,
          width,
        });
      }
      draft.references!.push(
        ...group.references.map((r) => ({
          deviceUid: r.deviceUid,
          designation: r.designation,
          functions: r.functions,
          xMm: x + r.x,
          yMm: y + headHeight + r.y,
          zone: zone(x + r.x, y + headHeight + r.y, b),
        })),
      );
      if (spanning) {
        cursors = [offset + height, offset + height];
        column = 0;
      } else cursors[column] = offset + height;
    }
    if (notes.length) {
      const noted = appendCircuitNotes(
        drafts,
        prepared,
        { b, columnWidth, headerHeight, cursors, available, gap },
        notes,
        newDraft,
      );
      if (!noted.ok) return noted;
    }
    resolveCircuitContinuations(drafts);
    return { ok: true, value: drafts };
  } catch (error) {
    if (error instanceof CircuitRenderError) {
      const circuitGroups = request.groups.map((g) => ({
        groupId: g.id,
        functionKeys: g.functions.map((f) => `${f.device.value}/${f.key}`),
        conductorKeys: g.conductors,
      }));
      return {
        ok: false,
        error: {
          ...error.error,
          message: `${error.error.message} Selected circuit keys: ${circuitGroups.map((g) => `${g.groupId}: functions ${g.functionKeys.join(", ")}; conductors ${g.conductorKeys.join(", ") || "none"}`).join("; ")}.`,
          details: { ...error.error.details, circuitGroups },
        },
      };
    }
    return failure(
      "unprintable-layout",
      `${error instanceof Error ? error.message : "Circuit view failed."} Selected keys: ${request.groups.map((g) => `${g.id}: functions ${g.functions.map((f) => `${f.device.value}/${f.key}`).join(", ")}; conductors ${g.conductors.join(", ") || "none"}`).join("; ")}.`,
      {
        circuitGroups: request.groups.map((g) => ({
          groupId: g.id,
          functionKeys: g.functions.map((f) => `${f.device.value}/${f.key}`),
          conductorKeys: g.conductors,
        })),
      },
    );
  }
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
      circuitTextLines(s, columnWidth),
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
  const x = b.x + noteColumn * (columnWidth + gap),
    y = b.y + headerHeight + noteOffset;
  drafts.at(-1)!.content +=
    text(x, y + 3, "View notes", 2.7, "start", 700) +
    printedNotes.map((s, i) => text(x, y + 7 + i * 3.5, s, 2.5)).join("");
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
