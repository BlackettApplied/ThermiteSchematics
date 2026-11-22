import { circuitPortOrderGuard } from "./circuit-port-order.js";
import { required } from "../presentation/util.js";
import type { ElkLabel, ElkNode } from "elkjs/lib/elk-api.js";
import {
  circuitInlineContext,
  circuitLayoutCacheKey,
} from "./circuit-inline-context.js";
import { createElkEngine } from "./elk-runtime.js";
import { placeCircuitInlineLabels } from "./circuit-inline-slots.js";
import {
  circuitConductorGuard,
  circuitHasJogs,
} from "./circuit-route-quality.js";
import {
  circuitNativeGuard,
  circuitCrossingGuard,
  circuitLabelGuard,
  circuitNodeClearanceGuard,
} from "./circuit-native-guard.js";
import {
  InlineLabelFitError,
  isInlineLabelFailure,
} from "./inline-label-error.js";
import { CAPTION_CLEARANCE_MM } from "../symbols/caption-ink.js";
import { MAX_PLACEMENT_LAYOUTS } from "../packet/rooted-search.js";
import { STANDARD_ECONOMY_ATTEMPTS } from "../packet/rooted-economy.js";
import type { PowerPlacementState } from "./power-placement.js";

export interface CircuitLayoutRun {
  power?: PowerPlacementState;
  quality: boolean;
  attempts: number;
  qualityAttempts: number;
  baseline: Map<string, ElkNode>;
  drawings: WeakMap<object, string>;
  printed: Set<string>;
  alternatives: Map<string, ElkNode>;
  decisions: Map<string, string>;
  routed: Map<string, ElkNode>;
  placements: Map<string, ElkNode>;
}
export function circuitLayoutRun(): CircuitLayoutRun {
  return {
    quality: false,
    attempts: 0,
    qualityAttempts: 0,
    baseline: new Map(),
    drawings: new WeakMap(),
    printed: new Set(),
    alternatives: new Map(),
    decisions: new Map(),
    routed: new Map(),
    placements: new Map(),
  };
}
export function nextCircuitLayoutRun() {
  const context = circuitInlineContext.getStore();
  if (!context) return;
  const ordinal = context.cursor++;
  const run = (context.runs[ordinal] ??= circuitLayoutRun());
  run.quality = context.selected.has(ordinal);
  context.currentRun = run;
  return run;
}
function eligibleLabels(input: ElkNode) {
  const owners = new Map(
    (input.children ?? []).flatMap((n) =>
      (n.ports ?? []).map((p) => [p.id, n.id]),
    ),
  );
  const pair = (ids: readonly string[]) =>
    ids.map((id) => owners.get(id)).sort();
  const key = (e: NonNullable<ElkNode["edges"]>[number]) =>
    JSON.stringify(pair([...e.sources, ...e.targets]));
  const edges = input.edges ?? [];
  return new Map(
    edges
      .filter(
        (e) =>
          owners.get(
            required(e.sources[0], "Missing native circuit geometry"),
          ) !==
            owners.get(
              required(e.targets[0], "Missing native circuit geometry"),
            ) && edges.filter((other) => key(other) === key(e)).length > 1,
      )
      .map((e) => [e.id, structuredClone(e.labels ?? [])]),
  );
}
/** Reserve the along-segment box plus visible stubs and the existing edge/node
 * clearances at both ends. No flow-specific floor or text-dependent constant.
 * A transverse label too wide for the fixed lanes still falls back honestly. */
export function circuitInlineGap(
  input: ElkNode,
  labels: ReadonlyMap<string, ElkLabel[]>,
) {
  const vertical = input.layoutOptions?.["elk.direction"] === "DOWN";
  // layoutGroupUnchecked in circuit.ts supplies both layered clearances.
  // They are required here; ELK's implicit defaults are not this contract.
  const spacing = (option: string) => {
    const value = Number(
      required(
        input.layoutOptions?.[option],
        `Missing required circuit clearance option ${option}`,
      ),
    );
    if (!Number.isFinite(value) || value < 0)
      throw new Error(`Invalid circuit clearance option ${option}`);
    return value;
  };
  const clearance = spacing("elk.layered.spacing.edgeNodeBetweenLayers");
  return Math.max(
    spacing("elk.layered.spacing.nodeNodeBetweenLayers"),
    ...[...labels.values()]
      .flat()
      .map(
        (l) =>
          (vertical
            ? required(l.height, "Missing native circuit geometry")
            : required(l.width, "Missing native circuit geometry")) +
          2 * (CAPTION_CLEARANCE_MM + clearance),
      ),
  );
}

