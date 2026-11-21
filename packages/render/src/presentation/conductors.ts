import type {
  ElectricalIr,
  TerminalId,
  IrDevice,
  ConductiveElementId,
} from "@thermite/compiler";
import {
  compareTerminalId,
  structuralTupleId,
  compareText,
  terminalIdKey,
} from "../ordering.js";
import {
  cloneTerminal,
  required,
  cloneElement,
  conductorKey,
  presentationLabel,
  textSource,
  sameEndpointPair,
  sameTerminal,
} from "./util.js";
import type {
  IrConductorRecord,
  PresentationContext,
  BuiltConductors,
  MutablePresentationEdge,
  EndpointUse,
} from "./model.js";
import type {
  PresentationLabel,
  PresentationEdge,
  SelectedConductorStep,
  SelectedPath,
} from "../types.js";
import { orderedSelectedPaths } from "./paths.js";
import { netForTerminal } from "./node-labels.js";
import { designationFor } from "./util.js";
import { compareSemanticElementIds } from "../semantic-order.js";

function canonicalConductorEndpoints(
  ir: Readonly<ElectricalIr>,
  left: TerminalId,
  right: TerminalId,
): readonly [TerminalId, TerminalId] {
  return compareTerminalId(
    left,
    right,
    (uid) => (ir.devices.find((d) => d.uid === uid) as IrDevice).designation,
  ) <= 0
    ? [cloneTerminal(left), cloneTerminal(right)]
    : [cloneTerminal(right), cloneTerminal(left)];
}

export function irConductorRecord(
  ir: Readonly<ElectricalIr>,
  elementId: ConductiveElementId,
): IrConductorRecord {
  switch (elementId.kind) {
    case "wire": {
      const wire = required(
        ir.wires.find(({ uid }) => uid === elementId.uid),
        `Selected wire ${elementId.uid} is missing.`,
      );
      return {
        id: cloneElement(elementId),
        endpoints: canonicalConductorEndpoints(
          ir,
          wire.endpoints[0].terminal,
          wire.endpoints[1].terminal,
        ),
      };
    }
    case "jumper": {
      const jumper = required(
        ir.jumpers.find(({ uid }) => uid === elementId.uid),
        `Selected jumper ${elementId.uid} is missing.`,
      );
      return {
        id: cloneElement(elementId),
        endpoints: canonicalConductorEndpoints(
          ir,
          jumper.endpoints[0].terminal,
          jumper.endpoints[1].terminal,
        ),
      };
    }
    case "cable_conductor": {
      const conductor = required(
        ir.cableConductors.find(
          ({ id }) =>
            id.cableUid === elementId.cableUid &&
            id.conductorId === elementId.conductorId,
        ),
        `Selected cable conductor ${conductorKey(elementId)} is missing.`,
      );
      return {
        id: cloneElement(elementId),
        endpoints: canonicalConductorEndpoints(
          ir,
          conductor.endpoints[0].terminal,
          conductor.endpoints[1].terminal,
        ),
      };
    }
  }
}

function conductorLabel(
  context: PresentationContext,
  elementId: ConductiveElementId,
  edgeId: string,
): PresentationLabel {
  switch (elementId.kind) {
    case "wire": {
      const wire = required(
        context.ir.wires.find(({ uid }) => uid === elementId.uid),
        `Selected wire ${elementId.uid} is missing.`,
      );
      const propertiesLabel = wire.properties?.label;
      return presentationLabel(
        "edge",
        edgeId,
        "conductor",
        propertiesLabel ?? wire.designation,
        [
          textSource(
            "wire",
            [wire.uid],
            propertiesLabel === undefined
              ? "wire.designation"
              : "wire.properties.label",
            propertiesLabel ?? wire.designation,
          ),
        ],
      );
    }
    case "jumper": {
      const jumper = required(
        context.ir.jumpers.find(({ uid }) => uid === elementId.uid),
        `Selected jumper ${elementId.uid} is missing.`,
      );
      return presentationLabel(
        "edge",
        edgeId,
        "conductor",
        jumper.designation ?? "Jumper",
        jumper.designation === undefined
          ? []
          : [
              textSource(
                "jumper",
                [jumper.uid],
                "jumper.designation",
                jumper.designation,
              ),
            ],
      );
    }
    case "cable_conductor": {
      return cableConductorLabel(context, elementId, edgeId);
    }
  }
}

function cableConductorLabel(
  context: PresentationContext,
  elementId: Extract<ConductiveElementId, { kind: "cable_conductor" }>,
  edgeId: string,
): PresentationLabel {
  const cable = required(
    context.ir.cables.find(({ uid }) => uid === elementId.cableUid),
    `Selected cable ${elementId.cableUid} is missing.`,
  );
  if (
    context.selected.view.format === "schematic-view/0.2" &&
    context.selected.view.intent === "conductors"
  ) {
    return detailedCableConductorLabel(context, elementId, edgeId, cable);
  }
  return presentationLabel(
    "edge",
    edgeId,
    "conductor",
    `${cable.designation}.${elementId.conductorId}`,
    [
      textSource(
        "cable-conductor",
        [elementId.cableUid, elementId.conductorId],
        "cable.designation",
        cable.designation,
      ),
      textSource(
        "cable-conductor",
        [elementId.cableUid, elementId.conductorId],
        "cable.conductor.id",
        elementId.conductorId,
      ),
    ],
  );
}

