import type { ElkNode } from "elkjs/lib/elk-api.js";
import { required } from "../presentation/util.js";

type PortOwner = { device: { uid: string }; pins: readonly { id: string }[] };
/** Fixed local coordinates already preserve order inside one node. Distributed
 * appearances of the same physical device also need a global order comparison. */
export function circuitPortGroups(nodes: readonly PortOwner[]) {
  const owners = new Map<string, PortOwner[]>();
  for (const node of nodes) {
    const group = owners.get(node.device.uid) ?? [];
    group.push(node);
    owners.set(node.device.uid, group);
  }
  return [...owners.values()]
    .filter((group) => group.length > 1)
    .map((group) => group.flatMap((node) => node.pins.map((p) => p.id)));
}
function positions(graph: ElkNode) {
  return new Map(
    (graph.children ?? []).flatMap((node) =>
      (node.ports ?? []).map(
        (port) =>
          [
            port.id,
            {
              x:
                required(node.x, "Missing circuit node x") +
                required(port.x, "Missing circuit port x"),
              y:
                required(node.y, "Missing circuit node y") +
                required(port.y, "Missing circuit port y"),
            },
          ] as const,
      ),
    ),
  );
}
/** Do not infer phases from printed names. Preserve each physical device's
 * original port order on both axes, including coherently moved nodes/routes.
 * An axis tie (difference <1e-7) must remain a tie at that same tolerance;
 * alignment supplies no license to choose either new order. The other axis
 * retains its original strict order. Coherent translation remains legal. */
export function circuitPortOrderGuard(
  candidate: ElkNode,
  original: ElkNode,
  groups: readonly (readonly string[])[],
) {
  if (!groups.length) return true;
  const before = positions(original),
    after = positions(candidate);
  return groups.every((group) =>
    group.every((id, i) =>
      group.slice(i + 1).every((other) => {
        const a = before.get(id),
          b = before.get(other),
          c = after.get(id),
          d = after.get(other);
        if (!a || !b || !c || !d) return false;
        return (["x", "y"] as const).every((axis) => {
          const old = a[axis] - b[axis],
            next = c[axis] - d[axis];
          return Math.abs(old) < 1e-7
            ? Math.abs(next) < 1e-7
            : Math.sign(old) === Math.sign(next) && Math.abs(next) >= 1e-7;
        });
      }),
    ),
  );
}
