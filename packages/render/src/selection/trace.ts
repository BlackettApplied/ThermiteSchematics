// Trace family selection: selectTraceSubgraph.
import type { FunctionId, TerminalId, IrDevice } from "@thermite/compiler";
import type { NetResult } from "@thermite/query";
import {
  InvalidSymbolMappingError,
  incompleteTracePathError,
} from "../errors.js";
import {
  type TraceRootRule,
  type TraceRootPortRole,
  type TraceRootPortRule,
  traceRootRuleForType,
  materializedTraceRootFunctions,
  validateTraceRootRules,
} from "../intent-rules.js";
import {
  cloneFunction,
  cloneTerminal,
  sameTerminal,
  withStoppedTerminals,
} from "../internal.js";
import {
  terminalIdKey,
  compareStructuralFunctionId,
  functionIdKey,
} from "../ordering.js";
import { projectDeviceTypeSymbolMappings } from "../symbols/mappings.js";
import { validateMaterializedFunctionFacts } from "../symbols/validate.js";
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
  deviceTypeFor,
  compareCompleteTerminal,
  rootDevice,
  createSelectionContext,
  unsupportedRoot,
} from "./context.js";
import type {
  SelectionContext,
  BoundaryCandidate,
  SearchResult,
  IncompleteTraceSelectionError,
  SelectTraceSubgraphRequest,
  SelectTraceSubgraphResult,
  SearchSuccess,
} from "./contracts.js";
import {
  searchConductors,
  selectedSteps,
  reverseSelectedSteps,
  netFor,
} from "./traversal.js";

interface ResolvedTraceRoot {
  readonly rule: TraceRootRule;
  readonly functionIds: readonly FunctionId[];
  readonly portByRole: ReadonlyMap<TraceRootPortRole, TraceRootPortRule>;
  readonly terminalByRole: ReadonlyMap<TraceRootPortRole, TerminalId>;
}

interface TraceTargetChannel {
  readonly functionId: FunctionId;
  readonly terminal: TerminalId;
  readonly mappingOrder: number;
}

interface TraceTargetStop extends TraceTargetChannel {
  readonly distance: number;
  readonly net: NetResult;
}

function invalidTraceMapping(detail: string): never {
  throw new InvalidSymbolMappingError(`Invalid trace mapping: ${detail}`);
}

function resolveTraceRoot(
  context: SelectionContext,
  device: IrDevice,
): ResolvedTraceRoot | undefined {
  const rule = traceRootRuleForType(
    device.typeId,
    deviceTypeFor(context, device),
    context.mappingByTypeId.get(device.typeId),
  );
  if (rule === undefined) return undefined;
  const materialized = materializedTraceRootFunctions(
    rule,
    device.uid,
    deviceTypeFor(context, device),
    context.ir.functions,
  );
  const portByRole = new Map<TraceRootPortRole, TraceRootPortRule>();
  const terminalByRole = new Map<TraceRootPortRole, TerminalId>();
  for (const port of rule.representation.ports) {
    const terminal = context.terminalByKey.get(
      terminalIdKey({
        deviceUid: device.uid,
        terminalKey: port.terminalKey,
      }),
    );
    if (terminal === undefined) {
      invalidTraceMapping(
        `${device.typeId} instance ${JSON.stringify(device.uid)} is missing terminal ${JSON.stringify(port.terminalKey)}.`,
      );
    }
    portByRole.set(port.role, port);
    terminalByRole.set(port.role, terminal.id);
  }
  return {
    rule,
    functionIds: Object.freeze(materialized.map(({ id }) => cloneFunction(id))),
    portByRole,
    terminalByRole,
  };
}

