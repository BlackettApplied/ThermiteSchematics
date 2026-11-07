// Actuation family selection: selectControlPaths.
import type { TerminalId, IrDevice, FunctionId } from "@thermite/compiler";
import type { NetResult } from "@thermite/query";
import { incompleteControlPathError } from "../errors.js";
import {
  sameTerminal,
  withStoppedTerminals,
  cloneFunction,
} from "../internal.js";
import { compareText, functionIdKey } from "../ordering.js";
import {
  exactPotentialCandidates,
  mappedBoundaryCandidates,
  boundaryCandidate,
  uniqueNetPotentialName,
} from "./boundaries.js";
import { rootDevice, unsupportedRoot } from "./context.js";
import type {
  RootPathSelectionResult,
  BoundaryCandidate,
  SearchSpec,
  SelectionContext,
  SearchSuccess,
} from "./contracts.js";
import { compareSelectedStep, searchPath } from "./traversal.js";

function compareControlSelection(
  context: SelectionContext,
  left: SearchSuccess,
  right: SearchSuccess,
): number {
  const ranked =
    left.candidate.classRank - right.candidate.classRank ||
    left.candidate.distance - right.candidate.distance;
  if (ranked !== 0) return ranked;
  const count = Math.min(left.path.steps.length, right.path.steps.length);
  for (let index = 0; index < count; index++) {
    const compared = compareSelectedStep(
      context,
      left.path.steps[index]!,
      right.path.steps[index]!,
    );
    if (compared !== 0) return compared;
  }
  return (
    left.path.steps.length - right.path.steps.length ||
    compareText(left.path.id, right.path.id)
  );
}

function channelCandidates(
  context: SelectionContext,
  terminal: TerminalId,
  net: NetResult,
  distance: number,
): readonly BoundaryCandidate[] {
  const candidates: BoundaryCandidate[] = [];
  for (const materialized of context.functionByKey.values()) {
    if (
      materialized.kind !== "channel" ||
      materialized.direction !== "output" ||
      !materialized.terminals.some((candidate) =>
        sameTerminal(candidate, terminal),
      )
    ) {
      continue;
    }
    const device = context.deviceByUid.get(materialized.id.deviceUid);
    const mapping =
      device === undefined
        ? undefined
        : context.mappingByTypeId.get(device.typeId);
    const rules = mapping?.functions.filter(
      (rule) =>
        rule.functionKey === materialized.id.functionKey &&
        rule.families.includes("control") &&
        rule.traversalRole === "channel-boundary" &&
        rule.bindings.some(
          ({ terminalKey }) => terminalKey === terminal.terminalKey,
        ),
    );
    if (rules?.length !== 1) continue;
    candidates.push(
      boundaryCandidate(
        context,
        terminal,
        net,
        distance,
        0,
        "channel",
        [materialized.id],
        uniqueNetPotentialName(net),
      ),
    );
  }
  return candidates;
}

function controlRoot(
  context: SelectionContext,
  device: IrDevice,
):
  | {
      readonly functionId: FunctionId;
      readonly input: TerminalId;
      readonly return: TerminalId;
    }
  | undefined {
  const mapping = context.mappingByTypeId.get(device.typeId);
  const rules = mapping?.functions.filter(
    (rule) =>
      rule.families.includes("control") && rule.traversalRole === "coil-root",
  );
  if (rules?.length !== 1) return undefined;
  const rule = rules[0]!;
  const materialized = context.functionByKey.get(
    functionIdKey({ deviceUid: device.uid, functionKey: rule.functionKey }),
  );
  const inputBinding = rule.bindings.find(({ portId }) => portId === "A1");
  const returnBinding = rule.bindings.find(({ portId }) => portId === "A2");
  if (
    materialized === undefined ||
    inputBinding === undefined ||
    returnBinding === undefined ||
    materialized.terminals.length !== 2
  ) {
    return undefined;
  }
  const input = materialized.terminals.find(
    ({ terminalKey }) => terminalKey === inputBinding.terminalKey,
  );
  const returnTerminal = materialized.terminals.find(
    ({ terminalKey }) => terminalKey === returnBinding.terminalKey,
  );
  if (input === undefined || returnTerminal === undefined) return undefined;
  return {
    functionId: materialized.id,
    input,
    return: returnTerminal,
  };
}

export function selectControlPaths(
  context: SelectionContext,
): RootPathSelectionResult {
  const device = rootDevice(context);
  const root = controlRoot(context, device);
  if (root === undefined) return unsupportedRoot(context, device);
  const searches = [
    {
      start: root.input,
      spec: { kind: "control-input", lane: "input" } as const,
    },
    {
      start: root.return,
      spec: { kind: "control-return", lane: "return" } as const,
    },
  ];
  const paths: SearchSuccess[] = [];
  for (const search of searches) {
    const result = searchPath(context, search.start, {
      lane: search.spec.lane,
      allowFunctions: true,
      boundaryAtEnd: search.spec.kind === "control-return",
      constrainRoot: false,
      boundaries: (context, terminal, net, distance) =>
        controlBoundaryCandidates(
          context,
          terminal,
          net,
          distance,
          search.spec,
        ),
    });
    if (!result.ok) return result;
    if (result.value === undefined) {
      return {
        ok: false,
        error: withStoppedTerminals(
          incompleteControlPathError(
            device.uid,
            search.spec.lane,
            context.view.root.designation,
          ),
          result.stoppedAt ?? [search.start],
        ),
      };
    }
    paths.push(result.value);
  }
  return {
    ok: true,
    paths: Object.freeze(
      paths.sort((left, right) =>
        compareControlSelection(context, left, right),
      ),
    ),
    rootFunctionIds: Object.freeze([cloneFunction(root.functionId)]),
  };
}

function controlBoundaryCandidates(
  context: SelectionContext,
  terminal: TerminalId,
  net: NetResult,
  distance: number,
  spec: Extract<SearchSpec, { kind: "control-input" | "control-return" }>,
): readonly BoundaryCandidate[] {
  if (distance <= 0) return [];
  switch (spec.kind) {
    case "control-input":
      return [
        ...channelCandidates(context, terminal, net, distance),
        ...exactPotentialCandidates(
          context,
          terminal,
          net,
          distance,
          "positive",
          1,
        ),
        ...mappedBoundaryCandidates(
          context,
          terminal,
          net,
          distance,
          "control-source",
          2,
        ),
      ];
    case "control-return":
      return [
        ...exactPotentialCandidates(
          context,
          terminal,
          net,
          distance,
          "return",
          0,
        ),
        ...mappedBoundaryCandidates(
          context,
          terminal,
          net,
          distance,
          "control-return",
          1,
        ),
      ];
  }
}
