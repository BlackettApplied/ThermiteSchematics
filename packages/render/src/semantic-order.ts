import type { ConductiveElementId, ElectricalIr } from "@thermite/compiler";
import { compareText, structuralTupleId } from "./ordering.js";
import type { PresentationGraph } from "./types.js";

/** Identity is kept verbatim. Only the comparison key substitutes authored names.
 * Nested tuples (ports, junctions, labels) inherit the same semantic comparison. */
export interface SemanticOrder {
  key(identity: string): string;
  compare(left: string, right: string): number;
}

/** Preserve the compiler's authored kind rank; replace only instance keys. */
export function compareSemanticElementIds(
  order: SemanticOrder,
  left: ConductiveElementId,
  right: ConductiveElementId,
): number {
  const rank = { wire: 0, jumper: 1, cable_conductor: 2 } as const;
  const identity = (id: ConductiveElementId) =>
    id.kind === "cable_conductor"
      ? structuralTupleId(id.kind, id.cableUid, id.conductorId)
      : structuralTupleId(id.kind, id.uid);
  return (
    rank[left.kind] - rank[right.kind] ||
    order.compare(identity(left), identity(right))
  );
}

function semanticOrder(names: ReadonlyMap<string, string>): SemanticOrder {
  const cache = new Map<string, string>();
  const key = (identity: string): string => {
    const known = names.get(identity) ?? cache.get(identity);
    if (known !== undefined) return known;
    let value = identity;
    if (identity.startsWith("[")) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(identity);
      } catch {
        cache.set(identity, identity);
        return identity;
      }
      if (Array.isArray(parsed)) {
        const parts = [...parsed] as unknown[];
        const map = (index: number) => {
          if (typeof parts[index] === "string")
            parts[index] = key(parts[index]);
        };
        // Only identity positions are substituted. An authored terminal,
        // function or port key may itself happen to look like an instance UID.
        if (
          parts.length === 2 &&
          typeof parts[0] === "string" &&
          names.has(parts[0])
        )
          map(0);
        else
          switch (parts[0]) {
            case "location":
              break;
            case "function":
              map(1);
              if (parts.length >= 5) {
                map(2);
                map(3);
              }
              break;
            case "conductor":
              map(1);
              map(2);
              map(3);
              map(4);
              break;
            case "junction":
              map(1);
              map(2);
              break;
            case "junction-comb":
              map(1);
              break;
            case "port":
              map(1);
              if (parts[2] === "conductor" || parts[2] === "attachment") map(3);
              break;
            case "label":
              map(2);
              break;
            case "boundary-segment":
              map(1);
              if (typeof parsed[1] === "string" && parsed[1].startsWith("[")) {
                if (typeof parts[2] === "string" && parts[2].startsWith("["))
                  map(2);
              } else {
                map(3);
                map(4);
              }
              break;
            case "aggregate":
            case "device":
            case "rail":
            case "terminal":
            case "wire":
            case "jumper":
            case "cable":
            case "cable-conductor":
            case "cable_conductor":
            case "net":
            case "potential":
            case "clip":
            case "boundary":
              map(1);
              break;
          }
        value = JSON.stringify(parts);
      }
    }
    cache.set(identity, value);
    return value;
  };
  return { key, compare: (left, right) => compareText(key(left), key(right)) };
}

export function irSemanticOrder(ir: Readonly<ElectricalIr>): SemanticOrder {
  const names = new Map<string, string>(
    [...ir.devices, ...ir.wires, ...ir.cables].map((o) => [
      o.uid,
      o.designation,
    ]),
  );
  const terminal = (t: { deviceUid: string; terminalKey: string }) =>
    JSON.stringify([names.get(t.deviceUid), t.terminalKey]);
  for (const jumper of ir.jumpers)
    names.set(
      jumper.uid,
      jumper.designation ??
        JSON.stringify([
          ...jumper.endpoints
            .map((e) => terminal(e.terminal))
            .sort(compareText),
          jumper.source.file,
          jumper.source.jsonPointer,
        ]),
    );
  for (const net of ir.nets)
    names.set(
      net.id,
      JSON.stringify(net.terminalIds.map(terminal).sort(compareText)),
    );
  for (const potential of ir.potentials)
    names.set(
      potential.uid,
      JSON.stringify([
        potential.name,
        potential.designation ?? "",
        terminal(potential.terminal),
        potential.source.file,
        potential.source.jsonPointer,
      ]),
    );
  return semanticOrder(names);
}

export function graphSemanticOrder(
  graph: Readonly<PresentationGraph>,
): SemanticOrder {
  const names = new Map<string, string>(
    graph.deviceGroups.map((g) => [g.deviceUid, g.designation]),
  );
  for (const node of graph.nodes)
    if (node.kind !== "junction") names.set(node.deviceUid, node.designation);
  const terminals = new Map<string, Set<string>>();
  const terminal = (
    id: string,
    t: { deviceUid: string; terminalKey: string },
  ) => {
    const values = terminals.get(id) ?? new Set<string>();
    values.add(JSON.stringify([names.get(t.deviceUid), t.terminalKey]));
    terminals.set(id, values);
  };
  for (const node of graph.nodes)
    for (const port of node.ports) terminal(port.netId, port.terminal);
  for (const edge of graph.edges) {
    for (const t of edge.endpoints) terminal(edge.netId, t);
    const c = edge.conductor;
    if (c !== undefined) {
      if (c.kind === "cable-conductor")
        names.set(c.cableUid, c.cableDesignation);
      else names.set(c.uid, edge.authoredOrderKey ?? c.designation);
    }
  }
  for (const [id, values] of terminals)
    names.set(id, JSON.stringify([...values].sort(compareText)));
  return semanticOrder(names);
}
