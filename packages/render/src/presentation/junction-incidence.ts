import type {
  PresentationContext,
  EndpointUse,
  MutablePresentationEdge,
  ClosedTraceIncidence,
  ClosedRoleTemplate,
} from "./model.js";
import type { SymbolSide } from "../symbols/types.js";
import type {
  SemanticAttachment,
  SchematicFlow,
  PresentationPort,
  SymbolPresentationNode,
  RailPresentationNode,
  JunctionPresentationNode,
} from "../types.js";
import { orderedSelectedPaths, compareDirectLoadsUses } from "./paths.js";
import { conductorKey, required } from "./util.js";
import type { ConductiveElementId } from "@thermite/compiler";
import { symbolProfile } from "../symbols/profiles.js";
import { compareText } from "../ordering.js";
import {
  structuralSide,
  rootClosedTemplate,
  closedAssignment,
} from "./trace-roles.js";
import { edgeIdFor } from "./conductors.js";
import { controlInputRoles } from "../layout/topology-conservation.js";

export function primarySide(
  context: PresentationContext,
  direction: "incoming" | "outgoing",
): SymbolSide {
  if (context.selected.view.flow === "left-to-right") {
    return direction === "incoming" ? "west" : "east";
  }
  return direction === "incoming" ? "north" : "south";
}

export function counterClockwiseSide(side: SymbolSide): SymbolSide {
  switch (side) {
    case "east":
      return "north";
    case "north":
      return "west";
    case "west":
      return "south";
    case "south":
      return "east";
  }
}

export function isTwoArmLoadsSourceJunction(
  context: PresentationContext,
  uses: readonly EndpointUse[],
  attachments: readonly SemanticAttachment[],
): boolean {
  const view = context.selected.view;
  if (
    view.format !== "schematic-view/0.2" ||
    view.intent !== "loads" ||
    view.root.kind !== "device" ||
    !("deviceUid" in view.root)
  ) {
    return false;
  }
  const rootDeviceUid = view.root.deviceUid;
  return (
    uses.length === 2 &&
    uses.every(
      ({ end, terminal }) =>
        end === "source" && terminal.deviceUid === rootDeviceUid,
    ) &&
    attachments.length === 1
  );
}

export function traceSignalStepRank(
  context: PresentationContext,
  edge: MutablePresentationEdge,
): number {
  const signal = orderedSelectedPaths(context).find(
    ({ lane }) => lane === "signal",
  );
  if (signal === undefined || edge.elementIds.length !== 1) {
    return Number.MAX_SAFE_INTEGER;
  }
  const key = conductorKey(edge.elementIds[0] as ConductiveElementId);
  return signal.steps.findIndex(
    (step) => step.kind === "conductor" && conductorKey(step.elementId) === key,
  );
}

export function isTwoLanePnpTraceSignalJunction(
  context: PresentationContext,
  uses: readonly EndpointUse[],
  attachments: readonly SemanticAttachment[],
): boolean {
  const view = context.selected.view;
  if (
    view.format !== "schematic-view/0.2" ||
    view.intent !== "trace" ||
    view.root.kind !== "device" ||
    !("deviceUid" in view.root) ||
    symbolProfile(
      context.ir.deviceTypes.find(
        (t) => t.id === context.deviceByUid.get(view.root.deviceUid)?.typeId,
      ) ?? {},
    ) !== "thermite:sensor-3wire" ||
    uses.length !== 2 ||
    attachments.length !== 1 ||
    (uses[0] as EndpointUse).end !== (uses[1] as EndpointUse).end
  ) {
    return false;
  }
  const ranks = uses.map(({ edge }) => traceSignalStepRank(context, edge));
  return (
    ranks.every((rank) => rank >= 0) && new Set(ranks).size === ranks.length
  );
}

