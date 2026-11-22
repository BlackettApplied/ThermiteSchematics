import type { ElkLabel, ElkNode } from "elkjs/lib/elk-api.js";
import type { CircuitLabelState } from "./layout-routes.js";
import { circuitCaptionPlacement } from "./caption-placement.js";
import { circuitCaptionPositions } from "./caption-recovery.js";
import { leaderCaptionPositions } from "./caption-leader-positions.js";
import { fullyCoincidentCaption } from "./coincident-caption.js";
import { unhostableCaptionFallback } from "./caption-fallback.js";
import { ownedWiringLabels } from "../layout/wiring-label-support.js";
import { required } from "../presentation/util.js";
type Label = CircuitLabelState["labels"][number];
function fromElk(index: number, label: Readonly<ElkLabel>): Label {
  return {
    index,
    x: required(label.x, "Missing caption x"),
    y: required(label.y, "Missing caption y"),
    width: required(label.width, "Missing caption width"),
    height: required(label.height, "Missing caption height"),
    text: required(label.text, "Missing caption text"),
  };
}
export function circuitCaptionGraph(state: CircuitLabelState): ElkNode {
  return {
    ...state.graph,
    edges: (state.graph.edges ?? []).map((edge) => ({
      ...edge,
      labels: state.labels
        .filter((l) => edge.id === `e${l.index}`)
        .map(({ index, ...label }) => label),
    })),
  };
}
function withCaption(state: CircuitLabelState, label: Label, candidate: Label) {
  return {
    ...state,
    labels: state.labels.map((t) => (t === label ? candidate : t)),
  };
}
function recoveredLabel(graph: ElkNode, index: number) {
  return fromElk(
    index,
    required(
      graph.edges?.find((e) => e.id === `e${index}`)?.labels?.[0],
      "Missing recovered caption",
    ),
  );
}
function placements(label: Label, state: CircuitLabelState) {
  return label.text
    .split("\n")
    .map((line, i) => circuitCaptionPlacement(line, i, label, state));
}
function fits(label: Label, state: CircuitLabelState) {
  return (
    fullyCoincidentCaption(label.index, state.segments) ||
    placements(label, state).every((p) => p !== undefined)
  );
}
/** Second bounded pass for leader-capable whole blocks. Earlier admitted
 * captions stay valid, and every candidate uses the existing plate-free check.
 * The receipt counts actual admissions; no native work or route edits occur. */
export function recoverLeaderCaptionBlocks(
  state: CircuitLabelState,
  baseLabels: readonly Label[],
) {
  let labels = state.labels;
  const baseFallbacks = new Set<number>(),
    receipts: {
      index: number;
      attempts: number;
      checkedLeaderFound: boolean;
      fallback: boolean;
    }[] = [];
  for (let ordinal = 0; ordinal < labels.length; ordinal++) {
    const label = required(labels[ordinal], "Missing circuit caption"),
      current = { ...state, labels };
    if (fits(label, current)) continue;
    const protectedLabels = labels.filter(
      (l) => l !== label && fits(l, current),
    );
    let attempts = 0,
      checkedLeaderFound = false;
    const graph = ownedWiringLabels(
      circuitCaptionGraph(current),
      (id, l) => {
        if (id !== `e${label.index}`) return true;
        attempts++;
        const candidate = fromElk(label.index, l),
          candidateState = withCaption(current, label, candidate),
          plans = placements(candidate, candidateState);
        checkedLeaderFound ||= plans.some((p) => p?.points !== undefined);
        return (
          plans.every((p) => p !== undefined) &&
          protectedLabels.every((l) => fits(l, candidateState))
        );
      },
      (l, routes) => [
        ...circuitCaptionPositions(l, routes),
        ...leaderCaptionPositions(label.index, l, current),
      ],
    );
    const candidate = recoveredLabel(graph, label.index),
      candidateState = withCaption(current, label, candidate),
      accepted =
        fits(candidate, candidateState) &&
        protectedLabels.every((l) => fits(l, candidateState));
    const fallback = unhostableCaptionFallback(
      label,
      current.segments,
      !accepted,
      checkedLeaderFound,
    );
    if (accepted) labels = candidateState.labels;
    else if (fallback) {
      labels = labels.map((l, i) =>
        i === ordinal
          ? required(baseLabels[ordinal], "Missing base caption")
          : l,
      );
      baseFallbacks.add(label.index);
    }
    receipts.push({
      index: label.index,
      attempts,
      checkedLeaderFound,
      fallback,
    });
  }
  return { labels, baseFallbacks, recoveryReceipts: receipts };
}