function targetInputChannels(
  context: SelectionContext,
  target: IrDevice,
): readonly TraceTargetChannel[] {
  const mapping = context.mappingByTypeId.get(target.typeId);
  if (mapping === undefined) return [];
  const deviceType = deviceTypeFor(context, target);
  const channels: TraceTargetChannel[] = [];
  for (const materialized of context.functionByKey.values()) {
    if (
      materialized.id.deviceUid !== target.uid ||
      materialized.kind !== "channel" ||
      materialized.direction !== "input"
    ) {
      continue;
    }
    validateMaterializedFunctionFacts(deviceType, materialized);
    const rules = mapping.functions.filter(
      (rule) =>
        rule.functionKey === materialized.id.functionKey &&
        rule.families.includes("control") &&
        rule.traversalRole === "channel-boundary",
    );
    if (rules.length === 0) continue;
    if (rules.length !== 1) {
      invalidTraceMapping(
        `${target.typeId}.${materialized.id.functionKey} has ambiguous input-channel mappings.`,
      );
    }
    const rule = rules[0]!;
    const bindings = rule.bindings.filter(({ terminalKey }) =>
      materialized.terminals.some(
        (terminal) => terminal.terminalKey === terminalKey,
      ),
    );
    if (bindings.length !== 1 || materialized.terminals.length !== 1) {
      invalidTraceMapping(
        `${target.typeId}.${materialized.id.functionKey} must map one input terminal.`,
      );
    }
    channels.push({
      functionId: cloneFunction(materialized.id),
      terminal: cloneTerminal(materialized.terminals[0]!),
      mappingOrder: mapping.functions.indexOf(rule),
    });
  }
  return Object.freeze(
    channels.sort(
      (left, right) =>
        left.mappingOrder - right.mappingOrder ||
        compareCompleteTerminal(context, left.terminal, right.terminal) ||
        compareStructuralFunctionId(left.functionId, right.functionId),
    ),
  );
}

function mappedTraceBoundaryFunctionIds(
  context: SelectionContext,
  terminal: TerminalId,
  boundaryKind: "control-source" | "control-return",
): readonly FunctionId[] {
  const terminalFact = context.terminalByKey.get(terminalIdKey(terminal));
  const device = context.deviceByUid.get(terminal.deviceUid);
  const mapping =
    device === undefined
      ? undefined
      : context.mappingByTypeId.get(device.typeId);
  if (
    terminalFact === undefined ||
    device === undefined ||
    mapping === undefined
  ) {
    return [];
  }
  const locationRules = mapping.boundaryTerminals.filter(
    (rule) =>
      rule.boundaryKind === boundaryKind &&
      rule.families.includes("control") &&
      rule.terminalKey === terminal.terminalKey,
  );
  if (locationRules.length === 0) return [];
  if (
    locationRules.length !== 1 ||
    locationRules[0]!.requiredRole !== terminalFact.role
  ) {
    invalidTraceMapping(
      `${device.typeId}.${terminal.terminalKey} has ambiguous or contradictory ${boundaryKind} metadata.`,
    );
  }
  const boundaryRule = locationRules[0]!;
  const direct = mapping.functions.filter(
    (rule) =>
      rule.functionKey === boundaryRule.functionKey &&
      rule.families.includes("control") &&
      rule.traversalRole === "source-boundary" &&
      rule.bindings.some(
        ({ terminalKey }) => terminalKey === terminal.terminalKey,
      ),
  );
  const aggregate = mapping.aggregates.filter(
    (rule) =>
      rule.functionKeys.includes(boundaryRule.functionKey) &&
      rule.families.includes("control") &&
      rule.traversalRole === "source-boundary" &&
      rule.bindings.some(
        ({ terminalKey, memberFunctionKey }) =>
          terminalKey === terminal.terminalKey &&
          memberFunctionKey === boundaryRule.functionKey,
      ),
  );
  if (direct.length + aggregate.length !== 1) {
    invalidTraceMapping(
      `${device.typeId}.${boundaryRule.functionKey} has ambiguous or contradictory source representation metadata.`,
    );
  }
  const keys =
    direct.length === 1 ? [direct[0]!.functionKey] : aggregate[0]!.functionKeys;
  const deviceType = deviceTypeFor(context, device);
  return Object.freeze(
    keys.map((functionKey) => {
      const materialized = context.functionByKey.get(
        functionIdKey({ deviceUid: device.uid, functionKey }),
      );
      if (materialized === undefined) {
        invalidTraceMapping(
          `${device.typeId}.${functionKey} is not materialized at its boundary.`,
        );
      }
      validateMaterializedFunctionFacts(deviceType, materialized);
      return cloneFunction(materialized.id);
    }),
  );
}

