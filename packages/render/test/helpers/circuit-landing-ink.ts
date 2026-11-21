import type { ElectricalIr, TerminalId } from "@thermite/compiler";
import { navigationGeometry } from "../../src/packet/navigation-walk.js";
import type { SvgNode } from "../../src/device-legend/svg-tree.js";
import { points } from "./route-quality.js";

type Point = { x: number; y: number };
const key = (t: TerminalId) => JSON.stringify([t.deviceUid, t.terminalKey]);
function nativeEnds(value: string): unknown {
  return JSON.parse(value);
}
function project(p: Point, m: readonly number[]): Point {
  return {
    x: (m[0] ?? 0) * p.x + (m[2] ?? 0) * p.y + (m[4] ?? 0),
    y: (m[1] ?? 0) * p.x + (m[3] ?? 0) * p.y + (m[5] ?? 0),
  };
}

function inheritedAttribute(
  node: SvgNode,
  name: string,
  parents: ReadonlyMap<SvgNode, SvgNode>,
) {
  const ancestry: SvgNode[] = [];
  for (let p: SvgNode | undefined = node; p; p = parents.get(p))
    ancestry.push(p);
  return ancestry.map((p) => p.attrs[name]).find(Boolean);
}

/** Observe native paint, excluding zero-ink layout anchors and white halos. */
export function circuitLandingInk(svg: string, ir: Readonly<ElectricalIr>) {
  const all = navigationGeometry(svg),
    parents = new Map<SvgNode, SvgNode>();
  for (const g of all)
    for (const child of g.node.children) parents.set(child, g.node);
  const attr = (node: SvgNode, name: string) =>
    inheritedAttribute(node, name, parents);
  const marks = all
    .filter(
      (g) =>
        g.visible &&
        g.node.name === "circle" &&
        Number(g.node.attrs.r) > 0.1 &&
        attr(g.node, "data-terminal-id"),
    )
    .map((g) => ({
      terminal: attr(g.node, "data-terminal-id"),
      p: project(
        { x: Number(g.node.attrs.cx), y: Number(g.node.attrs.cy) },
        g.matrix,
      ),
      radius: Number(g.node.attrs.r) * Math.hypot(g.matrix[0], g.matrix[1]),
    }));
  const routes = all
    .filter(
      (g) =>
        g.visible &&
        g.node.name === "path" &&
        g.node.attrs.stroke === "#17212b" &&
        attr(g.node, "data-circuit-conductor"),
    )
    .map((g) => ({
      uid: attr(g.node, "data-circuit-conductor"),
      ports: [
        attr(g.node, "data-layout-source-port"),
        attr(g.node, "data-layout-target-port"),
      ],
      ends: nativeEnds(attr(g.node, "data-endpoints") ?? "[]"),
      points: points(g.node.attrs.d ?? "").map((p) => project(p, g.matrix)),
      stroke:
        Number(g.node.attrs["stroke-width"]) *
        Math.hypot(g.matrix[0], g.matrix[1]),
    }));
  const anchors = all
    .filter((g) => g.node.attrs["data-circuit-landing-for"])
    .map((g) => ({
      id: g.node.attrs["data-layout-port"],
      p: project(
        { x: Number(g.node.attrs.cx), y: Number(g.node.attrs.cy) },
        g.matrix,
      ),
    }));
  return { marks, routes, anchors, ir };
}
type Ink = ReturnType<typeof circuitLandingInk>;

export function circuitLandingAnchorDefects(ink: Ink) {
  return ink.routes.flatMap((r) =>
    r.ports.flatMap((port, i) => {
      if (!port?.includes("-circuit-landing-")) return [];
      const anchors = ink.anchors.filter((a) => a.id === port);
      const end = i === 0 ? r.points[0] : r.points.at(-1),
        anchor = anchors[0];
      return anchors.length === 1 &&
        end &&
        anchor &&
        Math.hypot(end.x - anchor.p.x, end.y - anchor.p.y) < 0.002
        ? []
        : [`${r.uid}:${i}:layout-anchor`];
    }),
  );
}

export function circuitEndpointDefects(ink: Ink) {
  const defects: string[] = [];
  for (const wire of ink.ir.wires) {
    const route = ink.routes.filter((r) => r.uid === wire.uid);
    if (route.length !== 1) {
      defects.push(`${wire.designation}:route-count`);
      continue;
    }
    const r = route[0];
    if (!r) continue;
    if (
      JSON.stringify(r.ends) !==
      JSON.stringify(wire.endpoints.map((e) => e.terminal))
    )
      defects.push(`${wire.designation}:native-identity`);
    const tips = [r.points[0], r.points.at(-1)];
    for (const { terminal } of wire.endpoints)
      if (
        !ink.marks.some(
          (m) =>
            m.terminal === key(terminal) &&
            tips.some(
              (p) =>
                p && Math.hypot(p.x - m.p.x, p.y - m.p.y) <= m.radius + 0.002,
            ),
        )
      )
        defects.push(`${wire.designation}:${terminal.terminalKey}:detached`);
  }
  return defects;
}

export function circuitApproachGap(ink: Ink, a: string, b: string) {
  const left = ink.routes.find((r) => r.uid === a),
    right = ink.routes.find((r) => r.uid === b);
  if (!left || !right) return -Infinity;
  let minimum = Infinity;
  for (const axis of ["x", "y"] as const) {
    const cross = axis === "x" ? "y" : "x";
    for (let i = 1; i < left.points.length; i++)
      for (let j = 1; j < right.points.length; j++) {
        const p = left.points[i - 1],
          q = left.points[i],
          r = right.points[j - 1],
          s = right.points[j];
        if (
          !p ||
          !q ||
          !r ||
          !s ||
          Math.abs(p[cross] - q[cross]) > 0.001 ||
          Math.abs(r[cross] - s[cross]) > 0.001
        )
          continue;
        const overlap =
          Math.min(Math.max(p[axis], q[axis]), Math.max(r[axis], s[axis])) -
          Math.max(Math.min(p[axis], q[axis]), Math.min(r[axis], s[axis]));
        if (overlap > 3)
          minimum = Math.min(
            minimum,
            Math.abs(p[cross] - r[cross]) - (left.stroke + right.stroke) / 2,
          );
      }
  }
  return minimum;
}
