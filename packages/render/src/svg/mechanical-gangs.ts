import type { SvgWriter } from "./writer.js";
import type { rootedGangEmission } from "../symbols/rooted-gangs.js";
export function emitMechanicalGangs(
  writer: SvgWriter,
  segments: Extract<
    ReturnType<typeof rootedGangEmission>,
    { ok: true }
  >["value"],
  mmPerUnit: number,
  project: (value: number) => number,
) {
  for (const segment of segments)
    writer.element(1, "line", {
      class: "mechanical-gang",
      "data-ganged-group": segment.groupId,
      "data-mechanical-association": "ganged",
      "data-ganged-functions": JSON.stringify(segment.functions),
      x1: project(segment.from.x),
      y1: project(segment.from.y),
      x2: project(segment.to.x),
      y2: project(segment.to.y),
      stroke: "#17212b",
      "stroke-width": 0.25 / mmPerUnit,
      "stroke-dasharray": `${1.5 / mmPerUnit} ${1 / mmPerUnit}`,
    });
}
