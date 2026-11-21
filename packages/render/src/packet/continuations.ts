import { wrapText } from "../text-metrics.js";
import {
  communicationPartRows,
  communicationRowLayout,
  nativePartToken,
} from "./native-part-labels.js";
import { required } from "../presentation/util.js";
import type { PortIdentity } from "../topology-coverage.js";
import type { NativePartTarget } from "./types.js";
import type { Draft } from "./types.js";

import { circuitTextLines, type CircuitDrawing } from "../circuit.js";
import type { CommunicationDrawing } from "../communication.js";

import { escapeXmlAttribute as attr } from "../svg/escape.js";

import type {
  CommunicationContinuationBlock,
  CircuitContinuationBlock,
} from "./types.js";
import { text } from "./svg.js";

const communicationPartNotice =
  "Whole port links; repeated bodies describe the same device with other ports. P = view part, S = packet sheet.";
function communicationReferenceLines(
  label: string,
  targets: readonly NativePartTarget[],
  width: number,
): string[] {
  return wrapText(
    `${label} -> ${targets.map(nativePartToken).join(", ")}`,
    width,
    2.5,
  );
}
export function communicationPartLines(
  drawing: CommunicationDrawing,
  width: number,
  selected: readonly PortIdentity[] = [],
): string[] {
  if (!drawing.pagination) return [];
  return [
    ...wrapText(communicationPartNotice, width, 2.5),
    ...communicationPartRows(drawing, selected, true).flatMap(
      (d) =>
        communicationRowLayout(
          d,
          width,
          communicationReferenceLines(
            d.label,
            d.targets.map((t) => ({ ...t, sheet: 100, zone: "D6" })),
            width,
          ),
        ).lines,
    ),
  ];
}
export function emitCommunicationContinuationBlock(
  block: CommunicationContinuationBlock,
): string {
  let y = block.y;
  const out = wrapText(communicationPartNotice, block.width, 2.5).map((s) => {
    const row = text(block.x, y, s, 2.5);
    y += 3.5;
    return row;
  });
  for (const row of block.rows) {
    out.push(
      `<g data-communication-continuation-device="${attr(row.deviceUid)}" data-communication-view="${block.view}" data-from-part="${block.part}" data-destination-parts="${attr(JSON.stringify(row.targets.map((t) => t.part)))}" data-destination-sheets="${attr(JSON.stringify(row.targets.map((t) => t.sheet)))}">`,
    );
    const summary = communicationReferenceLines(
      row.label,
      row.targets,
      block.width,
    );
    const layout = communicationRowLayout(row, block.width, summary);
    for (const [line, s] of summary.entries())
      out.push(text(block.x, y + line * 3.5, s, 2.5));
    for (const entry of layout.entries)
      out.push(
        `<g data-native-part-device="${attr(row.deviceUid)}" data-native-part-port="${attr(entry.key)}">${text(block.x + entry.x, y + entry.line * 3.5, entry.text, 2.5)}</g>`,
      );
    y += layout.lines.length * 3.5;
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
  zones: readonly (string | undefined)[] = [],
): string[] {
  return circuitTextLines(
    `${label} -> ${parts.map((part, i) => nativePartToken({ part, sheet: sheets[i] ?? 100, zone: zones[i] ?? "D6" })).join(", ")}`,
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
  const out: string[] = [];
  const notice = () => {
    for (const s of circuitTextLines(circuitPartNotice, block.width)) {
      out.push(text(block.x, y, s, 2.5));
      y += 3.5;
    }
  };
  if (!block.noticeAfterTargets) notice();
  for (const row of block.rows) {
    out.push(
      `<g data-circuit-continuation="${attr(block.group)}" data-from-part="${block.part}" data-continuation-terminal="${attr(row.id)}" data-destination-parts="${attr(JSON.stringify(row.targets.map((t) => t.part)))}" data-destination-sheets="${attr(JSON.stringify(row.targets.map((t) => t.sheet)))}">`,
    );
    for (const s of circuitContinuationLines(
      row.label,
      row.targets.map((t) => t.part),
      row.targets.map((t) => t.sheet),
      block.width,
      row.targets.map((t) =>
        required(t.zone, "Unresolved circuit destination zone"),
      ),
    )) {
      out.push(text(block.x, y, s, 2.5));
      y += 3.5;
    }
    out.push("</g>");
  }
  if (block.noticeAfterTargets) notice();
  return out.join("");
}

export { drawingContinuations } from "./rooted-links.js";

export function resolveCircuitContinuations(
  drafts: Draft[],
  noticeAfterTargets: boolean,
): void {
  for (const draft of drafts)
    draft.circuitBlocks = (draft.circuitParts ?? []).map(
      ({ drawing, x, y, width }) => ({
        group: drawing.id,
        part: drawing.pagination!.part,
        x,
        y,
        width,
        noticeAfterTargets,
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