function detailedCableConductorLabel(
  context: PresentationContext,
  elementId: Extract<ConductiveElementId, { kind: "cable_conductor" }>,
  edgeId: string,
  cable: ElectricalIr["cables"][number],
): PresentationLabel {
  const conductor = required(
    context.ir.cableConductors.find(
      ({ id }) =>
        id.cableUid === elementId.cableUid &&
        id.conductorId === elementId.conductorId,
    ),
    `Selected cable conductor ${conductorKey(elementId)} is missing.`,
  );
  const metadata = required(
    conductor.typeConductor ?? undefined,
    `Selected cable conductor ${conductorKey(elementId)} has no authored type metadata.`,
  );
  const ownerParts = [elementId.cableUid, elementId.conductorId];
  const sizeSuffix = metadata.size === undefined ? "" : ` · ${metadata.size}`;
  return presentationLabel(
    "edge",
    edgeId,
    "conductor",
    `${cable.designation}.${elementId.conductorId} · ${metadata.color}${sizeSuffix}`,
    [
      textSource(
        "cable-conductor",
        ownerParts,
        "cable.designation",
        cable.designation,
      ),
      textSource(
        "cable-conductor",
        ownerParts,
        "cable.conductor.id",
        elementId.conductorId,
      ),
      textSource(
        "cable-conductor",
        ownerParts,
        "cable.conductor.color",
        metadata.color,
      ),
      ...(metadata.size === undefined
        ? []
        : [
            textSource(
              "cable-conductor",
              ownerParts,
              "cable.conductor.size",
              metadata.size,
            ),
          ]),
    ],
  );
}

function conductorMetadata(
  context: PresentationContext,
  elementId: ConductiveElementId,
): NonNullable<PresentationEdge["conductor"]> {
  switch (elementId.kind) {
    case "wire": {
      const wire = required(
        context.ir.wires.find(({ uid }) => uid === elementId.uid),
        `Selected wire ${elementId.uid} is missing.`,
      );
      return { kind: "wire", uid: wire.uid, designation: wire.designation };
    }
    case "jumper": {
      const jumper = required(
        context.ir.jumpers.find(({ uid }) => uid === elementId.uid),
        `Selected jumper ${elementId.uid} is missing.`,
      );
      return {
        kind: "jumper",
        uid: jumper.uid,
        designation: jumper.designation ?? `jumper:${jumper.uid}`,
      };
    }
    case "cable_conductor": {
      const cable = required(
        context.ir.cables.find(({ uid }) => uid === elementId.cableUid),
        `Selected cable ${elementId.cableUid} is missing.`,
      );
      return {
        kind: "cable-conductor",
        cableUid: elementId.cableUid,
        cableDesignation: cable.designation,
        conductorId: elementId.conductorId,
      };
    }
  }
}

export function edgeIdFor(elementId: ConductiveElementId): string {
  return elementId.kind === "cable_conductor"
    ? structuralTupleId(
        "cable-conductor",
        elementId.cableUid,
        elementId.conductorId,
      )
    : structuralTupleId(elementId.kind, elementId.uid);
}

function orientedConductorSteps(
  context: PresentationContext,
  pathIndex: number,
): readonly SelectedConductorStep[] {
  const path = orderedSelectedPaths(context)[pathIndex] as SelectedPath;
  return path.steps.filter(
    (step): step is SelectedConductorStep => step.kind === "conductor",
  );
}

export function buildConductorEdges(
  context: PresentationContext,
): BuiltConductors {
  const edgesByElement = new Map<string, MutablePresentationEdge>();
  const orientationByElement = new Map<
    string,
    readonly [TerminalId, TerminalId]
  >();
  const endpointUses = new Map<string, EndpointUse[]>();
  const paths = orderedSelectedPaths(context);
  for (const pathRank of paths.keys()) {
    for (const step of orientedConductorSteps(context, pathRank)) {
      const key = conductorKey(step.elementId);
      const record = irConductorRecord(context.ir, step.elementId);
      if (!sameEndpointPair(record.endpoints, [step.from, step.to])) {
        throw new Error(
          `Selected conductor ${key} disagrees with ElectricalIr.`,
        );
      }
      const fromNet = netForTerminal(context, step.from);
      const toNet = netForTerminal(context, step.to);
      if (fromNet !== step.netId || toNet !== step.netId) {
        throw new Error(
          `Selected conductor ${key} disagrees with its compiler net.`,
        );
      }
      const existingOrientation = orientationByElement.get(key);
      if (existingOrientation !== undefined) {
        if (
          !sameTerminal(existingOrientation[0], step.from) ||
          !sameTerminal(existingOrientation[1], step.to)
        ) {
          throw new Error(`Selected conductor ${key} has conflicting flow.`);
        }
        continue;
      }
      orientationByElement.set(key, [
        cloneTerminal(step.from),
        cloneTerminal(step.to),
      ]);
      const edge: MutablePresentationEdge = buildConductorEdge(
        step,
        context,
        key,
        record,
        pathRank,
      );
      edgesByElement.set(key, edge);
      addConductorEndpointUses(edge, step, endpointUses);
    }
  }
  const selectedKeys = [...context.selected.conductiveElementIds]
    .map(conductorKey)
    .sort(compareText);
  const builtKeys = [...edgesByElement.keys()].sort(compareText);
  if (
    selectedKeys.length !== builtKeys.length ||
    selectedKeys.some((key, index) => key !== builtKeys[index])
  ) {
    throw new Error(
      "Selected conductor provenance is not a complete path union.",
    );
  }
  return { edges: [...edgesByElement.values()], endpointUses };
}

