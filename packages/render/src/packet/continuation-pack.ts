import { CONTINUATION_BLOCK_GAP } from "./continuation-label.js";
import { required } from "../presentation/util.js";
import { compareText } from "../ordering.js";
import type { Draft, Link } from "./types.js";

/** Isotonic packing preserves connector order and minimises squared movement.
 * Only text moves within its reserved bank; anchors and conductor routes stay. */
function pack(links: Link[], axis: "x" | "y") {
  const dimension = axis === "x" ? "w" : "h";
  links.sort((a, b) => a[axis] - b[axis] || compareText(a.id, b.id));
  const offsets: number[] = [],
    blocks: { start: number; end: number; sum: number; count: number }[] = [];
  let distance = 0;
  for (let i = 0; i < links.length; i++) {
    const b = required(
      required(links[i], "Missing endpoint").label,
      "Missing label",
    ).bounds;
    offsets.push(distance);
    blocks.push({ start: i, end: i, sum: b[axis] - distance, count: 1 });
    distance += b[dimension] + CONTINUATION_BLOCK_GAP;
    while (blocks.length > 1) {
      const z = required(blocks.at(-1), "Missing packing block"),
        a = required(blocks.at(-2), "Missing packing block");
      if (a.sum / a.count <= z.sum / z.count) break;
      blocks.splice(-2, 2, {
        start: a.start,
        end: z.end,
        sum: a.sum + z.sum,
        count: a.count + z.count,
      });
    }
  }
  for (const block of blocks)
    for (let i = block.start; i <= block.end; i++) {
      const l = required(
          required(links[i], "Missing endpoint").label,
          "Missing label",
        ),
        move =
          block.sum / block.count +
          required(offsets[i], "Missing packing offset") -
          l.bounds[axis];
      if (Math.abs(move) > 3.5 + 0.001) return false;
      l.bounds[axis] += move;
      for (const row of l.rows) {
        row[axis] += move;
        row.ink[axis] += move;
      }
    }
  return true;
}
export function packContinuationLabels(draft: Draft) {
  return (["left", "right", "top", "bottom"] as const).every((side) =>
    pack(
      draft.links.filter((l) => l.side === side),
      side === "left" || side === "right" ? "y" : "x",
    ),
  );
}
