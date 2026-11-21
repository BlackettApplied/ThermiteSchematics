import { nativeContactRole } from "./contact-role-oracle.mjs";
import { onRootedPowerPath } from "./element-power-path.mjs";
import { terminalId } from "./tranche4-source.mjs";
export class RootedTopologyUnavailable extends Error {}
const valid = (t) =>
  t && typeof t.deviceUid === "string" && typeof t.terminalKey === "string";
export function nativePowerTopology(ir) {
  if (
    !["wires", "jumpers", "cableConductors", "deviceTypes"].every((k) =>
      Array.isArray(ir[k]),
    )
  )
    throw new RootedTopologyUnavailable(
      "Native conductor/type arrays unavailable",
    );
  const graph = new Map(),
    edges = [];
  const add = (ends, fn) => {
    if (ends.length !== 2 || !ends.every(valid))
      throw new RootedTopologyUnavailable(
        "Native topology endpoints unavailable",
      );
    const keys = ends.map(terminalId),
      edge = { keys, fn };
    edges.push(edge);
    for (const [i, k] of keys.entries()) {
      if (!graph.has(k)) graph.set(k, []);
      graph.get(k).push({ to: keys[1 - i], edge });
    }
  };
  for (const w of [...ir.wires, ...ir.jumpers, ...ir.cableConductors])
    add((w.endpoints ?? []).map((e) => e?.terminal));
  for (const fn of ir.functions) {
    if (!Array.isArray(fn.terminals) || !fn.terminals.every(valid))
      throw new RootedTopologyUnavailable(
        "Native function terminals unavailable",
      );
    const d = ir.devices.find((d) => d.uid === fn.id.deviceUid),
      type = ir.deviceTypes.find((t) => t.id === d?.typeId);
    if (!type)
      throw new RootedTopologyUnavailable("Native function type unavailable");
    const role = nativeContactRole(ir, fn).role;
    const power =
      fn.terminals.length === 2 &&
      fn.terminals.every((t) =>
        type.terminals?.some(
          (p) =>
            p.key === t.terminalKey &&
            /^power_(input|output)$/.test(p.role ?? ""),
        ),
      );
    // Symbolic traversal only: functions never join or alter electrical nets.
    if (
      fn.terminals.length === 2 &&
      (["overload", "breaker", "fuse"].includes(role) ||
        (role === "contact" && power))
    )
      add(fn.terminals, fn);
  }
  const sources = new Set(
    ir.functions
      .filter((f) => f.kind === "source")
      .flatMap((f) => f.terminals.map(terminalId)),
  );
  for (const p of ir.potentials ?? [])
    if (valid(p.terminal) && p.electrical?.polarity !== "protective_earth")
      sources.add(terminalId(p.terminal));
  return { graph, edges, sources };
}
function reachable({ graph, sources }, start, skip) {
  const seen = new Set([start]),
    queue = [start];
  for (const from of queue) {
    // Record the source as reached, then stop before following its other loads.
    if (sources.has(from)) continue;
    for (const { to, edge } of graph.get(from) ?? [])
      if (edge !== skip && !seen.has(to)) {
        seen.add(to);
        queue.push(to);
      }
  }
  return seen;
}

function detachedProtectionEdges(ir, topology, reached) {
  return topology.edges.filter(
    ({ fn, keys }) =>
      fn &&
      keys.every((k) => reached.has(k)) &&
      keys.some((k) => !topology.sources.has(k)) &&
      ["overload", "breaker", "fuse"].includes(
        nativeContactRole(ir, fn).role,
      ) &&
      ir.functions.some(
        (f) =>
          f.id.deviceUid === fn.id.deviceUid &&
          nativeContactRole(ir, f).role === "contact",
      ),
  );
}

export function rootedProtectionNeeds(ir, root, topology) {
  const starts = ir.functions
    .filter((f) => f.id.deviceUid === root.uid && f.kind === "load")
    .flatMap((f) => f.terminals);
  if (!starts.length)
    throw new RootedTopologyUnavailable(
      "Native rooted load terminals unavailable",
    );
  const needs = new Map();
  for (const start of starts) {
    const key = terminalId(start),
      all = reachable(topology, key),
      sources = [...topology.sources].filter((k) => all.has(k)),
      candidates = detachedProtectionEdges(ir, topology, all);
    if (!sources.length) {
      // A wired segment can end at a nonconductive stage. With a declared
      // supply elsewhere and no local protection candidate there is no need
      // to judge. Never infer continuity or a pin mapping through the stage.
      if (all.size > 1 && topology.sources.size && !candidates.length) continue;
      throw new RootedTopologyUnavailable(
        "Native root-to-source topology unavailable",
      );
    }
    for (const edge of candidates) {
      const { fn } = edge;
      const remaining = reachable(topology, key, edge),
        mandatory = !sources.some((s) => remaining.has(s));
      if (!mandatory && !onRootedPowerPath(topology, all, key, edge)) continue;
      const id = JSON.stringify(fn.id),
        previous = needs.get(id);
      if (!previous || mandatory)
        needs.set(id, { fn, rootTerminal: start, sources, mandatory });
    }
  }
  return [...needs.values()];
}
