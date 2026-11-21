import type { TerminalId } from "@thermite/compiler";
import type { NetResult } from "@thermite/query";
import {
  incompleteControlPathError,
  type IncompletePathError,
} from "../errors.js";
import { sameTerminal, withStoppedTerminals } from "../internal.js";
import { functionIdKey, terminalIdKey } from "../ordering.js";
import { designationFor } from "./context.js";
import { searchPath } from "./traversal.js";
import type {
  BoundaryCandidate,
  SearchSuccess,
  SearchResult,
  RootedPathSearch,
  SelectionContext,
} from "./contracts.js";

type Boundaries = RootedPathSearch["boundaries"];
export interface ControlArm {
  readonly start: TerminalId;
  readonly policy: RootedPathSearch;
  readonly result: SearchResult;
  readonly candidates: readonly BoundaryCandidate[];
}

/** Observe the unchanged search's stop set; every accepted boundary still stops. */
export function searchControlArm(
  context: SelectionContext,
  start: TerminalId,
  policy: RootedPathSearch,
): ControlArm {
  const candidates = new Map<string, BoundaryCandidate>();
  const observe: Boundaries = (c, t, n, d) => {
    const stops = policy.boundaries(c, t, n, d);
    for (const stop of stops) candidates.set(candidateKey(stop), stop);
    return stops;
  };
  return {
    start,
    policy,
    result: searchPath(context, start, { ...policy, boundaries: observe }),
    candidates: [...candidates.values()],
  };
}
function candidateKey(candidate: BoundaryCandidate): string {
  return JSON.stringify([
    terminalIdKey(candidate.boundary.terminal),
    candidate.functionIds.map(functionIdKey),
    candidate.boundary.kind,
  ]);
}
function isWinding(
  context: SelectionContext,
  candidate: BoundaryCandidate,
): boolean {
  if (candidate.functionIds.length !== 1) return false;
  const id = candidate.functionIds[0];
  if (!id) return false;
  const device = context.deviceByUid.get(id.deviceUid);
  return (
    context.mappingByTypeId
      .get(device?.typeId ?? "")
      ?.functions.some(
        (r) =>
          r.functionKey === id.functionKey &&
          r.symbolId === "ais:source-winding" &&
          r.traversalRole === "source-boundary" &&
          r.families.includes("control"),
      ) ?? false
  );
}
function boundaryRank(a: BoundaryCandidate, b: BoundaryCandidate): number {
  return a.classRank - b.classRank || a.distance - b.distance;
}
function nearestCandidates(
  candidates: readonly BoundaryCandidate[],
): readonly BoundaryCandidate[] {
  const first = candidates[0];
  if (!first) throw Error("Missing control candidates");
  const best = candidates.reduce(
    (a, b) => (boundaryRank(a, b) <= 0 ? a : b),
    first,
  );
  return candidates.filter((candidate) => boundaryRank(candidate, best) === 0);
}

type ControlPathsResult =
  | { readonly ok: true; readonly paths: readonly SearchSuccess[] }
  | {
      readonly ok: false;
      readonly error:
        IncompletePathError | Extract<SearchResult, { ok: false }>["error"];
    };

