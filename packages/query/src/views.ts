import type {
  IrCable,
  IrCableConductor,
  IrDevice,
  IrJumper,
  IrNet,
  IrPotential,
  IrProjectRelation,
  IrTerminal,
  IrWire,
} from "@thermite/compiler";

import {
  comparePotentialView,
  compareTerminalView,
  compareText,
} from "./ordering.js";
import type {
  ConductiveEdgeView,
  ConductiveElementView,
  DeviceView,
  NetSummaryView,
  PotentialView,
  ProjectObjectKind,
  ProjectObjectView,
  ProjectRelationView,
  TerminalView,
} from "./types.js";

export type IrProjectObject =
  IrDevice | IrWire | IrJumper | IrCable | IrProjectRelation | IrPotential;

function commonProjectObjectView(
  kind: ProjectObjectKind,
  object: IrProjectObject,
): ProjectObjectView {
  return {
    kind,
    uid: object.uid,
    ...(object.designation === undefined
      ? {}
      : { designation: object.designation }),
    ...(object.description === undefined
      ? {}
      : { description: object.description }),
    aliases: [...object.aliases].sort(compareText),
  };
}

export function buildProjectObjectView(
  kind: ProjectObjectKind,
  object: IrProjectObject,
): ProjectObjectView {
  return commonProjectObjectView(kind, object);
}

export function buildDeviceView(device: IrDevice): DeviceView {
  return {
    ...commonProjectObjectView("device", device),
    kind: "device",
    designation: device.designation,
    typeId: device.typeId,
    ...(device.connectionReview === undefined
      ? {}
      : { connectionReview: structuredClone(device.connectionReview) }),
    ...(device.io === undefined ? {} : { io: structuredClone(device.io) }),
    ...(device.location === undefined ? {} : { location: device.location }),
  };
}

export function buildTerminalView(
  terminal: IrTerminal,
  device: IrDevice,
): TerminalView {
  return {
    id: {
      deviceUid: terminal.id.deviceUid,
      terminalKey: terminal.id.terminalKey,
    },
    deviceDesignation: device.designation,
    display: `${device.designation}.${terminal.id.terminalKey}`,
    ...(terminal.required === undefined ? {} : { required: terminal.required }),
    ...(terminal.role === undefined ? {} : { role: terminal.role }),
    ...(terminal.rating === undefined
      ? {}
      : { rating: structuredClone(terminal.rating) }),
    ...(terminal.connectionPolicy === undefined
      ? {}
      : { connectionPolicy: terminal.connectionPolicy }),
    ...(terminal.description === undefined
      ? {}
      : { description: terminal.description }),
  };
}

export function buildPotentialView(potential: IrPotential): PotentialView {
  return {
    uid: potential.uid,
    name: potential.name,
    electrical: structuredClone(potential.electrical),
  };
}

export function buildNetSummaryView(
  net: Pick<IrNet, "id">,
  potentials: readonly IrPotential[],
): NetSummaryView {
  return {
    id: net.id,
    potentials: potentials.map(buildPotentialView).sort(comparePotentialView),
  };
}

export function buildProjectRelationView(
  relation: IrProjectRelation,
  from: IrDevice,
  to: IrDevice,
): ProjectRelationView {
  return {
    uid: relation.uid,
    ...(relation.designation === undefined
      ? {}
      : { designation: relation.designation }),
    display: relation.designation ?? `relation:${relation.uid}`,
    verb: relation.verb,
    ...(relation.connection === undefined
      ? {}
      : { connection: structuredClone(relation.connection) }),
    ...(relation.assembly === undefined
      ? {}
      : { assembly: structuredClone(relation.assembly) }),
    from: buildDeviceView(from),
    to: buildDeviceView(to),
  };
}

export type ConductiveElementInput =
  | { readonly kind: "wire"; readonly element: IrWire }
  | { readonly kind: "jumper"; readonly element: IrJumper }
  | {
      readonly kind: "cable_conductor";
      readonly element: IrCableConductor;
      readonly cable: IrCable;
    };

export function buildConductiveElementView(
  input: ConductiveElementInput,
): ConductiveElementView {
  if (input.kind === "wire") {
    return {
      kind: "wire",
      uid: input.element.uid,
      designation: input.element.designation,
      display: input.element.designation,
    };
  }
  if (input.kind === "jumper") {
    return {
      kind: "jumper",
      uid: input.element.uid,
      ...(input.element.designation === undefined
        ? {}
        : { designation: input.element.designation }),
      display: input.element.designation ?? `jumper:${input.element.uid}`,
    };
  }
  return {
    kind: "cable_conductor",
    cableUid: input.element.id.cableUid,
    cableDesignation: input.cable.designation,
    conductorId: input.element.id.conductorId,
    display: `${input.cable.designation}.${input.element.id.conductorId}`,
  };
}

function cloneTerminalView(terminal: TerminalView): TerminalView {
  return {
    id: {
      deviceUid: terminal.id.deviceUid,
      terminalKey: terminal.id.terminalKey,
    },
    deviceDesignation: terminal.deviceDesignation,
    display: terminal.display,
    ...(terminal.required === undefined ? {} : { required: terminal.required }),
    ...(terminal.role === undefined ? {} : { role: terminal.role }),
    ...(terminal.rating === undefined
      ? {}
      : { rating: structuredClone(terminal.rating) }),
    ...(terminal.connectionPolicy === undefined
      ? {}
      : { connectionPolicy: terminal.connectionPolicy }),
    ...(terminal.description === undefined
      ? {}
      : { description: terminal.description }),
  };
}

function cloneConductiveElementView(
  element: ConductiveElementView,
): ConductiveElementView {
  if (element.kind === "wire") {
    return { ...element };
  }
  if (element.kind === "jumper") {
    return {
      kind: "jumper",
      uid: element.uid,
      ...(element.designation === undefined
        ? {}
        : { designation: element.designation }),
      display: element.display,
    };
  }
  return { ...element };
}

export function buildConductiveEdgeView(
  element: ConductiveElementView,
  endpoints: readonly [TerminalView, TerminalView],
): ConductiveEdgeView {
  const orderedEndpoints = endpoints
    .map(cloneTerminalView)
    .sort(compareTerminalView) as [TerminalView, TerminalView];
  return {
    element: cloneConductiveElementView(element),
    endpoints: orderedEndpoints,
  };
}
