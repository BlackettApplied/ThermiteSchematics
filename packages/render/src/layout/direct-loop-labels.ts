import type { ElkExtendedEdge, ElkLabel, ElkNode } from "elkjs/lib/elk-api.js";
import { required } from "../presentation/util.js";
import { InlineLabelFitError } from "./inline-label-error.js";

/** Remove inline labels from ELK's transverse lane demand, not from the drawing. */
export function detachLoopLabels(
  edges: ElkExtendedEdge[],
  ids: readonly string[],
) {
  const labels = new Map<string, ElkLabel[]>();
  for (const edge of edges) {
    if (!ids.includes(edge.id)) continue;
    labels.set(edge.id, edge.labels ?? []);
    edge.labels = [];
  }
  return labels;
}

function longestLoopSegment(edge: ElkExtendedEdge) {
  const segments = (edge.sections ?? []).flatMap((section) => {
    const points = [
      section.startPoint,
      ...(section.bendPoints ?? []),
      section.endPoint,
    ];
    return points.slice(1).flatMap((b, i) => {
      const a = required(points[i], "Missing loop segment start");
      return Math.abs(a.x - b.x) < 1e-6
        ? [
            {
              x: (a.x + b.x) / 2,
              y: (a.y + b.y) / 2,
              length: Math.abs(a.y - b.y),
            },
          ]
        : [];
    });
  });
  const segment = segments.sort((a, b) => b.length - a.length)[0];
  if (!segment)
    throw new InlineLabelFitError(
      "No vertical segment fits the output loop wire label.",
    );
  return segment;
}

/** Only labels move after layout. Routes and fixed terminal ports stay native.
 * Stagger phases alternate distinct route lanes, clamped to the chosen segment.
 * Equal-length segments retain native order, as in the centered placement. */
export function placeLoopLabels(
  graph: ElkNode,
  labels: Map<string, ElkLabel[]>,
  stagger = 0,
) {
  const placements = (graph.edges ?? []).flatMap((edge) => {
    const inline = labels.get(edge.id);
    return inline ? [{ edge, inline, segment: longestLoopSegment(edge) }] : [];
  });
  const lanes = [...new Set(placements.map(({ segment }) => segment.x))].sort(
    (a, b) => a - b,
  );
  for (const { edge, inline, segment } of placements) {
    edge.labels = inline.map((label) => {
      const width = required(label.width, "Missing loop label width");
      const height = required(label.height, "Missing loop label height");
      if (height > segment.length)
        throw new InlineLabelFitError(
          "No vertical segment fits the output loop wire label.",
        );
      // Keep at least the centered 8 mm lane's endpoint/bend margin.
      const lead = Math.max(0, (8 - height) / 2);
      const shift = Math.min(
        (height + 1) / 2,
        Math.max(0, (segment.length - height) / 2 - lead),
      );
      const offset = stagger * (lanes.indexOf(segment.x) % 2 ? 1 : -1) * shift;
      return {
        ...label,
        x: segment.x - width / 2,
        y: segment.y + offset - height / 2,
      };
    });
  }
}

/** Two tallest label boxes, 1 mm between them, and the original lane's end
 * margins. This is one geometry-derived candidate, never a width search. */
export function loopStaggerGap(labels: Map<string, ElkLabel[]>) {
  const height = Math.max(
    0,
    ...[...labels.values()]
      .flat()
      .map((label) => required(label.height, "Missing loop label height")),
  );
  return Math.max(8, 2 * height + 1 + Math.max(0, 8 - height));
}
