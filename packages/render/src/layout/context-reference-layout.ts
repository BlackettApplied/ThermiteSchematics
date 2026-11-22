import type {
  LayoutContextReference,
  LayoutPort,
  PresentationGraph,
  PresentationNode,
} from "../types.js";
import {
  terminalContextAttachment,
  contextReferenceLeader,
} from "../terminal-context-reference.js";
import { contextJunctionInk } from "./context-reference-ink.js";

type Fail = (message: string, netId?: string) => never;
export function validateLeafSize(
  graph: Readonly<PresentationGraph>,
  node: PresentationNode | undefined,
  width: number,
  height: number,
  reject: Fail,
) {
  if (!node) return;
  if (node.kind === "junction") {
    const ink = contextJunctionInk(graph, node);
    if (width !== ink.width || height !== ink.height)
      reject(`junction node ${node.id} dimensions changed`, node.netId);
  } else if (width !== node.width || height !== node.height)
    reject(`leaf node ${node.id} dimensions changed`);
}

export function validateReferenceInput(
  graph: Readonly<PresentationGraph>,
  edges: Pick<ReadonlyMap<string, unknown>, "size" | "has">,
  labels: ReadonlyMap<
    string,
    { ownerKind: string; ownerId: string; label: { x?: number; y?: number } }
  >,
  invariant: (condition: unknown, message: string) => void,
) {
  const routed = graph.edges.filter(
    (e) => !terminalContextAttachment(graph, e),
  );
  invariant(
    edges.size === routed.length && routed.every((e) => edges.has(e.id)),
    "adapter routed edges do not match presentation conductors and attachments",
  );
  for (const node of graph.nodes)
    if (node.kind === "junction")
      for (const { label, x, y } of contextJunctionInk(graph, node).labels) {
        const supplied = labels.get(label.id);
        invariant(
          supplied?.ownerKind === "node" &&
            supplied.ownerId === node.id &&
            supplied.label.x === x &&
            supplied.label.y === y,
          "adapter reference label is outside its reserved junction ink",
        );
      }
}

export function contextReferenceLayouts(
  graph: Readonly<PresentationGraph>,
  ports: ReadonlyMap<string, LayoutPort>,
  reject: Fail,
): LayoutContextReference[] {
  return graph.edges.flatMap((edge) => {
    if (!terminalContextAttachment(graph, edge)) return [];
    const source = ports.get(edge.sourcePortId),
      target = ports.get(edge.targetPortId);
    if (!source || !target)
      reject(`context reference ${edge.id} lost a real port`);
    return [
      {
        id: edge.id,
        sourcePortId: edge.sourcePortId,
        targetPortId: edge.targetPortId,
        leaders: [
          contextReferenceLeader(source),
          contextReferenceLeader(target),
        ] as const,
      },
    ];
  });
}
