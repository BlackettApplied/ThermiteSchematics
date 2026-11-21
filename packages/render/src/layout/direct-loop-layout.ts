import type { ElkExtendedEdge, ElkLabel, ElkNode } from "elkjs/lib/elk-api.js";
import { createElkEngine } from "./elk-runtime.js";
import { assertTopologyIdentities } from "./topology-conservation.js";
import {
  detachLoopLabels,
  placeLoopLabels,
  loopStaggerGap,
} from "./direct-loop-labels.js";
import { fragmentDefects } from "../packet/route-fragments.js";
import { required } from "../presentation/util.js";
import { isInlineLabelFailure } from "./inline-label-error.js";

/** The direct loop's declared fixed ports survive placement unchanged. */
export async function layoutDirectLoop(
  children: ElkNode[],
  edges: ElkExtendedEdge[],
  vertical: boolean,
  inlineEdgeIds: readonly string[] = [],
  validateLabels: (graph: ElkNode) => void = () => {},
  acceptCandidate: (candidate: ElkNode, fallback: ElkNode) => boolean = () =>
    true,
): Promise<ElkNode> {
  const input: ElkNode = {
    id: "loop",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": vertical ? "DOWN" : "RIGHT",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.layered.spacing.nodeNodeBetweenLayers": "8",
      "elk.spacing.edgeEdge": "6",
      "elk.spacing.edgeNode": "5",
      "elk.padding": "[top=6,left=6,bottom=6,right=6]",
      "elk.randomSeed": "1",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
    },
    children,
    edges: structuredClone(edges),
  };
  const expected = structuredClone(input);
  const labels = detachLoopLabels(input.edges ?? [], inlineEdgeIds);
  const graph = await createElkEngine().layout(input);
  assertTopologyIdentities(graph, expected);
  if (inlineEdgeIds.length === 0) return graph;
  try {
    placeLoopLabels(graph, labels);
    validateLabels(graph);
    return graph;
  } catch (error) {
    if (!isInlineLabelFailure(error)) throw error;
    // Retry the whole loop from its original graph, with every label in ELK.
    // Native paths from either attempt are never edited or mixed together.
    const fallback = await createElkEngine().layout(structuredClone(expected));
    assertTopologyIdentities(fallback, expected);
    if (!vertical || !hasLoopJogs(fallback, inlineEdgeIds)) return fallback;
    const accepts = (candidate: ElkNode) =>
      acceptCandidate(candidate, fallback);
    const staggered = tryLoopStaggers(graph, labels, validateLabels, accepts);
    if (staggered) return staggered;
    return spacedLoopCandidate(
      expected,
      labels,
      inlineEdgeIds,
      validateLabels,
      fallback,
      accepts,
    );
  }
}

function hasLoopJogs(graph: ElkNode, ids?: readonly string[]) {
  return (graph.edges ?? [])
    .filter((edge) => !ids || ids.includes(edge.id))
    .some((edge) =>
      (edge.sections ?? []).some(
        (section) =>
          fragmentDefects(
            [
              section.startPoint,
              ...(section.bendPoints ?? []),
              section.endPoint,
            ],
            1,
          ).jogs.length > 0,
      ),
    );
}

/** At most two label-only phases per graph; typed fit failures alone retry. */
function tryLoopStaggers(
  graph: ElkNode,
  labels: Map<string, ElkLabel[]>,
  validateLabels: (graph: ElkNode) => void,
  accepts: (candidate: ElkNode) => boolean,
) {
  if (hasLoopJogs(graph)) return undefined;
  for (const phase of [1, -1]) {
    try {
      placeLoopLabels(graph, labels, phase);
      validateLoopStagger(graph, labels, validateLabels);
      if (accepts(graph)) return graph;
    } catch (error) {
      if (!isInlineLabelFailure(error)) throw error;
    }
  }
  return undefined;
}

/** The emitter paints 0.4 mm wire strokes. Test a 0.2 mm expansion of each
 * inline box so a white background cannot shave a neighbouring stroke whose
 * centerline lies outside the box. Only the validation copy is expanded. */
function validateLoopStagger(
  graph: ElkNode,
  labels: Map<string, ElkLabel[]>,
  validateLabels: (graph: ElkNode) => void,
) {
  const clearance = structuredClone(graph);
  for (const edge of clearance.edges ?? []) {
    if (!labels.has(edge.id)) continue;
    edge.labels = (edge.labels ?? []).map((label) => ({
      ...label,
      x: required(label.x, "Missing loop label x") - 0.2,
      y: required(label.y, "Missing loop label y") - 0.2,
      width: required(label.width, "Missing loop label width") + 0.4,
      height: required(label.height, "Missing loop label height") + 0.4,
    }));
  }
  validateLabels(clearance);
}

async function spacedLoopCandidate(
  expected: ElkNode,
  labels: Map<string, ElkLabel[]>,
  inlineEdgeIds: readonly string[],
  validateLabels: (graph: ElkNode) => void,
  fallback: ElkNode,
  accepts: (candidate: ElkNode) => boolean,
) {
  try {
    // A single larger native layer gap gives adjacent 4.8 mm label boxes room
    // to alternate. No routed point, device dimension or fixed port is edited.
    const spaced = structuredClone(expected);
    detachLoopLabels(spaced.edges ?? [], inlineEdgeIds);
    spaced.layoutOptions = {
      ...spaced.layoutOptions,
      "elk.layered.spacing.nodeNodeBetweenLayers": String(
        loopStaggerGap(labels),
      ),
    };
    const candidate = await createElkEngine().layout(spaced);
    assertTopologyIdentities(candidate, expected);
    // Repairing a jog must not lengthen the loop's pagination axis.
    if ((candidate.height ?? Infinity) > (fallback.height ?? 0))
      return fallback;
    return (
      tryLoopStaggers(candidate, labels, validateLabels, accepts) ?? fallback
    );
  } catch (error) {
    if (!isInlineLabelFailure(error)) throw error;
    return fallback;
  }
}
