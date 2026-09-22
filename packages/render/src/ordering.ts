import type { FunctionId, TerminalId } from "@thermite/compiler";

import type {
  LocationIdentity,
  PresentationLabel,
  PresentationLabelRole,
  PresentationNode,
  PresentationPort,
  RenderTextSource,
} from "./types.js";

export type PresentationClass =
  | "source"
  | "protection"
  | "power-contact"
  | "control-contact"
  | "command"
  | "permissive"
  | "coil"
  | "overload"
  | "load"
  | "terminal"
  | "plc-input"
  | "plc-output"
  | "rail"
  | "junction";

export const PRESENTATION_CLASSES = Object.freeze([
  "source",
  "protection",
  "power-contact",
  "control-contact",
  "command",
  "permissive",
  "coil",
  "overload",
  "load",
  "terminal",
  "plc-input",
  "plc-output",
  "rail",
  "junction",
] as const satisfies readonly PresentationClass[]);

export const PRESENTATION_CLASS_RANK: Readonly<
  Record<PresentationClass, number>
> = Object.freeze({
  source: 0,
  "plc-output": 1,
  "plc-input": 2,
  protection: 3,
  command: 4,
  permissive: 5,
  "power-contact": 6,
  "control-contact": 7,
  overload: 8,
  coil: 9,
  load: 10,
  terminal: 11,
  rail: 12,
  junction: 13,
});

export function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function comparePresentationClass(
  left: PresentationClass,
  right: PresentationClass,
): number {
  return PRESENTATION_CLASS_RANK[left] - PRESENTATION_CLASS_RANK[right];
}

export function structuralTupleId(
  tag: string,
  ...parts: readonly string[]
): string {
  return JSON.stringify([tag, ...parts]);
}

export function terminalIdKey(terminal: TerminalId): string {
  return JSON.stringify([terminal.deviceUid, terminal.terminalKey]);
}

export function functionIdKey(functionId: FunctionId): string {
  return JSON.stringify([functionId.deviceUid, functionId.functionKey]);
}

export function compareStructuralFunctionId(
  left: FunctionId,
  right: FunctionId,
): number {
  return (
    compareText(left.deviceUid, right.deviceUid) ||
    compareText(left.functionKey, right.functionKey)
  );
}

export function compareTerminalId(
  left: TerminalId,
  right: TerminalId,
  designationForDeviceUid: (deviceUid: string) => string,
): number {
  return (
    compareText(
      designationForDeviceUid(left.deviceUid),
      designationForDeviceUid(right.deviceUid),
    ) ||
    compareText(left.terminalKey, right.terminalKey) ||
    compareText(left.deviceUid, right.deviceUid)
  );
}

export function compareFunctionId(
  left: FunctionId,
  right: FunctionId,
  designationForDeviceUid: (deviceUid: string) => string,
  mappingOrderForFunction: (functionId: FunctionId) => number,
): number {
  return (
    compareText(
      designationForDeviceUid(left.deviceUid),
      designationForDeviceUid(right.deviceUid),
    ) ||
    mappingOrderForFunction(left) - mappingOrderForFunction(right) ||
    compareText(left.functionKey, right.functionKey) ||
    compareText(left.deviceUid, right.deviceUid)
  );
}

export function compareDeviceUid(
  left: string,
  right: string,
  designationForDeviceUid: (deviceUid: string) => string,
): number {
  return (
    compareText(
      designationForDeviceUid(left),
      designationForDeviceUid(right),
    ) || compareText(left, right)
  );
}

export function compareLocationIdentity(
  left: LocationIdentity,
  right: LocationIdentity,
): number {
  if (left[0] !== right[0]) return left[0] === "authored" ? -1 : 1;
  return compareText(left[1], right[1]);
}

export function comparePresentationNode(
  left: PresentationNode,
  right: PresentationNode,
): number {
  return (
    comparePresentationClass(left.classification, right.classification) ||
    compareText(left.id, right.id)
  );
}

export function comparePresentationPort(
  left: PresentationPort,
  right: PresentationPort,
  designationForDeviceUid: (deviceUid: string) => string,
): number {
  return (
    left.order - right.order ||
    compareTerminalId(left.terminal, right.terminal, designationForDeviceUid) ||
    compareText(left.id, right.id)
  );
}

const PRESENTATION_LABEL_ROLE_RANK: Readonly<
  Record<PresentationLabelRole, number>
> = Object.freeze({
  location: 0,
  device: 1,
  function: 2,
  aggregate: 2,
  rail: 2,
  terminal: 3,
  conductor: 4,
  net: 5,
});

export function comparePresentationLabel(
  left: PresentationLabel,
  right: PresentationLabel,
): number {
  return (
    compareText(left.ownerKind, right.ownerKind) ||
    compareText(left.ownerId, right.ownerId) ||
    PRESENTATION_LABEL_ROLE_RANK[left.role] -
      PRESENTATION_LABEL_ROLE_RANK[right.role] ||
    compareText(left.id, right.id)
  );
}

export function compareRenderTextSource(
  left: RenderTextSource,
  right: RenderTextSource,
): number {
  return (
    compareText(left.ownerKind, right.ownerKind) ||
    compareText(left.ownerId, right.ownerId) ||
    compareText(left.field, right.field) ||
    compareText(left.value, right.value)
  );
}
