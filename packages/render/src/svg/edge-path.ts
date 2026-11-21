import type { LayoutPoint } from "../types.js";
import { OUTER_SVG_PADDING } from "../symbols/catalog.js";
import { formatSvgNumber } from "./numbers.js";
const padded = (value: number) => value + OUTER_SVG_PADDING;

function samePoint(left: LayoutPoint, right: LayoutPoint): boolean {
  return left.x === right.x && left.y === right.y;
}

function simplifiedPoints(
  points: readonly LayoutPoint[],
): readonly LayoutPoint[] {
  const unique: LayoutPoint[] = [];
  for (const point of points) {
    const last = unique.at(-1);
    if (!last || !samePoint(last, point)) {
      unique.push(point);
    }
  }
  const simplified: LayoutPoint[] = [];
  for (const point of unique) {
    while (simplified.length >= 2) {
      const first = simplified.at(-2);
      const second = simplified.at(-1);
      if (!first || !second) break;
      if (!(
        (first.x === second.x && second.x === point.x) ||
        (first.y === second.y && second.y === point.y)
      ))
        break;
      simplified.pop();
    }
    simplified.push(point);
  }
  return simplified;
}

export function orthogonalPathData(points: readonly LayoutPoint[]): string {
  const values = simplifiedPoints(points);
  const first = values[0];
  if (!first || values.length < 2)
    throw new Error("An SVG edge path requires two points.");
  const commands = [
    `M ${formatSvgNumber(padded(first.x))} ${formatSvgNumber(padded(first.y))}`,
  ];
  let previous = first;
  for (const point of values.slice(1)) {
    if (point.y === previous.y)
      commands.push(`H ${formatSvgNumber(padded(point.x))}`);
    else if (point.x === previous.x)
      commands.push(`V ${formatSvgNumber(padded(point.y))}`);
    else throw new Error("SVG emitter received a diagonal edge segment.");
    previous = point;
  }
  return commands.join(" ");
}
