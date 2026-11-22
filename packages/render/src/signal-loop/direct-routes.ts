import { routePortAttributes } from "../layout/port-attributes.js";
import type { ElkNode } from "elkjs/lib/elk-api.js";
import {
  escapeXmlText as xml,
  escapeXmlAttribute as attr,
} from "../svg/escape.js";
import { snappedPath } from "../signal-loop/route-geometry.js";
import type { DrawingEdge, LoopUtilities } from "./direct-types.js";
export function emitDirectLoopSections(
  sections: NonNullable<NonNullable<ElkNode["edges"]>[number]["sections"]>,
  source: DrawingEdge,
  graph: ElkNode,
  out: string[],
  n: LoopUtilities["n"],
) {
  for (const section of sections) {
    const points = snappedPath([
      section.startPoint,
      ...(section.bendPoints ?? []),
      section.endPoint,
    ]);
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!,
        b = points[i]!;
      for (const node of graph.children ?? []) {
        if (
          a.x === b.x
            ? a.x > node.x! + 0.01 &&
              a.x < node.x! + node.width! - 0.01 &&
              Math.max(a.y, b.y) > node.y! + 0.01 &&
              Math.min(a.y, b.y) < node.y! + node.height! - 0.01
            : a.y > node.y! + 0.01 &&
              a.y < node.y! + node.height! - 0.01 &&
              Math.max(a.x, b.x) > node.x! + 0.01 &&
              Math.min(a.x, b.x) < node.x! + node.width! - 0.01
        )
          throw new Error("Signal loop route crosses a device body.");
      }
    }
    out.push(
      `<path d="${points.map((p, i) => `${i ? "L" : "M"} ${n(p.x)} ${n(p.y)}`).join(" ")}" fill="none" stroke="${source.spare ? "#697586" : "#23566d"}" stroke-width="${source.assembly ? 1.25 : 0.4}" stroke-linecap="round"${source.spare ? ' stroke-dasharray="2 1"' : ""}/>`,
    );
  }
}

export function emitDirectLoopRoutes(
  graph: ElkNode,
  edges: DrawingEdge[],
  out: string[],
  { n, text }: LoopUtilities,
) {
  for (const edge of graph.edges ?? []) {
    const source = edges[Number(edge.id.slice(1))]!;
    if (!edge.sections?.length)
      throw new Error("Incomplete signal loop route.");
    if (source.assembly)
      out.push(
        `<g ${routePortAttributes(edge)} data-cable-assembly="${attr(source.cable!)}"><desc>${xml(JSON.stringify(source.assembly.members))}</desc>`,
      );
    else
      out.push(
        `<g ${routePortAttributes(edge)} data-terminal-ends="${attr(JSON.stringify(source.ends))}" data-net-id="${attr(source.net!)}" data-loop-conductor="${attr(source.id)}">`,
      );
    emitDirectLoopSections(edge.sections, source, graph, out, n);
    for (const label of edge.labels ?? []) {
      if (![label.x, label.y, label.width, label.height].every(Number.isFinite))
        throw new Error("Unplaced signal loop label.");
      out.push(
        `<rect x="${n(label.x!)}" y="${n(label.y!)}" width="${n(label.width!)}" height="${n(label.height!)}" fill="white"/>`,
      );
      source.label.forEach((s, i) =>
        out.push(text(label.x! + 1, label.y! + 3 + i * 3.8, s)),
      );
    }
    out.push("</g>");
  }
}
