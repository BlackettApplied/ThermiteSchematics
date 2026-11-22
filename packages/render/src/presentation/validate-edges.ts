import type {
  PresentationGraph,
  PresentationPort,
  PresentationEdge,
} from "../types.js";
import type { ElectricalIr, ConductiveElementId } from "@thermite/compiler";
import {
  invariant,
  exactTerminalTuple,
  sameEndpointPair,
  sameTerminal,
} from "./util.js";
import { irConductorRecord } from "./conductors.js";

export function validateEdges(
  graph: Readonly<PresentationGraph>,
  portById: Map<string, PresentationPort>,
  ir: Readonly<ElectricalIr>,
  conductorCountByPort: Map<string, number>,
) {
  for (const edge of graph.edges) {
    invariant(edge.parentId === "root", `${edge.id} root edge parent`);
    const source = portById.get(edge.sourcePortId);
    const target = portById.get(edge.targetPortId);
    invariant(
      source !== undefined && target !== undefined,
      `${edge.id} ports exist`,
    );
    invariant(
      source.netId === edge.netId && target.netId === edge.netId,
      `${edge.id} port nets`,
    );
    validateConductorEdge(edge, ir, source, target, conductorCountByPort);
  }
}

function validateConductorEdge(
  edge: PresentationEdge,
  ir: Readonly<ElectricalIr>,
  source: PresentationPort,
  target: PresentationPort,
  conductorCountByPort: Map<string, number>,
) {
  if (edge.kind === "conductor") {
    invariant(edge.elementIds.length === 1, `${edge.id} one physical element`);
    const record = irConductorRecord(
      ir,
      edge.elementIds[0] as ConductiveElementId,
    );
    invariant(
      exactTerminalTuple(edge.endpoints, record.endpoints),
      `${edge.id} canonical endpoints`,
    );
    invariant(
      sameEndpointPair([source.terminal, target.terminal], record.endpoints),
      `${edge.id} visual endpoints preserve electrical truth`,
    );
    conductorCountByPort.set(
      source.id,
      (conductorCountByPort.get(source.id) ?? 0) + 1,
    );
    conductorCountByPort.set(
      target.id,
      (conductorCountByPort.get(target.id) ?? 0) + 1,
    );
  } else {
    invariant(
      edge.elementIds.length === 0,
      `${edge.id} no fabricated wire UID`,
    );
    invariant(
      sameTerminal(edge.endpoints[0], edge.endpoints[1]) &&
        sameTerminal(source.terminal, edge.endpoints[0]) &&
        sameTerminal(target.terminal, edge.endpoints[0]),
      `${edge.id} one presentation terminal`,
    );
  }
}
