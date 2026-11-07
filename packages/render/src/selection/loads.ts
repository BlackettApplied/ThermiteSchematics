// Loads family selection: selectLoadsSubgraph.
import type { TerminalId, FunctionId, IrDevice } from "@thermite/compiler";
import type { QueryError, NetResult } from "@thermite/query";
import {
  InvalidSymbolMappingError,
  type UnsupportedSymbolMappingError,
  incompleteLoadsPathError,
} from "../errors.js";
import { cloneTerminal, cloneFunction, sameTerminal } from "../internal.js";
import {
  functionIdKey,
  terminalIdKey,
  compareDeviceUid,
  compareText,
  compareFunctionId,
} from "../ordering.js";
import { SYMBOL_CATALOG } from "../symbols/catalog.js";
import type {
  FunctionSymbolRule,
  AggregateSymbolRule,
} from "../symbols/mappings.js";
import type { SymbolDefinition } from "../symbols/types.js";
import { resolveSelectedSymbolRule } from "../symbols/validate.js";
import {
  boundaryCandidate,
  uniqueNetPotentialName,
  compareBoundaryCandidate,
} from "./boundaries.js";
import {
  pathTerminalDisplayFunctionIds,
  buildSelectedSubgraph,
} from "./conservation.js";
import {
  rootDevice,
  deviceTypeFor,
  designationFor,
  createSelectionContext,
  unsupportedRoot,
  functionMappingOrder,
  compareCompleteTerminal,
} from "./context.js";
import type {
  SelectionContext,
  SearchResult,
  IncompleteLoadsSelectionError,
  SelectLoadsSubgraphRequest,
  SelectLoadsSubgraphResult,
  SearchSuccess,
} from "./contracts.js";
import { searchConductors, selectedSteps, netFor } from "./traversal.js";

interface LoadSourceOutput {
  readonly portId: string;
  readonly terminal: TerminalId;
  readonly boundaryKind: "control-source" | "control-return";
}

interface ResolvedLoadSource {
  readonly functionId: FunctionId;
  readonly outputs: readonly LoadSourceOutput[];
}

interface LoadSourceOutputWithNet extends LoadSourceOutput {
  readonly net: NetResult;
}

interface CompleteLoadRepresentation {
  readonly key: string;
  readonly kind: "function" | "aggregate";
  readonly device: IrDevice;
  readonly rule: FunctionSymbolRule | AggregateSymbolRule;
  readonly functionIds: readonly FunctionId[];
  readonly loadTerminals: readonly TerminalId[];
}

interface LoadRepresentationAccumulator {
  readonly key: string;
  readonly kind: "function" | "aggregate";
  readonly device: IrDevice;
  readonly rule: FunctionSymbolRule | AggregateSymbolRule;
  readonly functionIds: readonly FunctionId[];
  readonly loadTerminals: Map<string, TerminalId>;
}

function invalidLoadsMapping(detail: string): never {
  throw new InvalidSymbolMappingError(`Invalid loads mapping: ${detail}`);
}