function tracePowerBoundaryCandidates(
  context: SelectionContext,
  terminal: TerminalId,
  net: NetResult,
  distance: number,
  role: "positive-supply" | "return-supply",
): readonly BoundaryCandidate[] {
  const polarity = role === "positive-supply" ? "positive" : "return";
  const boundaryKind =
    role === "positive-supply" ? "control-source" : "control-return";
  const functionIds = mappedTraceBoundaryFunctionIds(
    context,
    terminal,
    boundaryKind,
  );
  const potentials = (
    context.potentialAnchors.get(terminalIdKey(terminal)) ?? []
  )
    .filter(({ electrical }) => electrical.polarity === polarity)
    .map((potential) =>
      boundaryCandidate(
        context,
        terminal,
        net,
        distance,
        0,
        "potential",
        functionIds,
        potential.name,
        potential.uid,
      ),
    );
  return [
    ...potentials,
    ...(functionIds.length === 0
      ? []
      : [
          boundaryCandidate(
            context,
            terminal,
            net,
            distance,
            1,
            role === "positive-supply" ? "source" : "return",
            functionIds,
            uniqueNetPotentialName(net),
          ),
        ]),
  ];
}

function compareTraceTargetStop(
  context: SelectionContext,
  left: TraceTargetStop,
  right: TraceTargetStop,
): number {
  return (
    left.distance - right.distance ||
    left.mappingOrder - right.mappingOrder ||
    compareCompleteTerminal(context, left.terminal, right.terminal) ||
    compareStructuralFunctionId(left.functionId, right.functionId)
  );
}

function selectTraceSignal(
  context: SelectionContext,
  start: TerminalId,
  channels: readonly TraceTargetChannel[],
): SearchResult {
  const channelByTerminal = new Map<string, TraceTargetChannel[]>();
  for (const channel of channels) {
    const key = terminalIdKey(channel.terminal);
    channelByTerminal.set(key, [
      ...(channelByTerminal.get(key) ?? []),
      channel,
    ]);
  }
  const searched = searchConductors(context, start, (terminal, net, distance) =>
    (channelByTerminal.get(terminalIdKey(terminal)) ?? []).map((channel) => ({
      ...channel,
      distance,
      net,
    })),
  );
  if (!searched.ok) return searched;
  if (searched.value.stops.length === 0) return { ok: true };
  const target = [...searched.value.stops].sort((left, right) =>
    compareTraceTargetStop(context, left, right),
  )[0]!;
  const boundary = boundaryCandidate(
    context,
    target.terminal,
    target.net,
    target.distance,
    0,
    "channel",
    [target.functionId],
    uniqueNetPotentialName(target.net),
  );
  const backward = selectedSteps(
    context,
    start,
    target.terminal,
    searched.value.distances,
    searched.value.predecessors,
  );
  return {
    ok: true,
    value: {
      candidate: boundary,
      path: Object.freeze({
        id: "trace:signal",
        lane: "signal",
        start: Object.freeze({ terminal: cloneTerminal(start) }),
        steps: Object.freeze(reverseSelectedSteps(backward)),
        end: Object.freeze({
          terminal: cloneTerminal(target.terminal),
          boundary: boundary.boundary,
          constraint: "LAST" as const,
        }),
      }),
    },
  };
}

function selectTracePowerArm(
  context: SelectionContext,
  start: TerminalId,
  role: "positive-supply" | "return-supply",
): SearchResult {
  const searched = searchConductors(context, start, (terminal, net, distance) =>
    tracePowerBoundaryCandidates(context, terminal, net, distance, role),
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
        id: `trace:${role}`,
        lane: role,
        start: Object.freeze({
          terminal: cloneTerminal(candidate.boundary.terminal),
          boundary: candidate.boundary,
          constraint: "FIRST" as const,
        }),
        steps: Object.freeze(
          selectedSteps(
            context,
            start,
            candidate.boundary.terminal,
            searched.value.distances,
            searched.value.predecessors,
          ),
        ),
        end: Object.freeze({ terminal: cloneTerminal(start) }),
      }),
    },
  };
}

