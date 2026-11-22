import type { ElkNode, ElkExtendedEdge } from "elkjs/lib/elk-api.js";
import type { ElectricalIr, IrFunction, TerminalId } from "@thermite/compiler";
import type {
  SelectedSubgraph,
  SymbolPresentationNode,
  PresentationGraph,
  PresentationPort,
  PresentationNode,
  SemanticAttachmentKind,
  PresentationEdge,
} from "../types.js";
import type { DeviceTypeSymbolMapping } from "../symbols/mappings.js";
import { functionIdKey, terminalIdKey } from "../ordering.js";
import { projectedCoilTerminalOwner } from "../selection/conservation.js";
import { sameTerminal } from "../internal.js";

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Presentation invariant: ${message}`);
}
const sameStringSet = (
  left: readonly string[],
  right: readonly string[],
): boolean =>
  new Set(left).size === new Set(right).size &&
  left.every((value) => right.includes(value)) &&
  right.every((value) => left.includes(value));

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

function validateProjectedTerminal(
  ir: Readonly<ElectricalIr>,
  selected: Readonly<SelectedSubgraph>,
  node: Readonly<SymbolPresentationNode>,
  mappings: readonly DeviceTypeSymbolMapping[],
): void {
  invariant(
    node.functionIds.length === 0,
    `${node.id} terminal context has no selected functions`,
  );
  invariant(
    node.symbolId === "ais:terminal" && node.classification === "terminal",
    `${node.id} terminal context symbol`,
  );
  invariant(
    node.ports.length === 2 &&
      node.ports[0]?.symbolPortId === "in" &&
      node.ports[1]?.symbolPortId === "out",
    `${node.id} terminal context display sides`,
  );
  const terminal = node.ports[0]?.terminal;
  invariant(terminal !== undefined, `${node.id} terminal context port`);
  invariant(
    node.ports.every((p) => sameTerminal(p.terminal, terminal)),
    `${node.id} same real terminal on both sides`,
  );
  const owner = selected.terminalOwners?.find((o) =>
    sameTerminal(o.terminal, terminal),
  );
  invariant(owner !== undefined, `${node.id} selected terminal context`);
  const actual = projectedCoilTerminalOwner(
    {
      ir,
      mappings,
      deviceByUid: new Map(ir.devices.map((d) => [d.uid, d])),
      deviceTypeById: new Map(ir.deviceTypes.map((t) => [t.id, t])),
      mappingByTypeId: new Map(mappings.map((m) => [m.typeId, m])),
      functionByKey: new Map(ir.functions.map((f) => [functionIdKey(f.id), f])),
    },
    selected,
    terminal,
  );
  invariant(
    actual !== undefined &&
      JSON.stringify(actual.ownerFunctionIds) ===
        JSON.stringify(owner.ownerFunctionIds),
    `${node.id} supported unselected input coil owner`,
  );
  invariant(
    node.labels.some(
      (l) =>
        l.text === "coil outside view" &&
        l.printableText === "coil outside view",
    ),
    `${node.id} terminal context caption`,
  );
}

export function assertSymbolTruth(
  ir: Readonly<ElectricalIr>,
  selected: Readonly<SelectedSubgraph>,
  node: Readonly<SymbolPresentationNode>,
  mappings: readonly DeviceTypeSymbolMapping[],
): void {
  const device = ir.devices.find(({ uid }) => uid === node.deviceUid);
  invariant(device !== undefined, `${node.id} device exists`);
  invariant(device.designation === node.designation, `${node.id} designation`);
  invariant(device.typeId === node.typeId, `${node.id} type`);
  const deviceType = ir.deviceTypes.find(({ id }) => id === device.typeId);
  invariant(deviceType !== undefined, `${node.id} device type exists`);
  const mapping = mappings.find(({ typeId }) => typeId === device.typeId);
  invariant(mapping !== undefined, `${node.id} mapping exists`);
  if (node.representation === "terminal") {
    validateProjectedTerminal(ir, selected, node, mappings);
    return;
  }
  if (node.representation === "function")
    assertFunctionTruth(ir, selected, node, mapping);
  else assertAggregateTruth(ir, selected, node, mapping);
}
function assertFunctionTruth(
  ir: Readonly<ElectricalIr>,
  selected: Readonly<SelectedSubgraph>,
  node: Readonly<SymbolPresentationNode>,
  mapping: DeviceTypeSymbolMapping,
): void {
  const portBySymbolId = new Map(
    node.ports.map((port) => [port.symbolPortId, port]),
  );
  invariant(node.functionIds.length === 1, `${node.id} one function`);
  const functionId = node.functionIds[0];
  invariant(functionId !== undefined, `${node.id} function id`);
  invariant(
    functionId.deviceUid === node.deviceUid,
    `${node.id} function owner`,
  );
  const rule = mapping.functions.find(
    ({ functionKey, families }) =>
      functionKey === functionId.functionKey &&
      families.includes(selected.view.family),
  );
  invariant(rule !== undefined, `${node.id} function mapping`);
  invariant(rule.symbolId === node.symbolId, `${node.id} symbol mapping`);
  invariant(
    rule.classification === node.classification,
    `${node.id} classification`,
  );
  const materialized = ir.functions.find(
    ({ id }) => functionIdKey(id) === functionIdKey(functionId),
  );
  invariant(materialized !== undefined, `${node.id} function exists`);
  invariant(
    sameStringSet(
      node.ports.map(({ terminal }) => terminal.terminalKey),
      materialized.terminals.map(({ terminalKey }) => terminalKey),
    ),
    `${node.id} required function terminal coverage`,
  );
  for (const binding of rule.bindings) {
    const port = portBySymbolId.get(binding.portId);
    invariant(port !== undefined, `${node.id} port binding ${binding.portId}`);
    invariant(
      port.terminal.terminalKey === binding.terminalKey,
      `${node.id} binding terminal`,
    );
    invariant(
      port.memberFunctionId !== undefined &&
        functionIdKey(port.memberFunctionId) === functionIdKey(functionId),
      `${node.id} member function`,
    );
  }
}
function assertAggregateTruth(
  ir: Readonly<ElectricalIr>,
  selected: Readonly<SelectedSubgraph>,
  node: Readonly<SymbolPresentationNode>,
  mapping: DeviceTypeSymbolMapping,
): void {
  const portBySymbolId = new Map(
    node.ports.map((port) => [port.symbolPortId, port]),
  );
  const rules = mapping.aggregates.filter(
    (rule) =>
      rule.families.includes(selected.view.family) &&
      rule.symbolId === node.symbolId &&
      rule.classification === node.classification &&
      sameStringSet(
        rule.functionKeys,
        node.functionIds.map(({ functionKey }) => functionKey),
      ),
  );
  invariant(rules.length === 1, `${node.id} aggregate mapping`);
  const rule = rules[0];
  invariant(rule !== undefined, `${node.id} aggregate rule`);
  const coveredByMember = new Map<string, string[]>();
  for (const binding of rule.bindings) {
    const port = portBySymbolId.get(binding.portId);
    invariant(
      port !== undefined,
      `${node.id} aggregate port ${binding.portId}`,
    );
    invariant(
      port.terminal.terminalKey === binding.terminalKey,
      `${node.id} aggregate terminal`,
    );
    invariant(
      port.memberFunctionId !== undefined &&
        port.memberFunctionId.deviceUid === node.deviceUid &&
        port.memberFunctionId.functionKey === binding.memberFunctionKey,
      `${node.id} aggregate member provenance`,
    );
    coveredByMember.set(binding.memberFunctionKey, [
      ...(coveredByMember.get(binding.memberFunctionKey) ?? []),
      binding.terminalKey,
    ]);
  }
  for (const functionKey of rule.functionKeys) {
    const materialized = ir.functions.find(
      ({ id }) =>
        id.deviceUid === node.deviceUid && id.functionKey === functionKey,
    );
    invariant(
      materialized !== undefined,
      `${node.id} aggregate member ${functionKey}`,
    );
    invariant(
      sameStringSet(
        coveredByMember.get(functionKey) ?? [],
        materialized.terminals.map(({ terminalKey }) => terminalKey),
      ),
      `${node.id} aggregate member terminal coverage ${functionKey}`,
    );
  }
}

function attachmentKind(
  ir: Readonly<ElectricalIr>,
  node: SymbolPresentationNode | import("../types.js").RailPresentationNode,
): SemanticAttachmentKind {
  if (node.kind === "rail") return "collapsed-boundary";
  if (node.representation === "terminal") return "terminal";
  if (node.representation === "aggregate") return "aggregate";
  const id = node.functionIds[0];
  invariant(id !== undefined, `${node.id} function attachment identity`);
  return ir.functions.find((f) => functionIdKey(f.id) === functionIdKey(id))
    ?.kind === "channel"
    ? "channel"
    : "function";
}

export function assertSemanticAttachments(
  ir: Readonly<ElectricalIr>,
  selected: Readonly<SelectedSubgraph>,
  graph: Readonly<PresentationGraph>,
  netByTerminal: ReadonlyMap<string, string>,
  portById: ReadonlyMap<string, PresentationPort>,
  ownerByPortId: ReadonlyMap<string, PresentationNode>,
): void {
  for (const { terminal } of selected.terminalOwners ?? []) {
    invariant(
      graph.nodes.filter(
        (n) =>
          n.kind === "symbol" &&
          n.representation === "terminal" &&
          n.ports.some((p) => sameTerminal(p.terminal, terminal)),
      ).length === 1,
      "selected terminal context conservation",
    );
  }

  for (const node of graph.nodes) {
    if (node.kind === "junction") continue;
    const expectedKind = attachmentKind(ir, node);
    const uniqueOwnerTerminals = new Set<string>();
    for (const attachment of node.attachments) {
      invariant(attachment.nodeId === node.id, `${node.id} attachment owner`);
      invariant(
        attachment.kind === expectedKind,
        `${node.id} exclusive attachment kind`,
      );
      const key = terminalIdKey(attachment.terminal);
      invariant(
        !uniqueOwnerTerminals.has(key),
        `${node.id} one incidence per terminal`,
      );
      uniqueOwnerTerminals.add(key);
      invariant(
        attachment.netId === netByTerminal.get(key),
        `${node.id} attachment net`,
      );
      invariant(
        attachment.portIds.length > 0 &&
          attachment.portIds.every(
            (portId) =>
              ownerByPortId.get(portId)?.id === node.id &&
              portById.get(portId)?.terminal.deviceUid ===
                attachment.terminal.deviceUid &&
              portById.get(portId)?.terminal.terminalKey ===
                attachment.terminal.terminalKey,
          ),
        `${node.id} attachment visual ports`,
      );
    }
    invariant(
      uniqueOwnerTerminals.size ===
        new Set(node.ports.map(({ terminal }) => terminalIdKey(terminal))).size,
      `${node.id} complete attachment incidence`,
    );
  }
}

type ControlJunctionRole = "P" | "Q" | "R" | "S";
interface ControlUse {
  readonly end: "source" | "target";
  readonly edge: Pick<PresentationEdge, "endpoints">;
}
/** The physical conductor order is stable; a same-device sibling is a separate arm. */
export function controlInputRoles(
  selected: Pick<SelectedSubgraph, "view" | "functionIds">,
  functions: ReadonlyMap<string, IrFunction>,
  uses: readonly ControlUse[],
  terminal: TerminalId,
):
  | {
      kind: "root" | "merge";
      conductors: readonly ControlJunctionRole[];
      attachment: ControlJunctionRole;
    }
  | undefined {
  const view = selected.view;
  if (view.format !== "schematic-view/0.1" || view.family !== "control")
    return undefined;
  const incoming = uses.filter((u) => u.end === "target"),
    outgoing = uses.filter((u) => u.end === "source");
  if (!(
    (incoming.length === 0 && outgoing.length === 2) ||
    (incoming.length === 2 && outgoing.length <= 1)
  ))
    return undefined;
  // The owner group may also contain an upstream contact. Keep that branch
  // opposite its owner attachment; do not confuse it with the straight route.
  const sibling = selected.functionIds.some(
    (id) =>
      id.deviceUid === terminal.deviceUid &&
      functions
        .get(functionIdKey(id))
        ?.terminals.every((t) => !sameTerminal(t, terminal)) === true,
  );
  const straight =
    (!sibling &&
      incoming.find((u) =>
        u.edge.endpoints.some(
          (t) =>
            t.deviceUid === view.root.deviceUid && !sameTerminal(t, terminal),
        ),
      )) ||
    incoming[0];
  return {
    kind: incoming.length === 0 ? "root" : "merge",
    conductors: uses.map((use) =>
      use.end === "source"
        ? outgoing.indexOf(use) === 0
          ? "P"
          : "Q"
        : use === straight
          ? "R"
          : sibling
            ? "S"
            : "Q",
    ),
    attachment:
      incoming.length === 0
        ? "R"
        : outgoing.length === 0
          ? "P"
          : sibling
            ? "Q"
            : "S",
  };
}

/** Rails may be the only visible representation of a device; diagnostics name it too. */
export function presentationDeviceNames(
  graph: Readonly<PresentationGraph>,
): ReadonlyMap<string, string> {
  return new Map([
    ...graph.deviceGroups.map((d) => [d.deviceUid, d.designation] as const),
    ...graph.nodes.flatMap((n) =>
      n.kind === "rail" ? [[n.deviceUid, n.designation] as const] : [],
    ),
  ]);
}
