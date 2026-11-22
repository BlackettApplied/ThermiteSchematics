import type { ElkLabel, ElkNode } from "elkjs/lib/elk-api.js";
import { CAPTION_CLEARANCE_MM } from "../symbols/caption-ink.js";
import { InlineLabelFitError } from "./inline-label-error.js";
import { required } from "../presentation/util.js";

type Box = { x: number; y: number; width: number; height: number };
const overlaps = (a: Box, b: Box, margin: number) =>
  a.x < b.x + b.width + margin - 1e-7 &&
  b.x < a.x + a.width + margin - 1e-7 &&
  a.y < b.y + b.height + margin - 1e-7 &&
  b.y < a.y + a.height + margin - 1e-7;
const segments = (graph: ElkNode, strokes: ReadonlyMap<string, number>) =>
  (graph.edges ?? []).flatMap((e) =>
    (e.sections ?? []).flatMap((s) => {
      const p = [s.startPoint, ...(s.bendPoints ?? []), s.endPoint];
      return p.slice(1).map((b, i) => {
        const a = required(p[i], "Missing native circuit geometry"),
          stroke = required(strokes.get(e.id), "Missing conductor stroke");
        return {
          edge: e.id,
          a,
          b,
          length: Math.hypot(b.x - a.x, b.y - a.y),
          box: {
            x: Math.min(a.x, b.x) - stroke / 2,
            y: Math.min(a.y, b.y) - stroke / 2,
            width: Math.abs(a.x - b.x) + stroke,
            height: Math.abs(a.y - b.y) + stroke,
          },
        };
      });
    }),
  );

/** Three deterministic complete assignments, with no ELK calls or path writes.
 * Full plates, foreign labels, nodes and foreign conductor strokes are obstacles. */
export function placeCircuitInlineLabels(
  graph: ElkNode,
  labels: ReadonlyMap<string, ElkLabel[]>,
  strokes: ReadonlyMap<string, number>,
  mode: number,
) {
  const lines = segments(graph, strokes);
  const boxes = obstacles(graph, labels);
  for (const [ordinal, edge] of (graph.edges ?? []).entries()) {
    const inline = labels.get(edge.id);
    if (!inline) continue;
    edge.labels = [];
    const own = lines
      .filter((s) => s.edge === edge.id)
      .sort((a, b) => b.length - a.length);
    for (const label of inline) {
      const width = required(label.width, "Missing circuit label width"),
        height = required(label.height, "Missing circuit label height");
      let placed: ElkLabel | undefined;
      for (const s of own) {
        const vertical = Math.abs(s.a.x - s.b.x) < 1e-7,
          along = vertical ? height : width;
        // The 1 mm visible stub is the existing caption/stroke clearance rule.
        if (s.length + 1e-7 < along + 2 * CAPTION_CLEARANCE_MM) continue;
        const low = vertical ? Math.min(s.a.y, s.b.y) : Math.min(s.a.x, s.b.x);
        const center =
          mode === 0
            ? low + s.length / 2
            : (ordinal + mode) % 2
              ? low + CAPTION_CLEARANCE_MM + along / 2
              : low + s.length - CAPTION_CLEARANCE_MM - along / 2;
        const box = {
          x: vertical ? s.a.x - width / 2 : center - width / 2,
          y: vertical ? center - height / 2 : s.a.y - height / 2,
          width,
          height,
        };
        if (
          box.x < 0 ||
          box.y < 0 ||
          box.x + width >
            required(graph.width, "Missing native circuit geometry") + 1e-7 ||
          box.y + height >
            required(graph.height, "Missing native circuit geometry") + 1e-7 ||
          boxes.some((b) => overlaps(box, b, CAPTION_CLEARANCE_MM)) ||
          lines.some(
            (f) =>
              f.edge !== edge.id && overlaps(box, f.box, CAPTION_CLEARANCE_MM),
          )
        )
          continue;
        placed = { ...label, ...box };
        boxes.push(box);
        break;
      }
      if (!placed)
        throw new InlineLabelFitError(
          "No native circuit segment fits the complete wire label with stroke clearance.",
        );
      edge.labels.push(placed);
    }
  }
}

function obstacles(graph: ElkNode, labels: ReadonlyMap<string, ElkLabel[]>) {
  const boxes: Box[] = (graph.children ?? []).map((n) => ({
    x: required(n.x, "Missing native circuit geometry"),
    y: required(n.y, "Missing native circuit geometry"),
    width: required(n.width, "Missing native circuit geometry"),
    height: required(n.height, "Missing native circuit geometry"),
  }));
  boxes.push(
    ...(graph.edges ?? [])
      .filter((e) => !labels.has(e.id))
      .flatMap((e) =>
        (e.labels ?? []).map((l) => ({
          x: required(l.x, "Missing native circuit geometry"),
          y: required(l.y, "Missing native circuit geometry"),
          width: required(l.width, "Missing native circuit geometry"),
          height: required(l.height, "Missing native circuit geometry"),
        })),
      ),
  );
  return boxes;
}
