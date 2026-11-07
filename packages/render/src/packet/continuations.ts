import type { Draft, DrawingBounds } from "./types.js";
import type { PresentationEdge, LayoutEdge, RenderOutcome } from "../types.js";
import { OUTER_SVG_PADDING } from "../symbols/catalog.js";
import { failure } from "./errors.js";

import { circuitTextLines, type CircuitDrawing } from "../circuit.js";
import type { CommunicationDrawing } from "../communication.js";

import { escapeXmlAttribute as attr } from "../svg/escape.js";

import type {
  CommunicationContinuationBlock,
  CircuitContinuationBlock,
} from "./types.js";
import { assemblyNoteLines, text } from "./svg.js";

const communicationPartNotice =
  "Whole port links; repeated bodies describe the same device with other ports. P = view part, S = packet sheet.";
function communicationReferenceLines(
  label: string,
  targets: readonly { part: number; sheet: number }[],
  width: number,
): string[] {
  return assemblyNoteLines(
    `${label} -> ${targets.map((t) => `P${t.part}/S${String(t.sheet).padStart(2, "0")}`).join(", ")}`,
    width,
  );
}
export function communicationPartLines(
  drawing: CommunicationDrawing,
  width: number,
): string[] {
  if (!drawing.pagination) return [];
  return [
    ...assemblyNoteLines(communicationPartNotice, width),
    ...drawing.pagination.devices.flatMap((d) =>
      communicationReferenceLines(
        d.designation,
        d.parts.map((part) => ({ part, sheet: 100 })),
        width,
      ),
    ),
  ];
}
export function emitCommunicationContinuationBlock(
  block: CommunicationContinuationBlock,
): string {
  let y = block.y;
  const out = assemblyNoteLines(communicationPartNotice, block.width).map(
    (s) => {
      const row = text(block.x, y, s, 2.5);
      y += 3.5;
      return row;
    },
  );
  for (const row of block.rows) {
    out.push(
      `<g data-communication-continuation-device="${attr(row.deviceUid)}" data-communication-view="${block.view}" data-from-part="${block.part}" data-destination-parts="${attr(JSON.stringify(row.targets.map((t) => t.part)))}" data-destination-sheets="${attr(JSON.stringify(row.targets.map((t) => t.sheet)))}">`,
    );
    for (const s of communicationReferenceLines(
      row.label,
      row.targets,
      block.width,
    )) {
      out.push(text(block.x, y, s, 2.5));
      y += 3.5;
    }
    out.push("</g>");
  }
  return out.join("");
}
const circuitPartNotice =
  "Whole wires; repeated symbols and terminal IDs describe the same physical equipment. P = group part, S = packet sheet.";
function circuitContinuationLines(
  label: string,
  parts: readonly number[],
  sheets: readonly number[],
  width: number,
): string[] {
  return circuitTextLines(
    `${label} -> ${parts.map((part, i) => `P${part}/S${String(sheets[i] ?? 100).padStart(2, "0")}`).join(", ")}`,
    width,
  );
}
export function circuitPartHeight(
  group: CircuitDrawing,
  width: number,
): number {
  if (!group.pagination) return 0;
  const lines =
    circuitTextLines(circuitPartNotice, width).length +
    group.pagination.terminals.reduce(
      (count, t) =>
        count + circuitContinuationLines(t.label, t.parts, [], width).length,
      0,
    );
  return 4 + lines * 3.5;
}
export function emitCircuitContinuationBlock(
  block: CircuitContinuationBlock,
): string {
  let y = block.y;
  const out = circuitTextLines(circuitPartNotice, block.width).map((s) => {
    const row = text(block.x, y, s, 2.5);
    y += 3.5;
    return row;
  });
  for (const row of block.rows) {
    out.push(
      `<g data-circuit-continuation="${attr(block.group)}" data-from-part="${block.part}" data-continuation-terminal="${attr(row.id)}" data-destination-parts="${attr(JSON.stringify(row.targets.map((t) => t.part)))}" data-destination-sheets="${attr(JSON.stringify(row.targets.map((t) => t.sheet)))}">`,
    );
    for (const s of circuitContinuationLines(
      row.label,
      row.targets.map((t) => t.part),
      row.targets.map((t) => t.sheet),
      block.width,
    )) {
      out.push(text(block.x, y, s, 2.5));
      y += 3.5;
    }
    out.push("</g>");
  }
  return out.join("");
}

