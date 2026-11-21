import { compareCompleteFunction } from "./util.js";
import type {
  BuildPresentationGraphRequest,
  PresentationContext,
  SymbolRepresentation,
  BoundaryRecord,
} from "./model.js";
import {
  type UnsupportedSymbolMappingError,
  unsupportedSymbolMappingError,
} from "../errors.js";
import {
  projectDeviceTypeSymbolMappings,
  type DeviceTypeSymbolMapping,
  type FunctionSymbolRule,
} from "../symbols/mappings.js";
import { SYMBOL_CATALOG } from "../symbols/catalog.js";
import {
  validateSymbolCatalog,
  resolveSelectedSymbolRule,
  type ResolvedSymbolRule,
} from "../symbols/validate.js";
import { irSemanticOrder } from "../semantic-order.js";
import { hasDirectLoadPairPaths } from "./paths.js";
import type { SymbolDefinition } from "../symbols/types.js";
import type {
  IrDevice,
  IrDeviceType,
  IrFunction,
  FunctionId,
} from "@thermite/compiler";
import { addUnique, required } from "./util.js";
import {
  functionIdKey,
  terminalIdKey,
  structuralTupleId,
} from "../ordering.js";

export function createContext(
  request: BuildPresentationGraphRequest,
):
  | { readonly ok: true; readonly value: PresentationContext }
  | { readonly ok: false; readonly error: UnsupportedSymbolMappingError } {
  const mappings =
    request.mappings ?? projectDeviceTypeSymbolMappings(request.ir);
  const catalog = request.catalog ?? SYMBOL_CATALOG;
  validateSymbolCatalog(catalog);
  const {
    deviceByUid,
    typeById,
    mappingByTypeId,
    functionByKey,
    netIdByTerminal,
    symbolById,
  } = createContextIndexes(request, mappings, catalog);

  for (const deviceUid of request.selected.deviceUids) {
    const device = deviceByUid.get(deviceUid);
    const typeId = device?.typeId ?? "<missing>";
    if (
      device === undefined ||
      typeById.get(typeId) === undefined ||
      mappingByTypeId.get(typeId) === undefined
    ) {
      return {
        ok: false,
        error: unsupportedSymbolMappingError({
          family: request.selected.view.family,
          deviceUid,
          typeId,
          root: request.selected.view.root.designation,
        }),
      };
    }
  }

  return {
    ok: true,
    value: {
      ir: request.ir,
      order: irSemanticOrder(request.ir),
      selected: request.selected,
      directLoadPair: hasDirectLoadPairPaths(request.selected),
      mappings,
      catalog,
      deviceByUid,
      typeById,
      mappingByTypeId,
      functionByKey,
      netIdByTerminal,
      symbolById,
      selectedNetIds: new Set(request.selected.netIds),
    },
  };
}

function createContextIndexes(
  request: BuildPresentationGraphRequest,
  mappings: readonly DeviceTypeSymbolMapping[],
  catalog: readonly SymbolDefinition[],
) {
  const deviceByUid = new Map<string, IrDevice>();
  const typeById = new Map<string, IrDeviceType>();
  const mappingByTypeId = new Map<string, DeviceTypeSymbolMapping>();
  const functionByKey = new Map<string, IrFunction>();
  const netIdByTerminal = new Map<string, string>();
  const symbolById = new Map<SymbolDefinition["id"], SymbolDefinition>();
  for (const device of request.ir.devices)
    addUnique(deviceByUid, device.uid, device, `device UID ${device.uid}`);
  for (const deviceType of request.ir.deviceTypes)
    addUnique(
      typeById,
      deviceType.id,
      deviceType,
      `device type ${deviceType.id}`,
    );
  for (const mapping of mappings)
    addUnique(
      mappingByTypeId,
      mapping.typeId,
      mapping,
      `mapping ${mapping.typeId}`,
    );
  for (const materialized of request.ir.functions)
    addUnique(
      functionByKey,
      functionIdKey(materialized.id),
      materialized,
      `function ${functionIdKey(materialized.id)}`,
    );
  for (const entry of request.ir.indexes.netIdByTerminal)
    addUnique(
      netIdByTerminal,
      terminalIdKey(entry.key),
      entry.value,
      `terminal net ${terminalIdKey(entry.key)}`,
    );
  for (const symbol of catalog)
    addUnique(symbolById, symbol.id, symbol, `symbol ${symbol.id}`);
  return {
    deviceByUid,
    typeById,
    mappingByTypeId,
    functionByKey,
    netIdByTerminal,
    symbolById,
  };
}

