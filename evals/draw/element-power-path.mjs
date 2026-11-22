function link(from, to) {
  const forward = { to, open: true };
  const reverse = { to: from, open: false, reverse: forward };
  forward.reverse = reverse;
  from.push(forward);
  to.push(reverse);
}

function augment(start, end) {
  const enteredBy = new Map([[start, null]]),
    queue = [start];
  for (const at of queue) {
    if (at === end) break;
    for (const arc of at) {
      if (!arc.open || enteredBy.has(arc.to)) continue;
      enteredBy.set(arc.to, arc);
      queue.push(arc.to);
    }
  }
  if (!enteredBy.has(end)) return false;
  for (let at = end; at !== start;) {
    const arc = enteredBy.get(at);
    arc.open = false;
    arc.reverse.open = true;
    at = arc.reverse.to;
  }
  return true;
}

// Removing the candidate edge leaves two legs: one to the root and one to a
// source. They must be vertex-disjoint or joining them repeats a terminal,
// as it would on a side loop attached to the corridor at a single bus junction.
export function onRootedPowerPath(topology, reached, root, candidate) {
  const vertices = new Map([...reached].map((k) => [k, { in: [], out: [] }]));
  const origin = [],
    supply = [],
    destination = [];
  for (const [key, node] of vertices) {
    // A unit-capacity split keeps both legs from using the same terminal.
    link(node.in, node.out);
    if (key === root) link(node.out, destination);
    else if (topology.sources.has(key)) link(node.out, supply);
    else
      for (const { to, edge } of topology.graph.get(key) ?? [])
        if (edge !== candidate && vertices.has(to))
          link(node.out, vertices.get(to).in);
  }
  for (const key of candidate.keys) link(origin, vertices.get(key).in);
  link(supply, destination);
  // One leg must finish at each destination. Residual arcs let the second
  // search reroute the first leg if its initial choice used a shared terminal.
  return augment(origin, destination) && augment(origin, destination);
}
