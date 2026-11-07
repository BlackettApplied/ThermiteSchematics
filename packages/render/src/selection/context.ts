import type {
  ElectricalIr,
  FunctionId,
  TerminalId,
  IrDevice,
  IrDeviceType,
  IrFunction,
  IrPotential,
} from "@thermite/compiler";
import {
  type UnsupportedSymbolMappingError,
  InvalidSymbolMappingError,
  unsupportedSymbolMappingError,
} from "../errors.js";
import { addUnique, conductorKey } from "../internal.js";
import {
  compareTerminalId,
  terminalIdKey,
  functionIdKey,
} from "../ordering.js";
import { irSemanticOrder } from "../semantic-order.js";
import {
  type DeviceTypeSymbolMapping,
  projectDeviceTypeSymbolMappings,
} from "../symbols/mappings.js";
import {
  isFunctionTraversable,
  validateMaterializedFunctionFacts,
} from "../symbols/validate.js";
import type { NormalizedDeviceSchematicView } from "../types.js";
import type {
  IrConductor,
  SymbolMappingContext,
  FunctionSearchEdge,
  SelectSemanticSubgraphRequest,
  SelectionContext,
} from "./contracts.js";

function irConductors(ir: Readonly<ElectricalIr>): readonly IrConductor[] {
  return [
    ...ir.wires.map((wire) => ({
      id: { kind: "wire" as const, uid: wire.uid },
      endpoints: [
        wire.endpoints[0].terminal,
        wire.endpoints[1].terminal,
      ] as const,
    })),
    ...ir.jumpers.map((jumper) => ({
      id: { kind: "jumper" as const, uid: jumper.uid },
      endpoints: [
        jumper.endpoints[0].terminal,
        jumper.endpoints[1].terminal,
      ] as const,
    })),
    ...ir.cableConductors.map((conductor) => ({
      id: {
        kind: "cable_conductor" as const,
        cableUid: conductor.cableUid,
        conductorId: conductor.id.conductorId,
      },
      endpoints: [
        conductor.endpoints[0].terminal,
        conductor.endpoints[1].terminal,
      ] as const,
    })),
  ];
}

export function functionMappingOrder(
  context: SymbolMappingContext,
  id: FunctionId,
): number {
  const device = context.deviceByUid.get(id.deviceUid);
  const mapping =
    device === undefined
      ? undefined
      : context.mappingByTypeId.get(device.typeId);
  if (mapping === undefined) return Number.MAX_SAFE_INTEGER;
  const directIndex = mapping.functions.findIndex(
    ({ functionKey }) => functionKey === id.functionKey,
  );
  if (directIndex >= 0) return directIndex;
  for (
    let aggregateIndex = 0;
    aggregateIndex < mapping.aggregates.length;
    aggregateIndex++
  ) {
    const memberIndex = mapping.aggregates[
      aggregateIndex
    ]!.functionKeys.indexOf(id.functionKey);
    if (memberIndex >= 0) {
      return mapping.functions.length + aggregateIndex * 1_000 + memberIndex;
    }
  }
  return Number.MAX_SAFE_INTEGER;
}

export function designationFor(
  context: SymbolMappingContext,
  deviceUid: string,
): string {
  return context.deviceByUid.get(deviceUid)?.designation ?? "";
}

export function compareCompleteTerminal(
  context: SymbolMappingContext,
  left: TerminalId,
  right: TerminalId,
): number {
  return compareTerminalId(left, right, (uid) => designationFor(context, uid));
}

function buildFunctionAdjacency(
  ir: Readonly<ElectricalIr>,
  view: NormalizedDeviceSchematicView,
  mappingByTypeId: ReadonlyMap<string, DeviceTypeSymbolMapping>,
  deviceByUid: ReadonlyMap<string, IrDevice>,
):
  | {
      readonly ok: true;
      readonly value: ReadonlyMap<string, readonly FunctionSearchEdge[]>;
    }
  | { readonly ok: false; readonly error: UnsupportedSymbolMappingError } {
  const adjacency = new Map<string, FunctionSearchEdge[]>();
  const typeById = new Map(ir.deviceTypes.map((type) => [type.id, type]));
  for (const materialized of ir.functions) {
    const device = deviceByUid.get(materialized.id.deviceUid);
    const mapping =
      device === undefined ? undefined : mappingByTypeId.get(device.typeId);
    const rule = mapping?.functions.find(
      (candidate) =>
        candidate.functionKey === materialized.id.functionKey &&
        candidate.families.includes(view.family) &&
        isFunctionTraversable(view.family, candidate.traversalRole),
    );
    if (rule === undefined) continue;
    const deviceType =
      device === undefined ? undefined : typeById.get(device.typeId);
    try {
      if (deviceType === undefined || materialized.terminals.length !== 2) {
        throw new InvalidSymbolMappingError("Invalid traversal function.");
      }
      validateMaterializedFunctionFacts(deviceType, materialized);
    } catch (error) {
      if (!(error instanceof InvalidSymbolMappingError)) throw error;
      return {
        ok: false,
        error: unsupportedSymbolMappingError({
          family: view.family,
          deviceUid: materialized.id.deviceUid,
          typeId: device?.typeId ?? "<missing>",
          functionKey: materialized.id.functionKey,
          root: view.root.designation,
        }),
      };
    }
    const [first, second] = materialized.terminals;
    const state =
      materialized.kind === "contact"
        ? { normalState: materialized.normal_state }
        : {};
    const forward: FunctionSearchEdge = {
      kind: "function",
      functionId: materialized.id,
      from: first!,
      to: second!,
      ...state,
    };
    const reverse: FunctionSearchEdge = {
      kind: "function",
      functionId: materialized.id,
      from: second!,
      to: first!,
      ...state,
    };
    adjacency.set(terminalIdKey(first!), [
      ...(adjacency.get(terminalIdKey(first!)) ?? []),
      forward,
    ]);
    adjacency.set(terminalIdKey(second!), [
      ...(adjacency.get(terminalIdKey(second!)) ?? []),
      reverse,
    ]);
  }
  return {
    ok: true,
    value: new Map(
      [...adjacency].map(([key, edges]) => [key, Object.freeze(edges)]),
    ),
  };
}