/** A view-local saved baseline is the exact original all-label ELK result.
 * One alternative per eligible group consumes the existing 48/four pool;
 * label assignments consume no layouts, and recovery has already run first. */
export async function layoutCircuitGroup(
  input: ElkNode,
  run?: CircuitLayoutRun,
  strokes?: ReadonlyMap<string, number>,
  portGroups: readonly (readonly string[])[] = [],
): Promise<ElkNode> {
  const key = JSON.stringify(input);
  let original = run?.baseline.get(key);
  if (!original && run?.quality)
    throw new InlineLabelFitError(
      "Circuit alternative does not fit the original complete partition.",
    );
  if (!original) {
    original = await createElkEngine().layout(structuredClone(input));
    if (run) {
      run.attempts++;
      run.baseline.set(key, structuredClone(original));
    }
  }

  if (!run?.quality || !circuitHasJogs(original))
    return structuredClone(original);
  const weights =
    strokes ?? new Map((input.edges ?? []).map((e) => [e.id, 0.32]));
  const placementKey = JSON.stringify([key, [...weights], portGroups]);
  const saved = run.placements.get(placementKey);
  if (saved) return structuredClone(saved);
  const labels = eligibleLabels(input);
  if (!labels.size) return structuredClone(original);
  const candidate = await routingCandidate(input, key, labels, run);
  if (!candidate) return structuredClone(original);
  const selected = placeCandidate(
    candidate,
    input,
    original,
    labels,
    weights,
    portGroups,
    run,
    key,
  );
  run.placements.set(placementKey, structuredClone(selected));
  run.alternatives.set(key, structuredClone(selected));
  return selected;
}

async function routingCandidate(
  input: ElkNode,
  key: string,
  labels: ReadonlyMap<string, ElkLabel[]>,
  run: CircuitLayoutRun,
) {
  const saved = run.routed.get(key);
  if (saved) return structuredClone(saved);
  if (
    run.attempts >= MAX_PLACEMENT_LAYOUTS ||
    run.qualityAttempts >= STANDARD_ECONOMY_ATTEMPTS
  )
    return;
  const candidateInput = inlineInput(input, labels);
  run.attempts++;
  run.qualityAttempts++;
  circuitInlineContext
    .getStore()
    ?.permittedInputs.add(circuitLayoutCacheKey(candidateInput));
  const candidate = await createElkEngine().layout(candidateInput);
  run.routed.set(key, structuredClone(candidate));
  return candidate;
}

function placeCandidate(
  candidate: ElkNode,
  input: ElkNode,
  original: ElkNode,
  labels: ReadonlyMap<string, ElkLabel[]>,
  weights: ReadonlyMap<string, number>,
  portGroups: readonly (readonly string[])[],
  run: CircuitLayoutRun,
  key: string,
) {
  const rejection = circuitRejection(candidate, input, original, portGroups);
  if (rejection) {
    run.decisions.set(key, rejection);
    return structuredClone(original);
  }
  for (const mode of [0, 1, 2]) {
    const placed = structuredClone(candidate);
    try {
      placeCircuitInlineLabels(placed, labels, weights, mode);
      if (!circuitLabelGuard(placed, input)) {
        run.decisions.set(key, "label conservation");
        return structuredClone(original);
      }
      run.decisions.set(key, "inline");
      return placed;
    } catch (error) {
      if (!isInlineLabelFailure(error)) throw error;
    }
  }
  run.decisions.set(key, "complete label box/stroke clearance does not fit");
  return structuredClone(original);
}

function inlineInput(input: ElkNode, labels: ReadonlyMap<string, ElkLabel[]>) {
  const candidateInput = structuredClone(input);
  for (const edge of candidateInput.edges ?? [])
    if (labels.has(edge.id)) edge.labels = [];
  required(candidateInput.layoutOptions, "Missing native circuit geometry")[
    "elk.layered.spacing.nodeNodeBetweenLayers"
  ] = String(circuitInlineGap(input, labels));
  return candidateInput;
}

function circuitRejection(
  candidate: ElkNode,
  input: ElkNode,
  original: ElkNode,
  portGroups: readonly (readonly string[])[],
) {
  return !circuitNativeGuard(candidate, input) ||
    !circuitNodeClearanceGuard(candidate) ||
    !circuitPortOrderGuard(candidate, original, portGroups)
    ? "fixed-port/endpoint/phase/route conservation"
    : !circuitCrossingGuard(candidate, original)
      ? "new crossing/junction/merged landing"
      : !circuitConductorGuard(candidate, original)
        ? "conductor bends/length/defects or no repair"
        : undefined;
}
