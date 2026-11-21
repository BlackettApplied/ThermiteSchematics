import type {
  ElectricalIr,
  IrDevice,
  IrDeviceType,
  IrFunction,
} from "@thermite/compiler";
import {
  materializedTraceRootFunctions,
  traceRootRuleForType,
  validateTraceRootRules,
} from "./intent-rules.js";
import type { DeviceTypeSymbolMapping } from "./symbols/mappings.js";
import type { SchematicViewFamily } from "./types.js";

function matchingFunction(
  functions: readonly IrFunction[],
  deviceUid: string,
  functionKey: string,
): IrFunction | undefined {
  const matches = functions.filter(
    ({ id }) => id.deviceUid === deviceUid && id.functionKey === functionKey,
  );
  return matches.length === 1 ? matches[0] : undefined;
}

export function rootSupportsFamily(
  ir: Readonly<ElectricalIr>,
  device: IrDevice,
  mapping: DeviceTypeSymbolMapping,
  family: SchematicViewFamily,
): boolean {
  if (family === "control") {
    const roots = mapping.functions.filter(
      (rule) =>
        rule.families.includes("control") && rule.traversalRole === "coil-root",
    );
    if (roots.length !== 1) return false;
    const root = roots[0]!;
    const materialized = matchingFunction(
      ir.functions,
      device.uid,
      root.functionKey,
    );
    return (
      materialized !== undefined &&
      materialized.terminals.length === 2 &&
      root.bindings.some(({ portId }) => portId === "A1") &&
      root.bindings.some(({ portId }) => portId === "A2")
    );
  }

  const aggregateBindings = mapping.aggregates
    .filter(
      (rule) =>
        rule.families.includes("power") &&
        rule.traversalRole === "load-boundary",
    )
    .flatMap((rule) => rule.bindings);
  const functionBindings = mapping.functions
    .filter(
      (rule) =>
        rule.families.includes("power") &&
        rule.traversalRole === "load-boundary",
    )
    .flatMap((rule) => rule.bindings);
  return [...aggregateBindings, ...functionBindings].some(({ terminalKey }) =>
    ir.terminals.some(
      ({ id }) => id.deviceUid === device.uid && id.terminalKey === terminalKey,
    ),
  );
}

export function rootSupportsTrace(
  ir: Readonly<ElectricalIr>,
  device: IrDevice,
  deviceType: IrDeviceType,
  mappings: readonly DeviceTypeSymbolMapping[],
): boolean {
  validateTraceRootRules(ir.deviceTypes, mappings);
  const rule = traceRootRuleForType(
    device.typeId,
    deviceType,
    mappings.find((m) => m.typeId === device.typeId),
  );
  if (rule === undefined) return false;
  materializedTraceRootFunctions(rule, device.uid, deviceType, ir.functions);
  return true;
}

export function targetHasMappedInput(
  ir: Readonly<ElectricalIr>,
  target: IrDevice,
  mapping: DeviceTypeSymbolMapping | undefined,
): boolean {
  if (mapping === undefined) return false;
  return mapping.functions.some((rule) => {
    if (
      !rule.families.includes("control") ||
      rule.traversalRole !== "channel-boundary"
    ) {
      return false;
    }
    const materialized = matchingFunction(
      ir.functions,
      target.uid,
      rule.functionKey,
    );
    return (
      materialized?.kind === "channel" &&
      materialized.direction === "input" &&
      materialized.terminals.length === 1
    );
  });
}

export function rootSupportsLoads(
  ir: Readonly<ElectricalIr>,
  device: IrDevice,
  mapping: DeviceTypeSymbolMapping,
): boolean {
  const sourceRules = mapping.functions.filter(
    (rule) =>
      rule.families.includes("control") &&
      rule.classification === "source" &&
      rule.traversalRole === "source-boundary",
  );
  if (sourceRules.length !== 1) return false;
  const source = sourceRules[0]!;
  if (
    matchingFunction(ir.functions, device.uid, source.functionKey) === undefined
  ) {
    return false;
  }
  const boundaries = mapping.boundaryTerminals.filter(
    (rule) =>
      rule.functionKey === source.functionKey &&
      rule.families.includes("control") &&
      (rule.boundaryKind === "control-source" ||
        rule.boundaryKind === "control-return"),
  );
  if (
    boundaries.length !== 2 ||
    boundaries.filter(({ boundaryKind }) => boundaryKind === "control-source")
      .length !== 1 ||
    boundaries.filter(({ boundaryKind }) => boundaryKind === "control-return")
      .length !== 1 ||
    source.bindings.length !== 2 ||
    new Set(source.bindings.map(({ terminalKey }) => terminalKey)).size !== 2
  ) {
    return false;
  }
  return source.bindings.every((binding) => {
    const boundary = boundaries.find(
      ({ terminalKey }) => terminalKey === binding.terminalKey,
    );
    const terminal = ir.terminals.find(
      ({ id }) =>
        id.deviceUid === device.uid && id.terminalKey === binding.terminalKey,
    );
    return (
      boundary !== undefined &&
      terminal !== undefined &&
      terminal.role === boundary.requiredRole
    );
  });
}