function incompleteTraceSelectionError(
  context: SelectionContext,
  targetDeviceUid: string,
  segment: IncompleteTraceSelectionError["segment"],
): IncompleteTraceSelectionError {
  const root = resolveTraceRoot(context, rootDevice(context));
  const start = root?.terminalByRole.get(segment);
  const reachable = start
    ? context.engine.followConductive([start])
    : undefined;
  const terminals = reachable?.ok
    ? reachable.value.flatMap((c) => c.visits.map((v) => v.terminal.id))
    : [];
  const ends = terminals.filter(
    (t) =>
      start &&
      !sameTerminal(t, start) &&
      (context.ir.indexes.conductiveElementIdsByTerminal.find((e) =>
        sameTerminal(e.key, t),
      )?.value.length ?? 0) <= 1,
  );
  return withStoppedTerminals(
    incompleteTracePathError(
      context.view.root.deviceUid,
      targetDeviceUid,
      segment,
      context.view.root.designation,
    ),
    ends.length ? ends : start ? [start] : [],
  ) as IncompleteTraceSelectionError;
}

export function selectTraceSubgraph(
  request: SelectTraceSubgraphRequest,
): SelectTraceSubgraphResult {
  if (request.view.family !== "control") {
    throw new Error("Internal trace selection requires the control family.");
  }
  const mappings =
    request.mappings ?? projectDeviceTypeSymbolMappings(request.ir);
  validateTraceRootRules(request.ir.deviceTypes, mappings);
  const created = createSelectionContext(request, false);
  if (!created.ok) return created;
  const context = created.value;
  const root = rootDevice(context);
  const targetDevice = context.deviceByUid.get(request.target.deviceUid);
  if (targetDevice === undefined) {
    throw new Error(
      `Normalized trace target ${JSON.stringify(request.target.deviceUid)} is absent from ElectricalIr.`,
    );
  }
  if (
    root.uid === targetDevice.uid ||
    root.designation !== context.view.root.designation ||
    targetDevice.designation !== request.target.designation
  ) {
    throw new Error("Normalized trace root/target identity is inconsistent.");
  }

  const traceRoot = resolveTraceRoot(context, root);
  if (traceRoot === undefined) return unsupportedRoot(context, root);
  const channels = targetInputChannels(context, targetDevice);
  if (channels.length === 0) return unsupportedRoot(context, targetDevice);

  const signalTerminal = traceRoot.terminalByRole.get("signal");
  if (signalTerminal === undefined) {
    invalidTraceMapping(`${traceRoot.rule.typeId} has no signal terminal.`);
  }
  const signal = selectTraceSignal(context, signalTerminal, channels);
  if (!signal.ok) return signal;
  if (signal.value === undefined) {
    return {
      ok: false,
      error: incompleteTraceSelectionError(context, targetDevice.uid, "signal"),
    };
  }

  const selections: SearchSuccess[] = [signal.value];
  const selectedRoles = new Set<TraceRootPortRole>(["signal"]);
  if (request.includePower) {
    for (const role of [
      "positive-supply",
      "return-supply",
    ] as const satisfies readonly TraceRootPortRole[]) {
      if (!traceRoot.portByRole.has(role)) continue;
      const terminal = traceRoot.terminalByRole.get(role);
      if (terminal === undefined) {
        invalidTraceMapping(
          `${traceRoot.rule.typeId} has no ${role} terminal.`,
        );
      }
      const arm = selectTracePowerArm(context, terminal, role);
      if (!arm.ok) return arm;
      if (arm.value === undefined) {
        return {
          ok: false,
          error: incompleteTraceSelectionError(context, targetDevice.uid, role),
        };
      }
      selections.push(arm.value);
      selectedRoles.add(role);
    }
  }

  const provenanceNetIds: string[] = [];
  for (const port of traceRoot.rule.representation.ports) {
    if (selectedRoles.has(port.role)) continue;
    const terminal = traceRoot.terminalByRole.get(port.role);
    if (terminal === undefined) {
      invalidTraceMapping(
        `${traceRoot.rule.typeId} has no materialized ${port.role} terminal.`,
      );
    }
    const net = netFor(context, terminal);
    if (!net.ok) return net;
    provenanceNetIds.push(net.value.net.id);
  }

  const displayFunctions = pathTerminalDisplayFunctionIds(
    context,
    selections,
    invalidTraceMapping,
    traceRoot.functionIds,
  );
  if (!displayFunctions.ok) return displayFunctions;
  return Object.freeze({
    ok: true,
    value: buildSelectedSubgraph(
      context,
      Object.freeze(selections),
      Object.freeze([...traceRoot.functionIds, ...displayFunctions.value]),
      Object.freeze(provenanceNetIds),
    ),
  });
}
