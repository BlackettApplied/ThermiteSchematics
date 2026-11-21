import type { ElkNode, ElkPort, ElkExtendedEdge } from "elkjs/lib/elk-api.js";
import { required } from "../presentation/util.js";
import { circuitRouteMetrics } from "./circuit-route-quality.js";

// Existing terminal mark, unchanged. Attachments describe selected incidences,
// not additional terminals, screws, accessories or admissible hardware capacity.
export const WIRING_TERMINAL_RADIUS_SVG = ".7";
export const WIRING_TERMINAL_RADIUS = Number(WIRING_TERMINAL_RADIUS_SVG);
export const WIRING_LANDING_OFFSET = 0.5;
export const WIRING_LANDING_SUFFIX = "-landing-";
type Use = { edge: ElkExtendedEdge; end: "sources" | "targets" };
type Reference = {
  edges: ReadonlyMap<string, ElkExtendedEdge>;
  nodes: ReadonlyMap<string, ElkNode>;
};

function incidences(input: ElkNode) {
  const uses = new Map<string, Use[]>();
  for (const edge of input.edges ?? [])
    for (const end of ["sources", "targets"] as const)
      for (const id of edge[end]) {
        const list = uses.get(id) ?? [];
        list.push({ edge, end });
        uses.set(id, list);
      }
  return uses;
}
function remoteEnd(use: Use, reference: Reference) {
  const edge = required(
    reference.edges.get(use.edge.id),
    "Missing native wiring edge",
  );
  return use.end === "sources"
    ? required(edge.sections?.at(-1), "Missing wiring target").endPoint
    : required(edge.sections?.[0], "Missing wiring source").startPoint;
}
function primaryUse(uses: readonly Use[], reference: Reference) {
  return required(
    [...uses].sort((a, b) => {
      const incoming =
        Number(b.end === "targets") - Number(a.end === "targets");
      const bends = (use: Use) =>
        circuitRouteMetrics(
          required(reference.edges.get(use.edge.id), "Missing wiring route"),
        ).bends;
      return (
        incoming ||
        bends(a) - bends(b) ||
        (a.edge.id < b.edge.id ? -1 : a.edge.id > b.edge.id ? 1 : 0)
      );
    })[0],
    "Missing wiring incidence",
  );
}
function splitPort(
  node: ElkNode,
  port: ElkPort,
  uses: readonly Use[],
  reference: Reference,
  aliases: Map<string, string>,
) {
  const primary = primaryUse(uses, reference);
  const rest = uses
    .filter((u) => u !== primary)
    .sort((a, b) => {
      const p = remoteEnd(a, reference),
        q = remoteEnd(b, reference);
      return p.y - q.y || p.x - q.x || (a.edge.id < b.edge.id ? -1 : 1);
    });
  const y = required(port.y, "Unplaced wiring terminal");
  for (const [i, use] of rest.entries()) {
    const direction =
      rest.length === 2
        ? i === 0
          ? -1
          : 1
        : y === Math.min(...(node.ports ?? []).map((p) => p.y ?? Infinity))
          ? -1
          : 1;
    const id = `${port.id}${WIRING_LANDING_SUFFIX}${use.edge.id}-${use.end}`;
    node.ports = [
      ...(node.ports ?? []),
      {
        ...port,
        id,
        x: required(port.x, "Unplaced wiring terminal"),
        y: y + direction * WIRING_LANDING_OFFSET,
        layoutOptions: { ...port.layoutOptions },
      },
    ];
    use.edge[use.end] = use.edge[use.end].map((old) =>
      old === port.id ? id : old,
    );
    aliases.set(id, port.id);
  }
}

export function independentWiringInput(input: ElkNode, baseline: ElkNode) {
  const copy = structuredClone(input);
  const shared = [...incidences(copy)].filter(
    ([, uses]) => new Set(uses.map((u) => u.edge.id)).size > 1,
  );
  // More than three visible orthogonal approaches needs a separately reviewed
  // graphic reservation. Preserve that original drawing rather than invent it.
  if (!shared.length || shared.some(([, uses]) => uses.length > 3))
    return undefined;
  const owners = new Map(
    (copy.children ?? []).flatMap((node) =>
      (node.ports ?? []).map((port) => [port.id, { node, port }] as const),
    ),
  );
  const reference: Reference = {
    edges: new Map((baseline.edges ?? []).map((e) => [e.id, e])),
    nodes: new Map((baseline.children ?? []).map((n) => [n.id, n])),
  };
  const aliases = new Map<string, string>();
  for (const [id, uses] of shared) {
    const { node, port } = required(
      owners.get(id),
      "Missing physical wiring terminal",
    );
    splitPort(node, port, uses, reference, aliases);
  }
  // Short native side stubs fan inside 3 mm of the unchanged terminal mark.
  // Reserve 2.5 mm before the parallel channel, keeping it off the device frame.
  // The original profile and all route, ink and final-print guards stay intact.
  copy.layoutOptions = {
    ...copy.layoutOptions,
    "elk.layered.spacing.nodeNodeBetweenLayers": "5",
    "elk.spacing.edgeNode": "2.5",
    "elk.layered.spacing.edgeNodeBetweenLayers": "2.5",
  };
  return { input: copy, aliases };
}
