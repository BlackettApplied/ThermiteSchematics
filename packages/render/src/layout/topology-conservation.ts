import type { ElkNode, ElkExtendedEdge } from "elkjs/lib/elk-api.js";

const sameIds = (
  actual: readonly { id: string }[],
  expected: readonly { id: string }[],
) =>
  actual.length === expected.length &&
  new Set(actual.map((x) => x.id)).size === actual.length &&
  expected.every((x) => actual.some((y) => y.id === x.id));

/** ELK may reorder output, but must conserve every selected source node, port and edge. */
export function assertTopologyIdentities(
  graph: ElkNode,
  expected: ElkNode,
): void {
  if (
    !sameIds(graph.children ?? [], expected.children ?? []) ||
    !sameIds(graph.edges ?? [], expected.edges ?? [])
  )
    throw new Error(
      "Topology layout did not conserve selected device and relation identities.",
    );
  for (const node of graph.children ?? []) {
    const source = expected.children!.find((n) => n.id === node.id)!;
    if (!sameIds(node.ports ?? [], source.ports ?? []))
      throw new Error(
        "Topology layout did not conserve selected port identities.",
      );
  }
  for (const node of graph.children ?? []) {
    const source = expected.children!.find((n) => n.id === node.id)!;
    if (
      ![node.width, node.height, source.width, source.height].every(
        Number.isFinite,
      ) ||
      Math.abs(node.width! - source.width!) > 0.01 ||
      Math.abs(node.height! - source.height!) > 0.01
    )
      throw new Error("Topology layout changed fixed device dimensions.");
    for (const port of node.ports ?? []) {
      const fixed = source.ports!.find((p) => p.id === port.id)!;
      if (
        ![port.x, port.y, fixed.x, fixed.y].every(Number.isFinite) ||
        Math.abs(port.x! - fixed.x!) > 0.01 ||
        Math.abs(port.y! - fixed.y!) > 0.01
      )
        throw new Error("Topology layout moved a fixed source port.");
    }
  }
  for (const edge of graph.edges ?? []) {
    const source = expected.edges!.find((e) => e.id === edge.id)!;
    if (
      JSON.stringify(edge.sources) !== JSON.stringify(source.sources) ||
      JSON.stringify(edge.targets) !== JSON.stringify(source.targets)
    )
      throw new Error(
        "Topology layout changed a relation's source port identities.",
      );
  }
}

/** A point-to-point route must begin/end on its named ports and keep sections connected. */
export function assertTopologyRouteEndpoints(graph: ElkNode): void {
  const points = new Map<string, { x: number; y: number }>();
  for (const node of graph.children ?? [])
    for (const port of node.ports ?? []) {
      if (![node.x, node.y, port.x, port.y].every(Number.isFinite))
        throw new Error("Topology port is unplaced.");
      points.set(port.id, { x: node.x! + port.x!, y: node.y! + port.y! });
    }
  const near = (
    a: { x: number; y: number } | undefined,
    b: { x: number; y: number } | undefined,
  ) =>
    !!a &&
    !!b &&
    [a.x, a.y, b.x, b.y].every(Number.isFinite) &&
    Math.hypot(a.x - b.x, a.y - b.y) <= 0.01;
  for (const edge of (graph.edges ?? []) as ElkExtendedEdge[]) {
    const sections = edge.sections ?? [];
    if (
      edge.sources.length !== 1 ||
      edge.targets.length !== 1 ||
      !sections.length ||
      !near(sections[0]!.startPoint, points.get(edge.sources[0]!)) ||
      !near(sections.at(-1)!.endPoint, points.get(edge.targets[0]!)) ||
      sections.some(
        (s, i) => i > 0 && !near(sections[i - 1]!.endPoint, s.startPoint),
      )
    )
      throw new Error(
        "Topology route moved away from its source ports or has disconnected sections.",
      );
  }
}