export function createSymbolMappingContext(
  ir: Readonly<ElectricalIr>,
  mappings: readonly DeviceTypeSymbolMapping[],
): SymbolMappingContext {
  const deviceTypeById = new Map<string, IrDeviceType>();
  for (const deviceType of ir.deviceTypes) {
    addUnique(
      deviceTypeById,
      deviceType.id,
      deviceType,
      `device type ${deviceType.id}`,
    );
  }
  const deviceByUid = new Map<string, IrDevice>();
  for (const device of ir.devices) {
    addUnique(deviceByUid, device.uid, device, `device UID ${device.uid}`);
  }
  const mappingByTypeId = new Map<string, DeviceTypeSymbolMapping>();
  for (const mapping of mappings) {
    addUnique(
      mappingByTypeId,
      mapping.typeId,
      mapping,
      `mapping type ${mapping.typeId}`,
    );
  }
  const functionByKey = new Map<string, IrFunction>();
  for (const materialized of ir.functions) {
    addUnique(
      functionByKey,
      functionIdKey(materialized.id),
      materialized,
      `function ${functionIdKey(materialized.id)}`,
    );
  }
  return {
    ir,
    mappings,
    deviceByUid,
    deviceTypeById,
    mappingByTypeId,
    functionByKey,
  };
}

export function createSelectionContext(
  request: SelectSemanticSubgraphRequest,
  includeFunctionAdjacency = true,
):
  | { readonly ok: true; readonly value: SelectionContext }
  | { readonly ok: false; readonly error: UnsupportedSymbolMappingError } {
  const mappings =
    request.mappings ?? projectDeviceTypeSymbolMappings(request.ir);
  const mappingContext = createSymbolMappingContext(request.ir, mappings);
  const terminals = new Map<string, ElectricalIr["terminals"][number]>();
  for (const terminal of request.ir.terminals) {
    addUnique(
      terminals,
      terminalIdKey(terminal.id),
      terminal,
      `terminal ${terminalIdKey(terminal.id)}`,
    );
  }
  const potentialAnchors = new Map<string, IrPotential[]>();
  for (const potential of request.ir.potentials) {
    const key = terminalIdKey(potential.terminal);
    potentialAnchors.set(key, [
      ...(potentialAnchors.get(key) ?? []),
      potential,
    ]);
  }
  const conductorByKey = new Map<string, IrConductor>();
  for (const conductor of irConductors(request.ir)) {
    addUnique(
      conductorByKey,
      conductorKey(conductor.id),
      conductor,
      `conductive element ${conductorKey(conductor.id)}`,
    );
  }
  const adjacency = includeFunctionAdjacency
    ? buildFunctionAdjacency(
        request.ir,
        request.view,
        mappingContext.mappingByTypeId,
        mappingContext.deviceByUid,
      )
    : ({
        ok: true,
        value: new Map<string, readonly FunctionSearchEdge[]>(),
      } as const);
  if (!adjacency.ok) return adjacency;
  return {
    ok: true,
    value: {
      ir: request.ir,
      order: irSemanticOrder(request.ir),
      view: request.view,
      engine: request.engine,
      mappings,
      deviceByUid: mappingContext.deviceByUid,
      deviceTypeById: mappingContext.deviceTypeById,
      mappingByTypeId: mappingContext.mappingByTypeId,
      terminalByKey: terminals,
      functionByKey: mappingContext.functionByKey,
      functionAdjacency: adjacency.value,
      potentialAnchors: new Map(
        [...potentialAnchors].map(([key, values]) => [
          key,
          Object.freeze([...values]),
        ]),
      ),
      conductorByKey,
      netCache: new Map(),
      verifiedConductors: new Set(),
    },
  };
}

export function deviceTypeFor(
  context: SymbolMappingContext,
  device: IrDevice,
): IrDeviceType {
  const deviceType = context.deviceTypeById.get(device.typeId);
  if (deviceType === undefined) {
    throw new Error(
      `Device type ${JSON.stringify(device.typeId)} is absent from ElectricalIr.`,
    );
  }
  return deviceType;
}

export function rootDevice(context: SelectionContext): IrDevice {
  const device = context.deviceByUid.get(context.view.root.deviceUid);
  if (device === undefined) {
    throw new Error(
      `Normalized root ${JSON.stringify(context.view.root.deviceUid)} is absent from ElectricalIr.`,
    );
  }
  return device;
}

export function unsupportedRoot(
  context: SelectionContext,
  device: IrDevice,
  functionKey?: string,
): { readonly ok: false; readonly error: UnsupportedSymbolMappingError } {
  return {
    ok: false,
    error: unsupportedSymbolMappingError({
      family: context.view.family,
      deviceUid: device.uid,
      typeId: device.typeId,
      ...(functionKey === undefined ? {} : { functionKey }),
      root: context.view.root.designation,
    }),
  };
}