function resolveLoadSource(
  context: SelectionContext,
  catalog: readonly SymbolDefinition[],
):
  | { readonly ok: true; readonly value?: ResolvedLoadSource }
  | { readonly ok: false; readonly error: UnsupportedSymbolMappingError } {
  const device = rootDevice(context);
  const mapping = context.mappingByTypeId.get(device.typeId);
  const sourceRules = mapping?.functions.filter(
    (rule) =>
      rule.families.includes("control") &&
      rule.classification === "source" &&
      rule.traversalRole === "source-boundary",
  );
  if (mapping === undefined || sourceRules?.length !== 1) {
    return { ok: true };
  }
  const rule = sourceRules[0]!;
  const materialized = context.functionByKey.get(
    functionIdKey({ deviceUid: device.uid, functionKey: rule.functionKey }),
  );
  if (materialized === undefined) return { ok: true };
  const resolved = resolveSelectedSymbolRule({
    deviceType: deviceTypeFor(context, device),
    deviceUid: device.uid,
    materializedFunctions: context.ir.functions.filter(
      ({ id }) => id.deviceUid === device.uid,
    ),
    functionKey: rule.functionKey,
    family: "control",
    root: context.view.root.designation,
    mapping,
    catalog,
  });
  if (!resolved.ok) return resolved;
  if (
    resolved.value.kind !== "function" ||
    resolved.value.rule.functionKey !== rule.functionKey
  ) {
    return { ok: true };
  }

  const boundaryRules = mapping.boundaryTerminals.filter(
    (candidate) =>
      candidate.functionKey === rule.functionKey &&
      candidate.families.includes("control") &&
      (candidate.boundaryKind === "control-source" ||
        candidate.boundaryKind === "control-return"),
  );
  const positive = boundaryRules.filter(
    ({ boundaryKind }) => boundaryKind === "control-source",
  );
  const returning = boundaryRules.filter(
    ({ boundaryKind }) => boundaryKind === "control-return",
  );
  if (
    boundaryRules.length !== 2 ||
    positive.length !== 1 ||
    returning.length !== 1 ||
    rule.bindings.length !== 2 ||
    new Set(rule.bindings.map(({ terminalKey }) => terminalKey)).size !== 2
  ) {
    return { ok: true };
  }

  const outputs: LoadSourceOutput[] = [];
  for (const binding of rule.bindings) {
    const boundary = boundaryRules.find(
      ({ terminalKey }) => terminalKey === binding.terminalKey,
    );
    const terminal = context.terminalByKey.get(
      terminalIdKey({
        deviceUid: device.uid,
        terminalKey: binding.terminalKey,
      }),
    );
    if (
      boundary === undefined ||
      terminal === undefined ||
      terminal.role !== boundary.requiredRole
    ) {
      return { ok: true };
    }
    outputs.push({
      portId: binding.portId,
      terminal: cloneTerminal(terminal.id),
      boundaryKind: boundary.boundaryKind as
        "control-source" | "control-return",
    });
  }
  return {
    ok: true,
    value: {
      functionId: cloneFunction(materialized.id),
      outputs: Object.freeze(outputs),
    },
  };
}

function compareCompleteLoadRepresentation(
  context: SelectionContext,
  left: CompleteLoadRepresentation,
  right: CompleteLoadRepresentation,
): number {
  return (
    compareDeviceUid(left.device.uid, right.device.uid, (uid) =>
      designationFor(context, uid),
    ) || compareText(left.key, right.key)
  );
}

function selectLoadArm(
  context: SelectionContext,
  source: LoadSourceOutputWithNet,
  load: CompleteLoadRepresentation,
  portId: string,
  terminal: TerminalId,
  sourceFunctionId: FunctionId,
): SearchResult {
  const searched = searchConductors(
    context,
    terminal,
    (candidate, net, distance) =>
      sameTerminal(candidate, source.terminal)
        ? [
            boundaryCandidate(
              context,
              candidate,
              net,
              distance,
              0,
              source.boundaryKind === "control-source" ? "source" : "return",
              [sourceFunctionId],
              uniqueNetPotentialName(net),
            ),
          ]
        : [],
  );
  if (!searched.ok) return searched;
  if (searched.value.stops.length === 0) return { ok: true };
  const candidate = [...searched.value.stops].sort((left, right) =>
    compareBoundaryCandidate(context, left, right),
  )[0]!;
  return {
    ok: true,
    value: {
      candidate,
      path: Object.freeze({
        id: `loads:${load.device.uid}:${load.key}:${portId}`,
        lane: `${load.device.designation}.${load.key}.${portId}`,
        start: Object.freeze({
          terminal: cloneTerminal(source.terminal),
          boundary: candidate.boundary,
          constraint: "FIRST" as const,
        }),
        steps: Object.freeze(
          selectedSteps(
            context,
            terminal,
            source.terminal,
            searched.value.distances,
            searched.value.predecessors,
          ),
        ),
        end: Object.freeze({
          terminal: cloneTerminal(terminal),
          constraint: "LAST" as const,
        }),
      }),
    },
  };
}

function incompleteLoadsSelectionError(
  context: SelectionContext,
): IncompleteLoadsSelectionError {
  return incompleteLoadsPathError(
    context.view.root.deviceUid,
    context.view.root.designation,
  ) as IncompleteLoadsSelectionError;
}

