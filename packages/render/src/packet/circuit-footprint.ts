import { circuitTextLines, type CircuitDrawing } from "../circuit.js";
import { circuitPartHeight } from "./continuations.js";
import { fieldTextRightExtent } from "./svg.js";

const boldFieldLineWidth = (line: string, size: number) =>
  fieldTextRightExtent(line, size, true);

export function circuitViewFootprint(
  title: string,
  width: number,
  fieldHeight: number,
) {
  const headingLines = circuitTextLines(title, width, 3.5, boldFieldLineWidth),
    headerHeight = headingLines.length * 4.5 + 3;
  return {
    headingLines,
    headerHeight,
    available: fieldHeight - headerHeight - 1,
  };
}

export function circuitGroupLabel(group: CircuitDrawing) {
  return [
    group.lineReference ? `Ref. ${group.lineReference}` : undefined,
    group.label,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function circuitGroupFootprint(group: CircuitDrawing, width: number) {
  const headings = circuitTextLines(
      circuitGroupLabel(group),
      width,
      2.7,
      boldFieldLineWidth,
    ),
    headHeight = headings.length * 3.5 + 1;
  return {
    headings,
    headHeight,
    height: headHeight + group.height + circuitPartHeight(group, width) + 3,
  };
}
