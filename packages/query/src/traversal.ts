export interface BreadthFirstStep<Node, Edge> {
  readonly node: Node;
  readonly edge: Edge;
}

export interface BreadthFirstVisit<Node, Edge> {
  readonly node: Node;
  readonly hops: number;
  readonly via?: {
    readonly from: Node;
    readonly edge: Edge;
  };
}

/**
 * Internal ordered multi-source BFS. Callers supply already comparator-ordered
 * roots and steps. Marking happens on enqueue, so the first discovery fixes the
 * predecessor even when another path reaches the node at the same depth.
 */
export function breadthFirstTraversal<Node, Edge>(
  roots: readonly Node[],
  keyOf: (node: Node) => string,
  stepsFrom: (node: Node) => readonly BreadthFirstStep<Node, Edge>[],
): BreadthFirstVisit<Node, Edge>[] {
  const visits: BreadthFirstVisit<Node, Edge>[] = [];
  const seen = new Set<string>();

  for (const root of roots) {
    const key = keyOf(root);
    if (seen.has(key)) continue;
    seen.add(key);
    visits.push({ node: root, hops: 0 });
  }

  for (let cursor = 0; cursor < visits.length; cursor += 1) {
    const current = visits[cursor]!;
    for (const step of stepsFrom(current.node)) {
      const key = keyOf(step.node);
      if (seen.has(key)) continue;
      seen.add(key);
      visits.push({
        node: step.node,
        hops: current.hops + 1,
        via: { from: current.node, edge: step.edge },
      });
    }
  }

  return visits;
}
