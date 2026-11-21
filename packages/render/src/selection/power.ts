// Power family selection: selectPowerPaths.
import type { TerminalId, IrDevice, FunctionId } from "@thermite/compiler";
import type { NetResult } from "@thermite/query";
import { incompletePowerPathError } from "../errors.js";
import { withStoppedTerminals, cloneFunction } from "../internal.js";
import { functionIdKey, terminalIdKey } from "../ordering.js";
import type { DeviceTypeSymbolMapping } from "../symbols/mappings.js";
import {
  exactPotentialCandidates,
  mappedBoundaryCandidates,
} from "./boundaries.js";
import { rootDevice, unsupportedRoot } from "./context.js";
import type {
  RootPathSelectionResult,
  BoundaryCandidate,
  SelectionContext,
  SearchSuccess,
  SearchSpec,
} from "./contracts.js";
import { searchPath } from "./traversal.js";

interface RootLane {
  readonly lane: string;
  readonly terminal: TerminalId;
  readonly protectiveEarth: boolean;
}

function protectiveEarthRoles(
  mappings: readonly DeviceTypeSymbolMapping[],
): ReadonlySet<string> {
  return new Set(
    mappings.flatMap((mapping) =>
      mapping.boundaryTerminals
        .filter(
          ({ boundaryKind }) => boundaryKind === "protective-earth-source",
        )
        .map(({ requiredRole }) => requiredRole),
    ),
  );
}

function powerRoot(
  context: SelectionContext,
  device: IrDevice,
):
  | {
      readonly lanes: readonly RootLane[];
      readonly functionIds: readonly FunctionId[];
    }
  | undefined {
  const mapping = context.mappingByTypeId.get(device.typeId);
  if (mapping === undefined) return undefined;
  const roles = protectiveEarthRoles(context.mappings);
  const lanes: Omit<RootLane, "rank">[] = [];
  const functionIds = new Map<string, FunctionId>();
  for (const aggregate of mapping.aggregates) {
    if (
      !aggregate.families.includes("power") ||
      aggregate.traversalRole !== "load-boundary"
    ) {
      continue;
    }
    for (const functionKey of aggregate.functionKeys) {
      const id = { deviceUid: device.uid, functionKey };
      if (!context.functionByKey.has(functionIdKey(id))) return undefined;
      functionIds.set(functionIdKey(id), id);
    }
    for (const binding of aggregate.bindings) {
      const terminal = context.terminalByKey.get(
        terminalIdKey({
          deviceUid: device.uid,
          terminalKey: binding.terminalKey,
        }),
      );
      if (terminal === undefined) return undefined;
      lanes.push({
        lane: binding.portId,
        terminal: terminal.id,
        protectiveEarth:
          terminal.role !== undefined && roles.has(terminal.role),
      });
    }
  }
  for (const rule of mapping.functions) {
    if (
      !rule.families.includes("power") ||
      rule.traversalRole !== "load-boundary"
    ) {
      continue;
    }
    const id = { deviceUid: device.uid, functionKey: rule.functionKey };
    if (!context.functionByKey.has(functionIdKey(id))) return undefined;
    functionIds.set(functionIdKey(id), id);
    for (const binding of rule.bindings) {
      const terminal = context.terminalByKey.get(
        terminalIdKey({
          deviceUid: device.uid,
          terminalKey: binding.terminalKey,
        }),
      );
      if (terminal === undefined) return undefined;
      lanes.push({
        lane: binding.portId,
        terminal: terminal.id,
        protectiveEarth:
          terminal.role !== undefined && roles.has(terminal.role),
      });
    }
  }
  if (lanes.length === 0) return undefined;
  const ordered: readonly RootLane[] = [
    ...lanes.filter(({ protectiveEarth }) => !protectiveEarth),
    ...lanes.filter(({ protectiveEarth }) => protectiveEarth),
  ];
  return {
    lanes: Object.freeze(ordered),
    functionIds: Object.freeze([...functionIds.values()]),
  };
}

export function selectPowerPaths(
  context: SelectionContext,
): RootPathSelectionResult {
  const device = rootDevice(context);
  const root = powerRoot(context, device);
  if (root === undefined) return unsupportedRoot(context, device);
  const paths: SearchSuccess[] = [];
  let phaseRank = 0;
  for (const lane of root.lanes) {
    const spec: SearchSpec = lane.protectiveEarth
      ? { kind: "power-pe", lane: lane.lane }
      : {
          kind: "power-phase",
          lane: lane.lane,
          laneRank: phaseRank++,
        };
    const result = searchPath(context, lane.terminal, {
      lane: spec.lane,
      allowFunctions: spec.kind !== "power-pe",
      boundaryAtEnd: false,
      constrainRoot: true,
      boundaries: (context, terminal, net, distance) =>
        powerBoundaryCandidates(context, terminal, net, distance, spec),
    });
    if (!result.ok) return result;
    if (result.value === undefined) {
      return {
        ok: false,
        error: withStoppedTerminals(
          incompletePowerPathError(
            device.uid,
            lane.lane,
            context.view.root.designation,
            lane.lane === "line" || lane.lane === "neutral"
              ? {
                  terminalKey: lane.terminal.terminalKey,
                  unfed:
                    !context.ir.indexes.conductiveElementIdsByTerminal.find(
                      (e) =>
                        e.key.deviceUid === lane.terminal.deviceUid &&
                        e.key.terminalKey === lane.terminal.terminalKey,
                    )?.value.length,
                }
              : undefined,
          ),
          result.stoppedAt ?? [lane.terminal],
        ),
      };
    }
    paths.push(result.value);
  }
  return {
    ok: true,
    paths: Object.freeze(paths),
    rootFunctionIds: Object.freeze(root.functionIds.map(cloneFunction)),
  };
}

function powerBoundaryCandidates(
  context: SelectionContext,
  terminal: TerminalId,
  net: NetResult,
  distance: number,
  spec: Extract<SearchSpec, { kind: "power-phase" | "power-pe" }>,
): readonly BoundaryCandidate[] {
  if (distance <= 0) return [];
  switch (spec.kind) {
    case "power-phase":
      return mappedBoundaryCandidates(
        context,
        terminal,
        net,
        distance,
        "power-source",
        0,
        spec.laneRank,
      );
    case "power-pe":
      return [
        ...exactPotentialCandidates(
          context,
          terminal,
          net,
          distance,
          "protective_earth",
          0,
        ),
        ...mappedBoundaryCandidates(
          context,
          terminal,
          net,
          distance,
          "protective-earth-source",
          1,
        ),
      ];
  }
}
