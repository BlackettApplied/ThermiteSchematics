import type { ElkNode } from "elkjs/lib/elk-api.js";
import type {
  LayoutPoint,
  NormalizedSchematicLayout,
  PresentationGraph,
  PresentationNode,
  PresentationEdge,
  JunctionPresentationNode,
  SymbolPresentationNode,
  SchematicFlow,
} from "../types.js";

export interface ControlReconvergence {
  junctionId: string;
  deviceId: string;
  forkPortId: string;
  incomingPorts: readonly [string, string];
  returningEdgeId: string;
}

export function backtracks(
  points: readonly LayoutPoint[],
  flow: SchematicFlow,
) {
  const axis = flow === "left-to-right" ? "x" : "y";
  return points.some((point, i) => {
    const previous = points[i - 1];
    return previous && point[axis] < previous[axis];
  });
}

type Incidence = ReadonlyMap<string, PresentationEdge>;

function incident(node: PresentationNode, edges: Incidence) {
  return node.ports.flatMap(({ id }) => edges.get(id) ?? []);
}

function lateral(flow: SchematicFlow, side: string) {
  return flow === "left-to-right"
    ? side === "north" || side === "south"
    : side === "west" || side === "east";
}

function forkArm(
  junction: JunctionPresentationNode,
  branches: readonly [SymbolPresentationNode, SymbolPresentationNode],
  incoming: Incidence,
  owners: ReadonlyMap<string, PresentationNode>,
  flow: SchematicFlow,
) {
  const [a, b] = branches;
  const [entryA] = incident(a, incoming);
  const [entryB] = incident(b, incoming);
  if (
    a.ports.length !== 2 ||
    b.ports.length !== 2 ||
    entryA?.kind !== "conductor" ||
    entryB?.kind !== "conductor"
  )
    return;
  const fork = owners.get(entryA.sourcePortId);
  if (
    fork?.kind !== "junction" ||
    fork !== owners.get(entryB.sourcePortId) ||
    fork.ports.length !== 3 ||
    incident(fork, incoming)[0]?.kind !== "boundary-segment" ||
    fork.parentId !== junction.parentId
  )
    return;
  return fork.ports.find(
    (p) =>
      lateral(flow, p.side) &&
      (p.id === entryA.sourcePortId || p.id === entryB.sourcePortId),
  );
}

function joinArms(
  junction: JunctionPresentationNode,
  incoming: Incidence,
  outgoing: Incidence,
  owners: ReadonlyMap<string, PresentationNode>,
) {
  const arms = incident(junction, incoming);
  const [first, second] = arms;
  const landings = incident(junction, outgoing);
  const [landing] = landings;
  if (
    arms.length !== 2 ||
    first?.kind !== "conductor" ||
    second?.kind !== "conductor" ||
    landings.length !== 1 ||
    landing?.kind !== "boundary-segment"
  )
    return;
  const a = owners.get(first.sourcePortId);
  const b = owners.get(second.sourcePortId);
  const target = owners.get(landing.targetPortId);
  if (
    a?.kind !== "symbol" ||
    b?.kind !== "symbol" ||
    target?.kind !== "symbol" ||
    target.deviceUid !== junction.terminal.deviceUid ||
    a === target ||
    b === target ||
    a.parentId === b.parentId ||
    a.locationGroupId !== junction.parentId ||
    b.locationGroupId !== junction.parentId ||
    target.locationGroupId !== junction.parentId
  )
    return;
  const returning = a.parentId === target.parentId ? first : second;
  if (a.parentId === target.parentId || b.parentId === target.parentId)
    return { first, second, target, returning, branches: [a, b] as const };
}

/** Find a two-arm fork whose join and physical landing make a cycle only
 * at the device-compound level. Port incidence supplies the whole pattern. */
export function controlReconvergence(
  graph: PresentationGraph,
  layout: NormalizedSchematicLayout,
): ControlReconvergence | undefined {
  if (layout.crossings.length === 0) return;
  const owners = new Map(
    graph.nodes.flatMap((node) =>
      node.ports.map(({ id }) => [id, node] as const),
    ),
  );
  const incoming = new Map(graph.edges.map((e) => [e.targetPortId, e]));
  const outgoing = new Map(graph.edges.map((e) => [e.sourcePortId, e]));
  for (const junction of graph.nodes) {
    if (junction.kind !== "junction" || junction.ports.length !== 3) continue;
    const arms = joinArms(junction, incoming, outgoing, owners);
    if (!arms) continue;
    const { first, second, target, returning, branches } = arms;
    const route = layout.edges.find(({ id }) => id === returning.id);
    const returnEdges = new Set(incident(target, outgoing).map(({ id }) => id));
    if (
      !route ||
      !backtracks(route.points, graph.view.flow) ||
      !layout.crossings.some(
        ({ edgeIds }) =>
          edgeIds.includes(returning.id) &&
          edgeIds.some((id) => returnEdges.has(id)),
      )
    )
      continue;
    const forkPort = forkArm(
      junction,
      branches,
      incoming,
      owners,
      graph.view.flow,
    );
    if (forkPort)
      return {
        junctionId: junction.id,
        deviceId: target.parentId,
        forkPortId: forkPort.id,
        incomingPorts: [first.targetPortId, second.targetPortId],
        returningEdgeId: returning.id,
      };
  }
}

export function orderControlArms(
  graph: PresentationGraph,
  join: ControlReconvergence,
): PresentationGraph {
  const [a, b] = join.incomingPorts;
  const opposite = {
    north: "south",
    south: "north",
    east: "west",
    west: "east",
  } as const;
  const flow = graph.view.flow;
  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      if (node.kind !== "junction") return node;
      const left = node.ports.find((p) => p.id === a);
      const right = node.ports.find((p) => p.id === b);
      return {
        ...node,
        ports: node.ports.map((p) => {
          const swap = p.id === a ? right : p.id === b ? left : undefined;
          const side = swap?.side ?? p.side;
          // Vertical contact lanes need the opposite lateral channel for the
          // parallel arms to hit the join without a long sideways crossing.
          return flow === "top-to-bottom" &&
            (swap || p.id === join.forkPortId) &&
            lateral(flow, side)
            ? { ...p, side: opposite[side] }
            : { ...p, side };
        }),
      };
    }),
  };
}

/** Only the adapter hierarchy changes. The real landing and both incoming
 * conductors keep the same identities, terminal centers and port ownership. */
export function placeControlJoin(input: ElkNode, join: ControlReconvergence) {
  const parent = input.children?.find((node) =>
    node.children?.some(({ id }) => id === join.junctionId),
  );
  const junction = parent?.children?.find(({ id }) => id === join.junctionId);
  const device = parent?.children?.find(({ id }) => id === join.deviceId);
  if (!parent?.children || !junction || !device?.children)
    throw Error("Control join is missing its adapter compound");
  parent.children = parent.children.filter((node) => node !== junction);
  device.children.push(junction);
}
