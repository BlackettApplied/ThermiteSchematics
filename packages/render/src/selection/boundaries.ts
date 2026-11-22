import type { IrDevice, FunctionId, TerminalId } from "@thermite/compiler";
import type { NetResult } from "@thermite/query";
import { cloneTerminal, cloneFunction } from "../internal.js";
import { compareText, functionIdKey, terminalIdKey } from "../ordering.js";
import type {
  DeviceTypeSymbolMapping,
  BoundaryTerminalRule,
} from "../symbols/mappings.js";
import type { SelectedBoundary } from "../types.js";
import { designationFor } from "./context.js";
import type { SelectionContext, BoundaryCandidate } from "./contracts.js";

export function uniqueNetPotentialName(net: NetResult): string | undefined {
  const names = [...new Set(net.net.potentials.map(({ name }) => name))].sort(
    compareText,
  );
  return names.length === 1 ? names[0] : undefined;
}

function mappedBoundaryFunctionIds(
  context: SelectionContext,
  device: IrDevice,
  mapping: DeviceTypeSymbolMapping,
  rule: BoundaryTerminalRule,
): readonly FunctionId[] {
  const direct = mapping.functions.filter(
    (candidate) =>
      candidate.functionKey === rule.functionKey &&
      candidate.families.includes(context.view.family) &&
      candidate.traversalRole === "source-boundary" &&
      candidate.bindings.some(
        ({ terminalKey }) => terminalKey === rule.terminalKey,
      ),
  );
  const aggregate = mapping.aggregates.filter(
    (candidate) =>
      candidate.functionKeys.includes(rule.functionKey) &&
      candidate.families.includes(context.view.family) &&
      candidate.traversalRole === "source-boundary" &&
      candidate.bindings.some(
        ({ terminalKey, memberFunctionKey }) =>
          terminalKey === rule.terminalKey &&
          memberFunctionKey === rule.functionKey,
      ),
  );
  if (direct.length + aggregate.length !== 1) return [];
  const keys =
    direct.length === 1 ? [direct[0]!.functionKey] : aggregate[0]!.functionKeys;
  const ids = keys
    .map((functionKey) => ({ deviceUid: device.uid, functionKey }))
    .filter((id) => context.functionByKey.has(functionIdKey(id)));
  return ids.length === keys.length ? ids : [];
}

function boundaryLabel(
  context: SelectionContext,
  terminal: TerminalId,
  displayName: string | undefined,
): string {
  if (displayName !== undefined) return displayName;
  const designation = designationFor(context, terminal.deviceUid);
  return `${designation}.${terminal.terminalKey}`;
}

export function boundaryCandidate(
  context: SelectionContext,
  terminal: TerminalId,
  net: NetResult,
  distance: number,
  classRank: number,
  kind: SelectedBoundary["kind"],
  functionIds: readonly FunctionId[],
  displayName?: string,
  potentialUid?: string,
): BoundaryCandidate {
  return {
    classRank,
    distance,
    ...(displayName === undefined ? {} : { displayName }),
    ...(potentialUid === undefined ? {} : { potentialUid }),
    boundary: Object.freeze({
      kind,
      terminal: cloneTerminal(terminal),
      netId: net.net.id,
      ...(potentialUid === undefined ? {} : { potentialUid }),
      label: boundaryLabel(context, terminal, displayName),
    }),
    functionIds: Object.freeze(functionIds.map(cloneFunction)),
  };
}

export function exactPotentialCandidates(
  context: SelectionContext,
  terminal: TerminalId,
  net: NetResult,
  distance: number,
  polarity: "positive" | "return" | "protective_earth",
  classRank: number,
): readonly BoundaryCandidate[] {
  return (context.potentialAnchors.get(terminalIdKey(terminal)) ?? [])
    .filter(({ electrical }) => electrical.polarity === polarity)
    .map((potential) =>
      boundaryCandidate(
        context,
        terminal,
        net,
        distance,
        classRank,
        "potential",
        [],
        potential.name,
        potential.uid,
      ),
    );
}

export function mappedBoundaryCandidates(
  context: SelectionContext,
  terminal: TerminalId,
  net: NetResult,
  distance: number,
  boundaryKind: BoundaryTerminalRule["boundaryKind"],
  classRank: number,
  powerLaneRank?: number,
): readonly BoundaryCandidate[] {
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
  const rules = mapping.boundaryTerminals.filter(
    (rule) =>
      rule.boundaryKind === boundaryKind &&
      rule.families.includes(context.view.family) &&
      rule.terminalKey === terminal.terminalKey &&
      terminalFact.role === rule.requiredRole,
  );
  const candidates: BoundaryCandidate[] = [];
  for (const rule of rules) {
    if (powerLaneRank !== undefined) {
      const phaseRules = mapping.boundaryTerminals.filter(
        (candidate) =>
          candidate.boundaryKind === "power-source" &&
          candidate.families.includes("power"),
      );
      if (phaseRules.indexOf(rule) !== powerLaneRank) continue;
    }
    const functionIds = mappedBoundaryFunctionIds(
      context,
      device,
      mapping,
      rule,
    );
    if (functionIds.length === 0) continue;
    candidates.push(
      boundaryCandidate(
        context,
        terminal,
        net,
        distance,
        classRank,
        boundaryKind === "control-return" ? "return" : "source",
        functionIds,
        uniqueNetPotentialName(net),
      ),
    );
  }
  return candidates;
}

export function compareBoundaryCandidate(
  context: SelectionContext,
  left: BoundaryCandidate,
  right: BoundaryCandidate,
): number {
  const leftTerminal = left.boundary.terminal;
  const rightTerminal = right.boundary.terminal;
  return (
    left.classRank - right.classRank ||
    left.distance - right.distance ||
    (left.displayName === undefined ? 1 : 0) -
      (right.displayName === undefined ? 1 : 0) ||
    compareText(left.displayName ?? "", right.displayName ?? "") ||
    compareText(
      designationFor(context, leftTerminal.deviceUid),
      designationFor(context, rightTerminal.deviceUid),
    ) ||
    compareText(leftTerminal.terminalKey, rightTerminal.terminalKey) ||
    // W902 permits exact duplicate declarations at one anchor. Their authored
    // source positions break this final tie; instance identity never does.
    (left.potentialUid === right.potentialUid
      ? 0
      : context.order.compare(
          left.potentialUid ?? "",
          right.potentialUid ?? "",
        ))
  );
}