function resolvedRepresentation(
  context: PresentationContext,
  functionId: FunctionId,
):
  | { readonly ok: true; readonly value: SymbolRepresentation }
  | { readonly ok: false; readonly error: UnsupportedSymbolMappingError } {
  const device = required(
    context.deviceByUid.get(functionId.deviceUid),
    `Selected function ${functionIdKey(functionId)} has no device.`,
  );
  const deviceType = required(
    context.typeById.get(device.typeId),
    `Selected device ${device.uid} has no device type.`,
  );
  const resolved = resolveSelectedSymbolRule({
    deviceType,
    deviceUid: device.uid,
    materializedFunctions: context.ir.functions.filter(
      ({ id }) => id.deviceUid === device.uid,
    ),
    functionKey: functionId.functionKey,
    family: context.selected.view.family,
    root: context.selected.view.root.designation,
    mapping: required(
      context.mappingByTypeId.get(device.typeId),
      `Selected device ${device.uid} has no mapping.`,
    ),
    catalog: context.catalog,
  });
  if (!resolved.ok) return resolved;
  const value: ResolvedSymbolRule = resolved.value;
  if (value.kind === "function") {
    return {
      ok: true,
      value: {
        id: structuralTupleId("function", device.uid, value.rule.functionKey),
        kind: "function",
        device,
        deviceType,
        rule: value.rule,
        functionIds: [
          { deviceUid: device.uid, functionKey: value.rule.functionKey },
        ],
      },
    };
  }
  return {
    ok: true,
    value: {
      id: structuralTupleId("aggregate", device.uid, value.rule.key),
      kind: "aggregate",
      device,
      deviceType,
      rule: value.rule,
      functionIds: value.rule.functionKeys.map((functionKey) => ({
        deviceUid: device.uid,
        functionKey,
      })),
    },
  };
}

export function selectedRepresentations(
  context: PresentationContext,
):
  | { readonly ok: true; readonly value: readonly SymbolRepresentation[] }
  | { readonly ok: false; readonly error: UnsupportedSymbolMappingError } {
  const representations = new Map<string, SymbolRepresentation>();
  for (const functionId of [...context.selected.functionIds].sort(
    (left, right) => compareCompleteFunction(context, left, right),
  )) {
    const resolved = resolvedRepresentation(context, functionId);
    if (!resolved.ok) return resolved;
    const existing = representations.get(resolved.value.id);
    if (existing !== undefined) {
      if (
        existing.kind !== "aggregate" ||
        resolved.value.kind !== "aggregate"
      ) {
        throw new Error(`Duplicate presentation symbol ${resolved.value.id}.`);
      }
      continue;
    }
    representations.set(resolved.value.id, resolved.value);
  }
  return {
    ok: true,
    value: [...representations.values()].sort((left, right) =>
      context.order.compare(left.id, right.id),
    ),
  };
}

export function representationBindings(
  representation: SymbolRepresentation,
): readonly (FunctionSymbolRule["bindings"][number] & {
  readonly memberFunctionKey?: string;
})[] {
  return representation.rule.bindings;
}

export function representationIsCompleteSourceBoundary(
  representation: SymbolRepresentation,
  boundaries: ReadonlyMap<string, BoundaryRecord>,
): boolean {
  if (representation.rule.traversalRole !== "source-boundary") return true;
  const keys = new Set(
    representationBindings(representation).map(({ terminalKey }) =>
      terminalIdKey({
        deviceUid: representation.device.uid,
        terminalKey,
      }),
    ),
  );
  const active = [...keys].map((key) => boundaries.get(key));
  return (
    active.every(
      (record): record is BoundaryRecord =>
        record !== undefined && record.constraint === "FIRST",
    ) && active.length === keys.size
  );
}

export function addImplicitTerminalRepresentations(
  context: PresentationContext,
  representations: readonly SymbolRepresentation[],
  boundaries: ReadonlyMap<string, BoundaryRecord>,
):
  | { readonly ok: true; readonly value: readonly SymbolRepresentation[] }
  | { readonly ok: false; readonly error: UnsupportedSymbolMappingError } {
  const byId = new Map(representations.map((value) => [value.id, value]));
  const covered = new Set<string>();
  for (const representation of representations) {
    for (const binding of representationBindings(representation)) {
      covered.add(
        terminalIdKey({
          deviceUid: representation.device.uid,
          terminalKey: binding.terminalKey,
        }),
      );
    }
  }
  for (const terminal of context.selected.terminalIds) {
    const key = terminalIdKey(terminal);
    if (covered.has(key) || boundaries.has(key)) continue;
    const device = required(
      context.deviceByUid.get(terminal.deviceUid),
      `Selected terminal ${key} has no device.`,
    );
    const mapping = required(
      context.mappingByTypeId.get(device.typeId),
      `Selected terminal ${key} has no mapping.`,
    );
    const candidates = mapping.functions.filter(
      (rule) =>
        rule.families.includes(context.selected.view.family) &&
        rule.traversalRole === "terminal-display" &&
        rule.bindings.some(
          ({ terminalKey }) => terminalKey === terminal.terminalKey,
        ),
    );
    if (candidates.length === 0) continue;
    if (candidates.length !== 1) {
      throw new Error(`Terminal ${key} resolves to multiple terminal symbols.`);
    }
    const resolved = resolvedRepresentation(context, {
      deviceUid: device.uid,
      functionKey: (candidates[0] as FunctionSymbolRule).functionKey,
    });
    if (!resolved.ok) return resolved;
    byId.set(resolved.value.id, resolved.value);
  }
  return {
    ok: true,
    value: [...byId.values()].sort((left, right) =>
      context.order.compare(left.id, right.id),
    ),
  };
}