export function portForEndpointUse(
  attachment: SemanticAttachment,
  use: EndpointUse,
  portById: ReadonlyMap<string, PresentationPort>,
  nodeById: ReadonlyMap<string, SymbolPresentationNode | RailPresentationNode>,
): PresentationPort {
  const node = required(
    nodeById.get(attachment.nodeId),
    `Attachment owner ${attachment.nodeId} is missing.`,
  );
  if (node.kind === "symbol" && node.symbolId === "ais:terminal") {
    const wanted = use.end === "target" ? "in" : "out";
    const terminalPort = attachment.portIds
      .map((portId) => portById.get(portId))
      .find((port) => port?.symbolPortId === wanted);
    if (terminalPort !== undefined) return terminalPort;
  }
  return required(
    portById.get(attachment.portIds[0] as string),
    `Attachment ${attachment.nodeId} has no visual port.`,
  );
}

export function terminalPassThroughException(
  attachments: readonly SemanticAttachment[],
  uses: readonly EndpointUse[],
  assignments: readonly PresentationPort[],
  nodeById: ReadonlyMap<string, SymbolPresentationNode | RailPresentationNode>,
): boolean {
  if (attachments.length !== 1 || uses.length > 2) return false;
  const node = nodeById.get((attachments[0] as SemanticAttachment).nodeId);
  if (node?.kind !== "symbol" || node.symbolId !== "ais:terminal") {
    return false;
  }
  const counts = new Map<string, number>();
  for (const port of assignments)
    counts.set(port.id, (counts.get(port.id) ?? 0) + 1);
  return [...counts.values()].every((count) => count <= 1);
}

export function incidentVisibleNodeIds(
  terminalKey: string,
  uses: readonly EndpointUse[],
  attachments: ReadonlyMap<string, readonly SemanticAttachment[]>,
  endpointUses: ReadonlyMap<string, readonly EndpointUse[]>,
): readonly string[] {
  const ids = new Set(
    (attachments.get(terminalKey) ?? []).map(({ nodeId }) => nodeId),
  );
  for (const use of uses) {
    for (const [otherKey, otherUses] of endpointUses) {
      if (otherKey === terminalKey) continue;
      if (otherUses.some(({ edge }) => edge.id === use.edge.id)) {
        for (const attachment of attachments.get(otherKey) ?? [])
          ids.add(attachment.nodeId);
      }
    }
  }
  return [...ids].sort(compareText);
}

export function junctionParentId(
  nodeIds: readonly string[],
  nodeById: ReadonlyMap<string, SymbolPresentationNode | RailPresentationNode>,
): JunctionPresentationNode["parentId"] {
  if (nodeIds.length === 0) {
    throw new Error("A junction has no incident visible endpoint node.");
  }
  const chains = nodeIds.map((nodeId) => {
    const node = required(
      nodeById.get(nodeId),
      `Junction endpoint node ${nodeId} is missing.`,
    );
    return node.kind === "rail"
      ? (["root"] as const)
      : (["root", node.locationGroupId, node.deviceGroupId] as const);
  });
  let parent: JunctionPresentationNode["parentId"] = "root";
  const limit = Math.min(...chains.map(({ length }) => length));
  for (let index = 1; index < limit; index++) {
    const candidate = (
      chains[0] as readonly ["root"] | readonly ["root", string, string]
    )[index];
    if (
      candidate !== undefined &&
      chains.every((chain) => chain[index] === candidate)
    ) {
      parent = candidate;
    } else {
      break;
    }
  }
  return parent;
}

export function attachmentPort(
  attachment: SemanticAttachment,
  portById: ReadonlyMap<string, PresentationPort>,
): PresentationPort {
  return required(
    portById.get(attachment.portIds[0] as string),
    "Boundary attachment has no visual port.",
  );
}

/** A high-degree source terminal is a chain of four-way presentation junctions.
 * Links retain this exact compiler terminal and have no physical element IDs. */
