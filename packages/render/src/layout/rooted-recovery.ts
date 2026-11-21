import { conductorKey } from "../presentation/util.js";
import type { PresentationGraph, SelectedSubgraph } from "../types.js";
import type { LayoutValidationOutcome } from "./validate-output.js";

export type RootedRecovery = "trace-order" | ReadonlySet<string>;

const phaseLanes = new Set(["L1", "L2", "L3", "U", "V", "W", "line"]);

function netLabelRecovery(
  graph: Readonly<PresentationGraph>,
  selected: Readonly<SelectedSubgraph> | undefined,
  overlaps: readonly { labelId: string; edgeId: string }[],
) {
  const phaseConductors = new Set(
    selected?.paths
      .filter((path) => phaseLanes.has(path.lane))
      .flatMap((path) =>
        path.steps.flatMap((step) =>
          step.kind === "conductor" ? [conductorKey(step.elementId)] : [],
        ),
      ),
  );
  const crossedEdges = new Set(overlaps.map(({ edgeId }) => edgeId));
  // A phase crossing admits the retry. Resolve every measured net-label
  // overlap together, including a phase label that crosses protective earth.
  if (
    graph.edges.some(
      (edge) =>
        crossedEdges.has(edge.id) &&
        edge.elementIds.some((id) => phaseConductors.has(conductorKey(id))),
    )
  )
    return new Set(overlaps.map(({ labelId }) => labelId));
}

/** One additional native request, only after the corresponding layout refusal.
 * Fixed ports, source inventories, text and all final geometry guards remain
 * unchanged. Successful base layouts never enter this recovery. */
export function rootedRecovery(
  graph: Readonly<PresentationGraph>,
  failure: LayoutValidationOutcome,
  selected?: Readonly<SelectedSubgraph>,
): RootedRecovery | undefined {
  if (failure.ok) return;
  if (
    graph.view.family === "power" &&
    graph.view.flow === "top-to-bottom" &&
    failure.netLabelOverlaps
  )
    return netLabelRecovery(graph, selected, failure.netLabelOverlaps);
  if (
    graph.view.format !== "schematic-view/0.2" ||
    graph.view.intent !== "trace" ||
    !("deviceUid" in graph.view.root) ||
    !["ambiguous-intersection", "collinear-overlap"].includes(
      failure.failureKind,
    )
  )
    return;
  const rootUid = graph.view.root.deviceUid;
  const root = graph.nodes.find(
    (n) => n.kind === "symbol" && n.deviceUid === rootUid,
  );
  const signal = root?.ports.find((p) => p.symbolPortId === "signal");
  // Existing root fan-out has its own bounded search. This retry addresses a
  // single physical signal path through serial terminal landings (#365).
  if (
    !signal ||
    graph.edges.filter(
      (e) =>
        e.kind === "conductor" &&
        (e.sourcePortId === signal.id || e.targetPortId === signal.id),
    ).length !== 1
  )
    return;
  const net = signal.netId;
  if (
    net !== undefined &&
    graph.nodes.some(
      (node) =>
        node.kind === "symbol" &&
        node.classification === "terminal" &&
        node.ports.length === 2 &&
        node.ports.every(
          (p) =>
            p.netId === net &&
            p.terminal.deviceUid === node.ports[0]?.terminal.deviceUid &&
            p.terminal.terminalKey === node.ports[0]?.terminal.terminalKey,
        ),
    )
  )
    return "trace-order";
}
