import type { ElkNode, ElkExtendedEdge } from "elkjs/lib/elk-api.js";
import {
  assertTopologyIdentities,
  assertTopologyRouteEndpoints,
} from "./topology-conservation.js";
import { createElkEngine } from "./elk-runtime.js";
import { chooseIndependentWiring } from "./wiring-independent.js";

export async function layoutWiring(
  children: ElkNode[],
  edges: ElkExtendedEdge[],
  admit?: (candidate: ElkNode, original: ElkNode) => boolean,
  strokes?: ReadonlyMap<string, number>,
): Promise<ElkNode> {
  const owners = new Map(
    children.flatMap((node) => (node.ports ?? []).map((p) => [p.id, node.id])),
  );
  // ELK's network-simplex placer can emit diagonal fixed-port self-loops.
  // Keep the existing placer for that topology, without another layout attempt.
  const selfLoop = edges.some((e) =>
    e.sources.some((s) =>
      e.targets.some((t) => owners.get(s) === owners.get(t)),
    ),
  );
  // The caller declares whole-unit terminal rows before layout. In particular,
  // NETWORK_SIMPLEX must not silently quantize a fractional fixed port here.
  const input: ElkNode = {
    id: "wiring",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.spacing.nodeNode": "10",
      "elk.layered.spacing.nodeNodeBetweenLayers": "14",
      "elk.spacing.edgeNode": "5",
      "elk.spacing.edgeEdge": "5",
      "elk.layered.spacing.edgeEdgeBetweenLayers": "5",
      "elk.padding": "[top=5,left=5,bottom=5,right=5]",
      "elk.randomSeed": "1",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
      // Minimise branch length after measured tag headers displace the fixed
      // terminal rows. BK's compact alignment can loop a branch around its
      // sibling even though a shorter, fully orthogonal placement exists.
      "elk.layered.nodePlacement.strategy": selfLoop
        ? "BRANDES_KOEPF"
        : "NETWORK_SIMPLEX",
    },
    children,
    edges,
  };
  const expected = structuredClone(input);
  const engine = createElkEngine();
  const graph = await engine.layout(input);
  assertTopologyIdentities(graph, expected);
  assertTopologyRouteEndpoints(graph);
  return chooseIndependentWiring(expected, graph, engine, admit, strokes);
}