function addConductorEndpointUses(
  edge: MutablePresentationEdge,
  step: SelectedConductorStep,
  endpointUses: Map<string, EndpointUse[]>,
) {
  const sourceUse: EndpointUse = {
    edge,
    end: "source",
    terminal: cloneTerminal(step.from),
  };
  const targetUse: EndpointUse = {
    edge,
    end: "target",
    terminal: cloneTerminal(step.to),
  };
  const fromKey = terminalIdKey(step.from);
  const toKey = terminalIdKey(step.to);
  endpointUses.set(fromKey, [...(endpointUses.get(fromKey) ?? []), sourceUse]);
  endpointUses.set(toKey, [...(endpointUses.get(toKey) ?? []), targetUse]);
}

function buildConductorEdge(
  step: SelectedConductorStep,
  context: PresentationContext,
  key: string,
  record: IrConductorRecord,
  pathRank: number,
) {
  const id = edgeIdFor(step.elementId);
  const edge: MutablePresentationEdge = {
    id,
    parentId: "root",
    kind: "conductor",
    sourcePortId: "",
    targetPortId: "",
    netId: step.netId,
    elementIds: [cloneElement(step.elementId)],
    conductor: conductorMetadata(context, step.elementId),
    ...(step.elementId.kind === "jumper" &&
    context.ir.jumpers.find(
      (j) => conductorKey({ kind: "jumper", uid: j.uid }) === key,
    )?.designation === undefined
      ? { authoredOrderKey: context.order.key(step.elementId.uid) }
      : {}),
    endpoints: [...record.endpoints].sort((a, b) =>
      compareTerminalId(a, b, (uid) => designationFor(context, uid)),
    ) as [TerminalId, TerminalId],
    pathRank,
    label: conductorLabel(context, step.elementId, id),
  };
  return edge;
}

function uniquePotentialForNet(context: PresentationContext, netId: string) {
  const potentials = context.ir.potentials.filter(
    (potential) => potential.netId === netId,
  );
  return potentials.length === 1 ? potentials[0] : undefined;
}

function netSortKey(context: PresentationContext, netId: string): string {
  return (
    uniquePotentialForNet(context, netId)?.name ?? context.order.key(netId)
  );
}

export function comparePresentationEdge(
  context: PresentationContext,
  left: MutablePresentationEdge,
  right: MutablePresentationEdge,
): number {
  const net =
    compareText(
      netSortKey(context, left.netId),
      netSortKey(context, right.netId),
    ) || context.order.compare(left.netId, right.netId);
  if (net !== 0) return net;
  const path = left.pathRank - right.pathRank;
  if (path !== 0) return path;
  if (left.kind !== right.kind) return left.kind === "conductor" ? -1 : 1;
  if (left.kind === "conductor" && right.kind === "conductor") {
    const element = compareSemanticElementIds(
      context.order,
      left.elementIds[0] as ConductiveElementId,
      right.elementIds[0] as ConductiveElementId,
    );
    if (element !== 0) return element;
  }
  return (
    context.order.compare(left.sourcePortId, right.sourcePortId) ||
    context.order.compare(left.targetPortId, right.targetPortId) ||
    context.order.compare(left.id, right.id)
  );
}

export function attachNetLabels(
  context: PresentationContext,
  edges: MutablePresentationEdge[],
): void {
  edges.sort((left, right) => comparePresentationEdge(context, left, right));
  const labeledNets = new Set<string>();
  for (const edge of edges) {
    if (labeledNets.has(edge.netId)) continue;
    labeledNets.add(edge.netId);
    const potential = uniquePotentialForNet(context, edge.netId);
    if (potential === undefined) continue;
    edge.netLabel = presentationLabel("edge", edge.id, "net", potential.name, [
      textSource(
        "potential",
        [potential.uid],
        "potential.name",
        potential.name,
      ),
    ]);
  }
}
