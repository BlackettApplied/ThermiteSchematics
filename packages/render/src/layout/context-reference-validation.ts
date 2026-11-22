import type {
  LayoutContextReference,
  LayoutLabel,
  LayoutPoint,
  LayoutPort,
} from "../types.js";
import { inkGap } from "../symbols/caption-ink.js";
import type { Bounds } from "./validate-output.js";
export interface ReferenceObstacle {
  bounds: Bounds;
  ownerId?: string;
  anchors?: readonly LayoutPoint[];
}
const same = (a: LayoutPoint, b: LayoutPoint) => a.x === b.x && a.y === b.y;
const contains = (b: Bounds, p: LayoutPoint) =>
  p.x >= b.left && p.x <= b.right && p.y >= b.top && p.y <= b.bottom;
/** Check only actual local ink. Intentional attachment at the leader's origin
 * is allowed; unrelated strokes, captions and the other end stay 1 mm clear. */
export function validateContextReferenceClearance(
  references: readonly LayoutContextReference[],
  labels: readonly LayoutLabel[],
  ink: ReadonlyMap<string, Bounds>,
  ports: ReadonlyMap<string, LayoutPort>,
  obstacles: readonly ReferenceObstacle[],
  reject: (message: string) => never,
) {
  const requiredInk = (id: string) => {
    const box = ink.get(id);
    if (!box) reject(`context ink ${id} is missing`);
    return box;
  };
  for (const reference of references) {
    const label = labels.find(
      (l) => l.ownerId === reference.id && l.role === "reference",
    );
    const box = label && ink.get(label.id);
    if (!label || !box)
      reject(`context reference ${reference.id} lost its label`);
    if (
      obstacles.some((o) => inkGap(box, o.bounds) < 4) ||
      labels.some(
        (l) => l.id !== label.id && inkGap(box, requiredInk(l.id)) < 4,
      )
    )
      reject(
        `context reference ${reference.id} label needs 1 mm ink clearance`,
      );
    for (const [i, leader] of reference.leaders.entries()) {
      const [start, end] = leader;
      const ownerId = ports.get(
        i === 0 ? reference.sourcePortId : reference.targetPortId,
      )?.nodeId;
      const bounds = {
        left: Math.min(start.x, end.x) - 0.25,
        right: Math.max(start.x, end.x) + 0.25,
        top: Math.min(start.y, end.y) - 0.25,
        bottom: Math.max(start.y, end.y) + 0.25,
      };
      if (
        obstacles.some(
          (o) =>
            !(
              o.anchors?.some((a) => same(a, start)) ||
              (ownerId !== undefined &&
                o.ownerId === ownerId &&
                contains(o.bounds, start))
            ) && inkGap(bounds, o.bounds) < 4,
        ) ||
        labels.some((l) => inkGap(bounds, requiredInk(l.id)) < 4)
      )
        reject(
          `context reference ${reference.id} leader needs 1 mm ink clearance`,
        );
    }
  }
}

const lineBounds = (a: LayoutPoint, b: LayoutPoint, r: number): Bounds => ({
  left: Math.min(a.x, b.x) - r,
  right: Math.max(a.x, b.x) + r,
  top: Math.min(a.y, b.y) - r,
  bottom: Math.max(a.y, b.y) + r,
});

export function validateContextInk(
  graph: Readonly<import("../types.js").PresentationGraph>,
  geometry: Readonly<import("./validate-output.js").GeometryIndex>,
  references: readonly LayoutContextReference[],
  primitives: ReadonlyMap<string, readonly Bounds[]>,
  segments: readonly { start: LayoutPoint; end: LayoutPoint }[],
  inkBounds: (label: LayoutLabel) => Bounds,
  reject: (message: string) => never,
) {
  const obstacles: ReferenceObstacle[] = [...primitives].flatMap(
    ([ownerId, boxes]) => boxes.map((bounds) => ({ ownerId, bounds })),
  );
  for (const node of graph.nodes)
    if (node.kind === "junction") {
      const port = node.ports[0],
        p = port && geometry.ports.get(port.id);
      if (!p) reject(`junction ${node.id} lost its ink anchor`);
      obstacles.push({
        ownerId: node.id,
        bounds: {
          left: p.x - 3,
          right: p.x + 3,
          top: p.y - 3,
          bottom: p.y + 3,
        },
      });
    }
  for (const s of segments)
    obstacles.push({
      bounds: lineBounds(s.start, s.end, 0.75),
      anchors: [s.start, s.end],
    });
  for (const reference of references)
    for (const [i, leader] of reference.leaders.entries()) {
      const a = leader[0],
        b = leader[1],
        port = geometry.ports.get(
          i === 0 ? reference.sourcePortId : reference.targetPortId,
        );
      if (!a || !b || !port)
        reject(`context reference ${reference.id} lost its ink anchor`);
      obstacles.push({
        ownerId: port.nodeId,
        bounds: lineBounds(a, b, 0.25),
        anchors: [a],
      });
    }
  const labels = [...geometry.labels.values()];
  validateContextReferenceClearance(
    references,
    labels,
    new Map(labels.map((l) => [l.id, inkBounds(l)])),
    geometry.ports,
    obstacles,
    reject,
  );
}