export function loadSourceIncidence(
  context: PresentationContext,
  uses: readonly EndpointUse[],
  attachments: readonly SemanticAttachment[],
  portById: ReadonlyMap<string, PresentationPort>,
): ClosedTraceIncidence | undefined {
  const view = context.selected.view;
  if (
    !("intent" in view) ||
    view.intent !== "loads" ||
    uses.length < 3 ||
    attachments.length !== 1 ||
    uses.some((use) => use.end !== "source")
  )
    return undefined;
  const orderedUses = [...uses].sort(
    (a, b) =>
      compareDirectLoadsUses(context, a, b) ||
      context.order.compare(a.edge.id, b.edge.id),
  );
  const outputs = orderedUses.map((use, stableRank) => ({
    id: use.edge.id,
    from: "",
    to: "",
    stableRank,
  }));
  const flow = view.flow;
  let template = loadSourceTemplate(outputs, flow);
  if (
    attachmentPort(attachments[0] as SemanticAttachment, portById)
      .symbolPortId === "return"
  ) {
    const q = structuralSide(flow, "Q"),
      s = structuralSide(flow, "S");
    template = {
      ...template,
      components: template.components.map((c) => ({
        ...c,
        assignments: c.assignments.map((a) => ({
          ...a,
          side: a.side === q ? s : a.side === s ? q : a.side,
        })),
      })),
    };
  }
  return { orderedUses, template };
}

function loadSourceTemplate(
  outputs: { id: string; from: string; to: string; stableRank: number }[],
  flow: SchematicFlow,
) {
  let template: ClosedRoleTemplate;
  if (outputs.length <= 4) template = rootClosedTemplate(flow, outputs);
  else {
    const components: ClosedRoleTemplate["components"][number][] = [];
    for (let offset = 0; offset < outputs.length; offset += 2) {
      const index = offset / 2;
      const last = offset + 2 >= outputs.length;
      const assignments = outputs
        .slice(offset, offset + 2)
        .map((edge, i) =>
          closedAssignment(
            flow,
            { kind: "edge", edgeId: edge.id },
            i === 0 ? "P" : index === 0 ? "Q" : "S",
            i,
          ),
        );
      assignments.push(
        closedAssignment(
          flow,
          index === 0
            ? { kind: "attachment" }
            : { kind: "link-in", index: index - 1 },
          index === 0 ? "R" : "Q",
          assignments.length,
        ),
      );
      if (!last)
        assignments.push(
          closedAssignment(
            flow,
            { kind: "link-out", index },
            index === 0 ? "S" : "R",
            assignments.length,
          ),
        );
      components.push({ index, assignments });
    }
    template = { kind: "root", components };
  }
  return template;
}

/** Distinct arms at an authored control-input split or merge; no extra selection. */
export function actuationIncidence(
  context: PresentationContext,
  uses: readonly EndpointUse[],
  attachments: readonly SemanticAttachment[],
): ClosedTraceIncidence | undefined {
  const view = context.selected.view;
  if (
    view.format !== "schematic-view/0.1" ||
    view.family !== "control" ||
    attachments.length !== 1
  )
    return undefined;
  const inputs = new Set(
    context.selected.paths
      .filter((p) => p.lane === "input")
      .flatMap((p) =>
        p.steps
          .filter((s) => s.kind === "conductor")
          .map((s) => edgeIdFor(s.elementId)),
      ),
  );
  if (!uses.every((u) => inputs.has(u.edge.id))) return undefined;
  const roles = controlInputRoles(
    context.selected,
    context.functionByKey,
    uses,
    required(attachments[0], "Missing actuation terminal owner").terminal,
  );
  if (roles === undefined) return undefined;
  const assignments = uses.map((use, order) =>
    closedAssignment(
      view.flow,
      { kind: "edge", edgeId: use.edge.id },
      required(roles.conductors[order], "Missing actuation arm"),
      order,
    ),
  );
  assignments.push(
    closedAssignment(
      view.flow,
      { kind: "attachment" },
      roles.attachment,
      uses.length,
    ),
  );
  return {
    orderedUses: uses,
    template: { kind: roles.kind, components: [{ index: 0, assignments }] },
  };
}
