import { required } from "../presentation/util.js";
import { labelMetrics, labelRows } from "./label-text.js";
import type { Link } from "./types.js";
import type { InkBox } from "./rooted-ink.js";
import { text } from "./svg.js";

export const CONTINUATION_EM = 2.5;
export const CONTINUATION_PITCH = 3.5;
export const CONTINUATION_CLEARANCE = 1;
// Adopted inter-block ink gap. Zone clearance remains measured separately.
export const CONTINUATION_BLOCK_GAP = 2.5;
export const STROKE_GAP = 3.15;
export interface ContinuationRow {
  text: string;
  x: number;
  y: number;
  ink: InkBox;
}
export interface ContinuationLabel {
  rows: ContinuationRow[];
  bounds: InkBox;
  width: number;
  single: boolean;
  headerWidth: number;
}
// D is the widest zone letter in the pinned face; digits have equal advance.
// This widest-case stand-in is replaced with the actual peer zone at assembly.
const PLANNING_ZONE = "D6";
const prefixWidths = new Map<number, number>();
let destinationWidth: number | undefined;
/** The packet limit bounds destinations, not the number of connector pairs. */
export function continuationHeaderWidth(maximumSerial: number) {
  maximumSerial = Math.max(1, maximumSerial);
  if (destinationWidth === undefined) {
    destinationWidth = 0;
    for (const sheet of [99, 100])
      for (const row of "ABCD")
        for (let col = 1; col <= 6; col++)
          destinationWidth = Math.max(
            destinationWidth,
            labelMetrics(`${String(sheet).padStart(2, "0")}.${row}${col}`)
              .width,
          );
  }
  const digits = Math.max(3, String(maximumSerial).length);
  // Tabular digits in the pinned face: one measured representative per length,
  // rather than filling the text-metrics cache with every possible serial.
  for (let length = 3; length <= digits; length++)
    if (!prefixWidths.has(length))
      prefixWidths.set(length, labelMetrics(`C${"9".repeat(length)} / `).width);
  return (
    required(prefixWidths.get(digits), "Missing prefix width") +
    destinationWidth
  );
}
export function continuationHeader(link: Link) {
  return `${link.id} / ${String(link.to).padStart(2, "0")}.${link.toZone ?? PLANNING_ZONE}`;
}
function continuationBody(link: Link, width: number) {
  return [
    ...(link.descriptor ? labelRows(link.descriptor, width) : []),
    link.conductor,
  ];
}
/** Positions and reserved ink are in outer-sheet mm, never scaled SVG units. */
export function continuationLabel(
  link: Link,
  width: number,
  headerWidth: number,
  single = false,
): ContinuationLabel {
  const header = continuationHeader(link);
  const values =
    single && !link.descriptor
      ? [`${header} / ${link.conductor}`]
      : [header, ...continuationBody(link, width)];
  const metrics = values.map((v) => labelMetrics(v));
  const reserved = metrics.map((m, i) =>
    i
      ? m.width
      : single && !link.descriptor
        ? headerWidth + labelMetrics(` / ${link.conductor}`).width
        : headerWidth,
  );
  const w = Math.max(...reserved),
    topInk = Math.max(...metrics.map((m) => m.top)),
    bottomInk = Math.min(0, ...metrics.map((m) => m.bottom));
  const h = topInk + (values.length - 1) * CONTINUATION_PITCH - bottomInk;
  const left =
    link.side === "left"
      ? link.x - STROKE_GAP - w
      : link.side === "right"
        ? link.x + STROKE_GAP
        : link.x - w / 2;
  const top =
    link.side === "top"
      ? link.y - STROKE_GAP - h
      : link.side === "bottom"
        ? link.y + STROKE_GAP
        : link.y - h / 2;
  const rows = values.map((value, i) => {
    const m = required(metrics[i], "Missing row metrics"),
      rw = required(reserved[i], "Missing row reservation");
    const x =
      left +
      (link.side === "left"
        ? w - rw
        : link.side === "top" || link.side === "bottom"
          ? (w - rw) / 2
          : 0) -
      Math.min(0, m.left);
    const y = top + topInk + i * CONTINUATION_PITCH;
    return {
      text: value,
      x,
      y,
      ink: {
        x: x + m.left,
        y: y - m.top,
        w: Math.max(m.right - m.left, rw),
        h: m.top - m.bottom,
      },
    };
  });
  return {
    rows,
    bounds: { x: left, y: top, w, h },
    width,
    single: single && !link.descriptor,
    headerWidth,
  };
}
/** A final continuation identity/ink invariant failed its reservation. */
export class ContinuationLabelError extends Error {}
export function continuationLabelSvg(link: Link) {
  if (!link.label || !link.toZone)
    throw new ContinuationLabelError(
      `Unresolved continuation ${link.id}: ${link.conductor}`,
    );
  const expected = link.label.single
    ? []
    : [
        ...(link.descriptor
          ? labelRows(link.descriptor, link.label.width)
          : []),
        link.conductor,
      ];
  if (
    link.label.rows.length !== expected.length + 1 ||
    expected.some((v, i) => link.label?.rows[i + 1]?.text !== v)
  )
    throw new ContinuationLabelError(
      `Continuation ${link.id} (${link.conductor}) must keep its authored identity on one line. Use a wider bank or another legal cut.`,
    );
  const value =
    continuationHeader(link) +
    (link.label.single ? ` / ${link.conductor}` : "");
  return link.label.rows
    .map((row, index) => {
      const valueToPrint = index === 0 ? value : row.text;
      const m = labelMetrics(valueToPrint),
        box = required(link.label, "Missing label reservation").bounds;
      const shortfall = Math.max(
        m.width - row.ink.w,
        box.x - row.x - m.left,
        row.x + m.right - box.x - box.w,
        box.y - row.y + m.top,
        row.y - m.bottom - box.y - box.h,
      );
      if (shortfall > 0.001)
        throw new ContinuationLabelError(
          `Continuation ${link.id} (${link.conductor}) final ink needs ${shortfall.toFixed(2)} mm more than its reserved ${box.w.toFixed(2)} × ${box.h.toFixed(2)} mm. Use a larger sheet or landscape.`,
        );
      return text(
        row.x,
        row.y,
        valueToPrint,
        CONTINUATION_EM,
        "start",
        400,
        true,
      );
    })
    .join("\n");
}