/** Find crossings of rooted viewports and add reciprocal physical conductor links. */
export function drawingContinuations(
  drafts: Draft[],
  graph: {
    readonly edges: readonly Pick<
      PresentationEdge,
      "id" | "label" | "netLabel"
    >[];
  },
  layout: {
    readonly edges: readonly Pick<LayoutEdge, "id" | "points" | "netId">[];
  },
  xs: readonly number[],
  ys: readonly number[],
  b: DrawingBounds,
  scale: number,
): RenderOutcome<void> {
  const pad = OUTER_SVG_PADDING,
    nx = xs.length - 1,
    ny = ys.length - 1;
  let serial = 0;
  for (const edge of layout.edges) {
    const semantic = graph.edges.find(({ id }) => id === edge.id)!;
    const conductor =
      semantic.label?.text ?? semantic.netLabel?.text ?? edge.netId;
    for (let j = 1; j < edge.points.length; j++) {
      const p = edge.points[j - 1]!,
        q = edge.points[j]!;
      for (let col = 1; col < nx; col++) {
        const x = xs[col]! - pad;
        if (p.y !== q.y || x <= Math.min(p.x, q.x) || x >= Math.max(p.x, q.x))
          continue;
        const row = ys.findIndex(
          (start, index) =>
            index < ny && p.y + pad >= start && p.y + pad < ys[index + 1]!,
        );
        if (row < 0) continue;
        const left = row * nx + col - 1,
          right = left + 1,
          id = `C${String(++serial).padStart(3, "0")}`;
        const y = b.y + (p.y + pad - ys[row]!) * scale;
        drafts[left]!.links.push({
          id,
          conductor,
          netId: edge.netId,
          to: right + 1,
          x: b.x + (xs[col]! - xs[col - 1]!) * scale,
          y,
          side: "right",
        });
        drafts[right]!.links.push({
          id,
          conductor,
          netId: edge.netId,
          to: left + 1,
          x: b.x,
          y,
          side: "left",
        });
      }
      for (let row = 1; row < ny; row++) {
        const y = ys[row]! - pad;
        if (p.x !== q.x || y <= Math.min(p.y, q.y) || y >= Math.max(p.y, q.y))
          continue;
        const col = xs.findIndex(
          (start, index) =>
            index < nx && p.x + pad >= start && p.x + pad < xs[index + 1]!,
        );
        if (col < 0) continue;
        const top = (row - 1) * nx + col,
          bottom = top + nx,
          id = `C${String(++serial).padStart(3, "0")}`;
        const x = b.x + (p.x + pad - xs[col]!) * scale;
        drafts[top]!.links.push({
          id,
          conductor,
          netId: edge.netId,
          to: bottom + 1,
          x,
          y: b.y + (ys[row]! - ys[row - 1]!) * scale,
          side: "bottom",
        });
        drafts[bottom]!.links.push({
          id,
          conductor,
          netId: edge.netId,
          to: top + 1,
          x,
          y: b.y,
          side: "top",
        });
      }
    }
  }
  for (const draft of drafts)
    for (let i = 0; i < draft.links.length; i++)
      for (const other of draft.links.slice(i + 1)) {
        const link = draft.links[i]!;
        if (
          link.side === other.side &&
          (link.side === "left" || link.side === "right"
            ? Math.abs(link.y - other.y) < 3
            : Math.abs(link.x - other.x) < 18)
        )
          return failure(
            "unprintable-layout",
            "Continuation labels are too close to print clearly. Change flow, use a larger sheet, or narrow the view.",
          );
      }
  return { ok: true, value: undefined };
}

export function resolveCircuitContinuations(drafts: Draft[]): void {
  for (const draft of drafts)
    draft.circuitBlocks = (draft.circuitParts ?? []).map(
      ({ drawing, x, y, width }) => ({
        group: drawing.id,
        part: drawing.pagination!.part,
        x,
        y,
        width,
        rows: drawing.pagination!.terminals.map((t) => ({
          id: t.id,
          label: t.label,
          targets: t.parts.map((part) => {
            const sheet = drafts.findIndex((d) =>
              d.circuitParts?.some(
                (p) =>
                  p.drawing.id === drawing.id &&
                  p.drawing.pagination!.part === part,
              ),
            );
            if (sheet < 0)
              throw new Error("Circuit continuation destination is missing.");
            return { part, sheet: sheet + 1 };
          }),
        })),
      }),
    );
}
