import {
  printableTextMetrics,
  printableTextRightExtent,
} from "../text-metrics.js";
import { fieldTextLeftShift } from "./svg.js";
import { required } from "../presentation/util.js";
import type { CommunicationDrawing } from "../communication.js";
import type { PortIdentity } from "../topology-coverage.js";
import type {
  CommunicationContinuationBlock,
  NativePartTarget,
} from "./types.js";

/** Additive packet DTO: native part coverage supplies identities, never titles. */
export function communicationPartRows(
  drawing: CommunicationDrawing,
  selected: readonly PortIdentity[],
  reserve = false,
): CommunicationContinuationBlock["rows"] {
  const drawn = new Set(
    drawing.topologyCoverage?.ports.map((p) => JSON.stringify(p)),
  );
  return (drawing.pagination?.devices ?? []).map((d) => ({
    deviceUid: d.deviceUid,
    label: d.designation,
    targets: d.parts.map((part) => ({ part, sheet: part })),
    ports: selected
      .filter(
        (p) => p.deviceUid === d.deviceUid && !drawn.has(JSON.stringify(p)),
      )
      .map((p) => ({
        key: p.portKey,
        targets: reserve ? [{ part: 100, sheet: 100, zone: "D6" }] : [],
      })),
  }));
}
export function nativePartToken(t: NativePartTarget): string {
  return `P${t.part}/S${String(t.sheet).padStart(2, "0")}.${required(t.zone, "Unresolved native part zone")}`;
}
/** Qualified port pointers start on their own line below the repeated-body pointer (#430). */
export function communicationRowLayout(
  row: CommunicationContinuationBlock["rows"][number],
  width: number,
  summary: readonly string[],
) {
  const lines = [...summary],
    entries: { key: string; text: string; x: number; line: number }[] = [];
  const metrics = (s: string) => {
    const m = printableTextMetrics(s, 2.5);
    const right = Math.max(m.advance, printableTextRightExtent(s, 2.5));
    return { right, width: right - Math.min(0, m.left) };
  };
  let line = Math.max(0, lines.length - 1),
    x = metrics(lines[line] ?? "").width;
  if (row.ports?.length && lines.length > 0 && lines[line]) {
    line = lines.length;
    x = 0;
    lines.push("");
  }
  for (const port of row.ports ?? []) {
    if (!port.targets.length) throw Error("Unresolved native port destination");
    const value = `${row.label} port ${port.key} → ${port.targets.map((t) => `${String(t.sheet).padStart(2, "0")}.${required(t.zone, "Unresolved native part zone")}`).join(", ")}`;
    const { right, width: w } = metrics(value);
    const startShift = fieldTextLeftShift(value, 2.5);
    if (startShift + right > width)
      throw Error("Native port entry cannot fit the reserved reference width");
    if (x > 0 && x + 2 + w > width) {
      line++;
      x = 0;
      lines.push("");
    } else if (x > 0) x += 2;
    const entryX = x === 0 ? startShift : x;
    entries.push({ key: port.key, text: value, x: entryX, line });
    lines[line] = `${lines[line] ?? ""}${lines[line] ? "  " : ""}${value}`;
    x = entryX + right;
  }
  return { lines, entries };
}

/** Per-call observation of the original full drawing before native part trials. */
export function communicationPortSelection() {
  let selected: readonly PortIdentity[] = [];
  return (drawing: CommunicationDrawing) => {
    if (
      drawing.topologyCoverage?.kind === "communication" &&
      !drawing.pagination
    )
      selected = drawing.topologyCoverage.ports;
    return selected;
  };
}

export function communicationPartBlock(
  drawing: CommunicationDrawing,
  field: { x: number; y: number; w: number },
  height: number,
  lines: number,
  selected: readonly PortIdentity[],
): CommunicationContinuationBlock {
  return {
    view: 0,
    part: required(drawing.pagination, "Missing native communication part")
      .part,
    x: field.x,
    y: field.y + height - (lines - 1) * 3.5,
    width: field.w,
    rows: communicationPartRows(drawing, selected),
  };
}