export function selectLoadsSubgraph(
  request: SelectLoadsSubgraphRequest,
): SelectLoadsSubgraphResult {
  if (request.view.family !== "control") {
    throw new Error("Internal loads selection requires the control family.");
  }
  const catalog = request.catalog ?? SYMBOL_CATALOG;
  const created = createSelectionContext(request, false);
  if (!created.ok) return created;
  const context = created.value;
  const root = rootDevice(context);
  const resolvedSource = resolveLoadSource(context, catalog);
  if (!resolvedSource.ok) return resolvedSource;
  if (resolvedSource.value === undefined) return unsupportedRoot(context, root);

  const sourceOutputs: LoadSourceOutputWithNet[] = [];
  for (const output of resolvedSource.value.outputs) {
    const net = netFor(context, output.terminal);
    if (!net.ok) return net;
    sourceOutputs.push({ ...output, net: net.value });
  }
  const sourceNetIds = new Set(sourceOutputs.map(({ net }) => net.net.id));
  const qualified = qualifyingLoadRepresentations(
    context,
    catalog,
    sourceNetIds,
    root,
  );
  if (!qualified.ok) return qualified;
  const loads = qualified.value;

  const selections: SearchSuccess[] = [];
  const selectedLoads: CompleteLoadRepresentation[] = [];
  const provenanceNetIds = new Set<string>();
  for (const load of loads) {
    const loadTerminalKeys = new Set(
      load.loadTerminals.map((terminal) => terminalIdKey(terminal)),
    );
    const armBindings = load.rule.bindings
      .filter(({ terminalKey }) =>
        loadTerminalKeys.has(
          terminalIdKey({
            deviceUid: load.device.uid,
            terminalKey,
          }),
        ),
      )
      .map((binding) => {
        const terminal = context.terminalByKey.get(
          terminalIdKey({
            deviceUid: load.device.uid,
            terminalKey: binding.terminalKey,
          }),
        );
        if (terminal === undefined) {
          invalidLoadsMapping(
            `${load.device.typeId}.${load.key} is missing terminal ${JSON.stringify(binding.terminalKey)}.`,
          );
        }
        const net = netFor(context, terminal.id);
        if (!net.ok) return net;
        const matchingOutputs = sourceOutputs.filter(
          (output) => output.net.net.id === net.value.net.id,
        );
        if (matchingOutputs.length !== 1) {
          invalidLoadsMapping(
            `${load.device.typeId}.${load.key} terminal ${JSON.stringify(binding.terminalKey)} does not resolve to one mapped source output.`,
          );
        }
        return {
          ok: true as const,
          binding,
          terminal: terminal.id,
          source: matchingOutputs[0]!,
          sourceRank: sourceOutputs.indexOf(matchingOutputs[0]!),
        };
      });
    const failedBinding = armBindings.find((binding) => !binding.ok);
    if (failedBinding !== undefined && !failedBinding.ok) return failedBinding;
    const orderedBindings = armBindings
      .filter(
        (
          binding,
        ): binding is Extract<(typeof armBindings)[number], { ok: true }> =>
          binding.ok,
      )
      .sort(
        (left, right) =>
          left.sourceRank - right.sourceRank ||
          compareText(left.binding.portId, right.binding.portId),
      );
    if (orderedBindings.length !== load.loadTerminals.length) {
      invalidLoadsMapping(
        `${load.device.typeId}.${load.key} does not bind every qualifying load terminal.`,
      );
    }

    const loadSelections: SearchSuccess[] = [];
    let complete = true;
    for (const { binding, terminal, source } of orderedBindings) {
      const arm = selectLoadArm(
        context,
        source,
        load,
        binding.portId,
        terminal,
        resolvedSource.value.functionId,
      );
      if (!arm.ok) return arm;
      if (arm.value === undefined) {
        complete = false;
        break;
      }
      loadSelections.push(arm.value);
    }
    if (!complete) continue;

    if (load.kind === "aggregate") {
      for (const binding of load.rule.bindings) {
        const terminalKey = terminalIdKey({
          deviceUid: load.device.uid,
          terminalKey: binding.terminalKey,
        });
        if (loadTerminalKeys.has(terminalKey)) continue;
        const terminal = context.terminalByKey.get(terminalKey);
        if (terminal === undefined) {
          invalidLoadsMapping(
            `${load.device.typeId}.${load.key} is missing aggregate terminal ${JSON.stringify(binding.terminalKey)}.`,
          );
        }
        const net = netFor(context, terminal.id);
        if (!net.ok) return net;
        provenanceNetIds.add(net.value.net.id);
      }
    }
    selections.push(...loadSelections);
    selectedLoads.push(load);
  }

  if (selectedLoads.length === 0) {
    return Object.freeze({
      ok: false,
      error: incompleteLoadsSelectionError(context),
    });
  }
  const displayFunctions = pathTerminalDisplayFunctionIds(
    context,
    selections,
    invalidLoadsMapping,
    [
      resolvedSource.value.functionId,
      ...selectedLoads.flatMap(({ functionIds }) => functionIds),
    ],
  );
  if (!displayFunctions.ok) return displayFunctions;
  return Object.freeze({
    ok: true,
    value: buildSelectedSubgraph(
      context,
      Object.freeze(selections),
      Object.freeze([
        resolvedSource.value.functionId,
        ...selectedLoads.flatMap(({ functionIds }) => functionIds),
        ...displayFunctions.value,
      ]),
      Object.freeze([...provenanceNetIds]),
    ),
  });
}