/** Ignore winding stops on both arms to reproduce the pre-winding selector. */
function baseControlPaths(
  context: SelectionContext,
  arms: readonly ControlArm[],
): ControlPathsResult {
  const paths: SearchSuccess[] = [];
  for (const arm of arms) {
    const result = searchPath(context, arm.start, {
      ...arm.policy,
      boundaries: (c, t, n, d) =>
        arm.policy
          .boundaries(c, t, n, d)
          .filter((candidate) => !isWinding(c, candidate)),
    });
    if (!result.ok) return result;
    if (!result.value) {
      const side = arm.policy.lane;
      if (side !== "input" && side !== "return")
        throw Error("Invalid control arm");
      return {
        ok: false,
        error: withStoppedTerminals(
          incompleteControlPathError(
            context.view.root.deviceUid,
            side,
            context.view.root.designation,
          ),
          result.stoppedAt ?? [arm.start],
        ),
      };
    }
    paths.push(result.value);
  }
  return { ok: true, paths };
}
export function transformerPairCompatible(
  input: BoundaryCandidate,
  ret: BoundaryCandidate,
): boolean {
  const a = input.functionIds[0],
    b = ret.functionIds[0];
  return (
    a !== undefined &&
    b !== undefined &&
    !sameTerminal(input.boundary.terminal, ret.boundary.terminal) &&
    input.boundary.netId !== ret.boundary.netId &&
    functionIdKey(a) === functionIdKey(b)
  );
}
function pairError(
  context: SelectionContext,
  input: BoundaryCandidate,
  ret: BoundaryCandidate,
  reason: "incompatible" | "multiple" | "mixed",
): IncompletePathError {
  const label = (c: BoundaryCandidate) =>
    `${designationFor(context, c.boundary.terminal.deviceUid)}.${c.boundary.terminal.terminalKey}`;
  const namedBoundary = (c: BoundaryCandidate) => {
    const designation = designationFor(context, c.boundary.terminal.deviceUid);
    return { ...c.boundary, ...(designation ? { designation } : {}) };
  };
  return {
    code: "R002",
    family: "control",
    deviceUid: context.view.root.deviceUid,
    root: context.view.root.designation,
    pathSide: "input",
    message:
      reason === "multiple"
        ? "Incomplete control view: multiple transformer source pairs match the input and return paths; use an explicit circuit view."
        : reason === "mixed"
          ? "Incomplete control view: nearest input or return paths reach both transformer and non-transformer boundaries; use an explicit circuit view."
          : `Incomplete control view: input and return must reach distinct terminals on distinct nets of the same transformer source function; reached ${label(input)} and ${label(ret)}.`,
    details: {
      reason: "transformer-source-pair",
      input: namedBoundary(input),
      return: namedBoundary(ret),
    },
  };
}
function pathFor(
  context: SelectionContext,
  arm: ControlArm,
  candidate: BoundaryCandidate,
): SearchResult {
  const boundaries = (
    c: SelectionContext,
    t: TerminalId,
    n: NetResult,
    d: number,
  ) =>
    arm.policy.boundaries(c, t, n, d).map((stop) => ({
      ...stop,
      classRank:
        candidateKey(stop) === candidateKey(candidate)
          ? -1
          : Number.MAX_SAFE_INTEGER,
    }));
  const result = searchPath(context, arm.start, {
    ...arm.policy,
    boundaryAtEnd: false,
    boundaries,
  });
  return result.ok && result.value
    ? { ok: true, value: { ...result.value, candidate } }
    : result;
}

/** A source pair is electrical identity plus wiring, never terminal-array order. */
export function pairTransformerPaths(
  context: SelectionContext,
  arms: readonly ControlArm[],
  paths: readonly SearchSuccess[],
): ControlPathsResult {
  const [input, ret] = paths,
    [inputArm, returnArm] = arms;
  if (!input || !ret || !inputArm || !returnArm)
    throw Error("Missing control arms");
  if (
    !arms.some((arm) =>
      arm.candidates.some((candidate) => isWinding(context, candidate)),
    )
  )
    return { ok: true, paths };
  const inputTier = nearestCandidates(inputArm.candidates),
    returnTier = nearestCandidates(returnArm.candidates);
  const tiers = [inputTier, returnTier];
  if (
    tiers.some(
      (tier) => !tier.some((candidate) => isWinding(context, candidate)),
    )
  )
    return baseControlPaths(context, arms);
  if (
    tiers.some((tier) =>
      tier.some((candidate) => !isWinding(context, candidate)),
    )
  )
    return {
      ok: false,
      error: pairError(context, input.candidate, ret.candidate, "mixed"),
    };
  const pairs: [BoundaryCandidate, BoundaryCandidate][] = [];
  for (const a of inputTier)
    for (const b of returnTier)
      if (transformerPairCompatible(a, b)) pairs.push([a, b]);
  const pair = pairs[0];
  if (!pair)
    return {
      ok: false,
      error: pairError(context, input.candidate, ret.candidate, "incompatible"),
    };
  if (pairs.length > 1)
    return {
      ok: false,
      error: pairError(context, pair[0], pair[1], "multiple"),
    };
  const selected: SearchSuccess[] = [];
  for (const [arm, candidate] of [
    [inputArm, pair[0]],
    [returnArm, pair[1]],
  ] as const) {
    const r = pathFor(context, arm, candidate);
    if (!r.ok) return r;
    if (!r.value)
      throw Error("Observed transformer boundary became unreachable");
    selected.push(r.value);
  }
  return { ok: true, paths: selected };
}
