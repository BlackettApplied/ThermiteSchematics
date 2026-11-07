import { PRINTABLE_SYMBOL_POLICY } from "./printable-policy.js";
import type { ElectricalIr } from "@thermite/compiler";
import type {
  PresentationGraph,
  NormalizedSchematicLayout,
  LayoutPoint,
  SymbolPresentationNode,
} from "../types.js";

/** Mechanical ink is permitted only for authored gangs of aligned breaker or disconnector poles.
 * It never participates in ELK routing, ports, nets or conductor accounting. */
export function rootedGangSegments(
  ir: Readonly<ElectricalIr>,
  graph: Readonly<PresentationGraph>,
  layout: Readonly<NormalizedSchematicLayout>,
) {
  // Both strokes plus the printable ink gap, at the smallest composition scale.
  const clearance =
    (PRINTABLE_SYMBOL_POLICY.conductorStrokeMm / 2 +
      0.25 / 2 +
      PRINTABLE_SYMBOL_POLICY.minimumGapMm) /
    PRINTABLE_SYMBOL_POLICY.rootedMmPerUnit;
  const vertical = graph.view.flow === "left-to-right";
  const poles = graph.nodes.filter(
    (node): node is SymbolPresentationNode =>
      node.kind === "symbol" &&
      (node.symbolId === "ais:breaker-pole" ||
        node.symbolId === "ais:disconnector"),
  );
  const labelText = new Map(
    [
      ...graph.locationGroups.map((g) => g.label),
      ...graph.deviceGroups.map((g) => g.label),
      ...graph.nodes.flatMap((n) => (n.kind === "junction" ? [] : n.labels)),
      ...graph.edges.flatMap((e) => [
        ...(e.label ? [e.label] : []),
        ...(e.netLabel ? [e.netLabel] : []),
      ]),
    ].map((l) => [l.id, l.printableText ?? l.text]),
  );
  const result: {
    from: LayoutPoint;
    to: LayoutPoint;
    functions: SymbolPresentationNode["functionIds"];
  }[] = [];
  for (const group of ir.gangedGroups) {
    const members = poles.filter((p) =>
      p.functionIds.some((f) =>
        group.functionIds.some(
          (g) => g.deviceUid === f.deviceUid && g.functionKey === f.functionKey,
        ),
      ),
    );
    if (
      members.length < 2 ||
      new Set(members.map((p) => p.deviceUid)).size !== 1
    )
      continue;
    const centers = members.map((node) => {
      const origin = layout.nodes.find(
        (n) => n.id === node.id,
      )?.primitiveOrigin;
      return origin
        ? {
            node,
            x: origin.x + (vertical ? 18.5 : node.symbolSize.width - 6.5),
            y: origin.y + (vertical ? 6.5 : 18.5),
          }
        : undefined;
    });
    if (centers.some((c) => !c)) continue;
    const aligned = centers
      .filter((c) => c !== undefined)
      .sort((a, b) => (vertical ? a.y - b.y : a.x - b.x));
    if (
      aligned.some(
        (c) =>
          Math.abs(
            (vertical ? c.x : c.y) - (vertical ? aligned[0]!.x : aligned[0]!.y),
          ) > 0.001,
      )
    )
      continue;
    for (let i = 1; i < aligned.length; i++) {
      const from = aligned[i - 1]!,
        to = aligned[i]!;
      const between = (x: number, y: number, w: number, h: number) =>
        vertical
          ? from.x > x - clearance &&
            from.x < x + w + clearance &&
            y + h > from.y - clearance &&
            y < to.y + clearance
          : from.y > y - clearance &&
            from.y < y + h + clearance &&
            x + w > from.x - clearance &&
            x < to.x + clearance;
      if (
        layout.nodes.some(
          (n) =>
            n.id !== from.node.id &&
            n.id !== to.node.id &&
            (n.kind === "symbol" ||
              n.kind === "rail" ||
              n.kind === "junction") &&
            between(n.x, n.y, n.width, n.height),
        )
      )
        continue;
      if (
        layout.labels.some(
          (l) => labelText.get(l.id) && between(l.x, l.y, l.width, l.height),
        )
      )
        continue;
      if (
        layout.edges.some((e) =>
          e.points.some(
            (p, j) =>
              j > 0 &&
              between(
                Math.min(p.x, e.points[j - 1]!.x),
                Math.min(p.y, e.points[j - 1]!.y),
                Math.abs(p.x - e.points[j - 1]!.x),
                Math.abs(p.y - e.points[j - 1]!.y),
              ),
          ),
        )
      )
        continue;
      result.push({
        from: { x: from.x, y: from.y },
        to: { x: to.x, y: to.y },
        functions: [...from.node.functionIds, ...to.node.functionIds],
      });
    }
  }
  return result;
}