function qualifyingLoadRepresentations(
  context: SelectionContext,
  catalog: readonly SymbolDefinition[],
  sourceNetIds: ReadonlySet<string>,
  root: IrDevice,
):
  | { readonly ok: true; readonly value: readonly CompleteLoadRepresentation[] }
  | {
      readonly ok: false;
      readonly error: QueryError | UnsupportedSymbolMappingError;
    } {
  const accumulators = new Map<string, LoadRepresentationAccumulator>();
  const materializedLoads = [...context.functionByKey.values()]
    .filter(
      (materialized) =>
        materialized.kind === "load" && materialized.id.deviceUid !== root.uid,
    )
    .sort((left, right) =>
      compareFunctionId(
        left.id,
        right.id,
        (uid) => designationFor(context, uid),
        (id) => functionMappingOrder(context, id),
      ),
    );

  for (const materialized of materializedLoads) {
    const terminalNets = new Map<string, NetResult>();
    for (const terminal of materialized.terminals) {
      const net = netFor(context, terminal);
      if (!net.ok) return net;
      terminalNets.set(terminalIdKey(terminal), net.value);
    }
    const representedNetIds = new Set(
      [...terminalNets.values()].map(({ net }) => net.id),
    );
    if (
      representedNetIds.size < 2 ||
      [...representedNetIds].some((netId) => !sourceNetIds.has(netId))
    ) {
      continue;
    }

    const device = context.deviceByUid.get(materialized.id.deviceUid);
    if (device === undefined) {
      throw new Error("Materialized load device is absent from ElectricalIr.");
    }
    const mapping = context.mappingByTypeId.get(device.typeId);
    const resolved = resolveSelectedSymbolRule({
      deviceType: deviceTypeFor(context, device),
      deviceUid: device.uid,
      materializedFunctions: context.ir.functions.filter(
        ({ id }) => id.deviceUid === device.uid,
      ),
      functionKey: materialized.id.functionKey,
      family: "control",
      root: context.view.root.designation,
      ...(mapping === undefined ? {} : { mapping }),
      catalog,
    });
    if (!resolved.ok) return resolved;
    const representationKey =
      resolved.value.kind === "function"
        ? resolved.value.rule.functionKey
        : resolved.value.rule.key;
    const structuralKey = JSON.stringify([
      device.uid,
      resolved.value.kind,
      representationKey,
    ]);
    let accumulator = accumulators.get(structuralKey);
    if (accumulator === undefined) {
      const functionKeys =
        resolved.value.kind === "function"
          ? [resolved.value.rule.functionKey]
          : resolved.value.rule.functionKeys;
      accumulator = {
        key: representationKey,
        kind: resolved.value.kind,
        device,
        rule: resolved.value.rule,
        functionIds: Object.freeze(
          functionKeys.map((functionKey) => {
            const functionId = { deviceUid: device.uid, functionKey };
            if (!context.functionByKey.has(functionIdKey(functionId))) {
              invalidLoadsMapping(
                `${device.typeId}.${functionKey} is not materialized for its selected representation.`,
              );
            }
            return cloneFunction(functionId);
          }),
        ),
        loadTerminals: new Map(),
      };
      accumulators.set(structuralKey, accumulator);
    }
    for (const terminal of materialized.terminals) {
      accumulator.loadTerminals.set(
        terminalIdKey(terminal),
        cloneTerminal(terminal),
      );
    }
  }

  const loads: CompleteLoadRepresentation[] = [...accumulators.values()]
    .map((value) => ({
      key: value.key,
      kind: value.kind,
      device: value.device,
      rule: value.rule,
      functionIds: value.functionIds,
      loadTerminals: Object.freeze(
        [...value.loadTerminals.values()].sort((left, right) =>
          compareCompleteTerminal(context, left, right),
        ),
      ),
    }))
    .sort((left, right) =>
      compareCompleteLoadRepresentation(context, left, right),
    );

  return { ok: true, value: loads };
}
