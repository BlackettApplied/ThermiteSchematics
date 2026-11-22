import { circuitCaptionPlate } from "./inline-plate.js";
import { InlineLabelCollisionError } from "../layout/inline-label-error.js";
import { plannedCircuitCaption } from "./caption-plan.js";
import { circuitJunctionSvg } from "./junction-identity.js";
import { supportedCircuitLabels } from "./label-support.js";
import { circuitLandingAnchors } from "./landing-anchors.js";
import type { Diagnostic } from "@thermite/schema";
import type { IrFunction } from "@thermite/compiler";
import { escapeXmlAttribute as attr } from "../svg/escape.js";
import { relatedCaptionWidth } from "../symbols/circuit-relations.js";

import type { CircuitPins } from "./layout-input.js";
import {
  appendCircuitRoute,
  circuitTopology,
  circuitLabelChecks,
  recoverCircuitSelfLabels,
  assertCircuitLabels,
  type CircuitLabelState,
  type CircuitRouteState,
} from "./layout-routes.js";
import {
  separateCoincidentLoops,
  type CircuitLoopSeparation,
} from "./separate-loops.js";
import { attachmentStrokeWeights } from "../symbols/attachment-stroke.js";
import { required } from "../presentation/util.js";
type Label = CircuitLabelState["labels"][number];
export function renderCircuitLayout(
  state: CircuitRouteState,
  fs: IrFunction[],
  pins: CircuitPins,
  selfLoops: Set<number>,
  vertical: boolean,
) {
  try {
    const separation = separateCoincidentLoops(state.graph, selfLoops);
    if (separation)
      return drawCircuit(
        {
          ...state,
          graph: separation.graph,
          routes: [],
          labels: [],
          wireSvg: [],
        },
        fs,
        pins,
        selfLoops,
        vertical,
        separation,
      );
  } catch {
    // The candidate is optional. Re-run the original route and caption
    // checks with untouched state and propagate any failure of that layout.
  }
  return drawCircuit(state, fs, pins, selfLoops, vertical);
}

function drawCircuit(
  state: CircuitRouteState,
  fs: IrFunction[],
  pins: CircuitPins,
  selfLoops: Set<number>,
  vertical: boolean,
  separation?: CircuitLoopSeparation,
) {
  const { graph, cs, group } = state;
  if (graph.edges?.length !== cs.length)
    throw new Error(`Circuit ${group.id}: incomplete conductor coverage.`);
  for (const edge of graph.edges ?? [])
    appendCircuitRoute(edge, state, separation?.nestedEdges.has(edge.id));
  const checked = circuitLabelChecks(circuitTopology(state, separation?.fan));
  if (!separation) {
    recoverCircuitSelfLabels(checked, selfLoops);
    assertCircuitLabels(checked);
  }
  const { labels, baseFallbacks } = supportedCircuitLabels(checked),
    supported = { ...checked, labels };
  if (separation) {
    assertCircuitLabels(supported);
    if (baseFallbacks.size)
      throw new InlineLabelCollisionError(
        "Separated circuit loops require owned captions.",
      );
    // Paint these unmasked rails above the native knockouts so both
    // conductors remain continuous where an unrelated wire crosses a nest.
    const nested: string[] = [];
    const native = supported.wireSvg.filter((svg, i) => {
      const edge = required(graph.edges?.[i], "Missing circuit route");
      const isNested = separation.nestedEdges.has(edge.id);
      if (isNested) nested.push(svg);
      return !isNested;
    });
    supported.wireSvg = [...native, ...nested];
  }
  const weights = attachmentStrokeWeights(graph.edges ?? [], cs),
    diagnostics: Diagnostic[] = [],
    contents = circuitDrawingContents(
      supported,
      baseFallbacks,
      vertical,
      weights,
      diagnostics,
    );
  return circuitDrawingResult(supported, fs, pins, contents, diagnostics);
}

function circuitDrawingContents(
  state: CircuitLabelState,
  baseFallbacks: ReadonlySet<number>,
  vertical: boolean,
  weights: ReadonlyMap<string, number>,
  diagnostics: Diagnostic[],
) {
  const { wireSvg, dots, labels, nodes, laidNodes, cs, emitNode } = state;
  const contents = [
    ...wireSvg,
    circuitLandingAnchors(state),
    ...[...dots.values()].map((p) => circuitJunctionSvg(p, state)),
    ...labels.map((l) =>
      circuitWireLabel(l, state, baseFallbacks.has(l.index)),
    ),
    ...nodes.map((d) => {
      const l = laidNodes.get(d.id)!;
      return emitNode(d, l.x!, l.y!, vertical, cs, diagnostics, false, weights);
    }),
  ].join("");
  return contents;
}

function circuitWireLabel(
  l: Label,
  state: CircuitLabelState,
  unhostable: boolean,
) {
  const { cs, n, text } = state;
  const plans = l.text.split("\n").map((line, i) => ({
    line,
    ...plannedCircuitCaption(line, i, l, state, unhostable),
  }));
  const plate = circuitCaptionPlate(
    l,
    state,
    plans.map((p) => p.ink),
  );
  if (!plate)
    throw new InlineLabelCollisionError(
      `Circuit ${state.group.id}: caption ${l.text} cannot preserve visible conductor approaches.`,
    );
  const fallback = plans[0]?.fallback;
  return (
    plans.map((p) => p.leader).join("") +
    `<g data-wire-label="${attr(cs[l.index]!.id)}"${fallback ? ` data-circuit-caption-fallback="${fallback}"` : ""}><rect x="${n(plate.x)}" y="${n(plate.y)}" width="${n(plate.width)}" height="${n(plate.height)}" fill="white"/>${plans.map((p) => text(p.x, p.baseline, p.line)).join("")}</g>`
  );
}

function circuitDrawingResult(
  state: CircuitLabelState,
  fs: IrFunction[],
  pins: CircuitPins,
  contents: string,
  diagnostics: Diagnostic[],
) {
  const { graph, group, nodes, laidNodes, circuitDeviceTags } = state;
  const relatedCaption = nodes
    .flatMap((node) =>
      [...node.relationLabels, ...node.tagColumnCaptions].map((text) => ({
        designation: node.device.designation,
        text,
        requiredWidthMm: relatedCaptionWidth(text) + 4,
      })),
    )
    .sort((a, b) => b.requiredWidthMm - a.requiredWidthMm)[0];
  const drawing = {
    id: group.id,
    label: group.label ?? "",
    ...(diagnostics.length ? { diagnostics } : {}),
    ...(group.lineReference ? { lineReference: group.lineReference } : {}),
    width: graph.width!,
    height: graph.height!,
    deviceTags: circuitDeviceTags(nodes),
    ...(relatedCaption ? { relatedCaption } : {}),
    content: `<g data-circuit-group="${attr(group.id)}"${group.lineReference ? ` data-source-line-reference="${attr(group.lineReference)}"` : ""}>${contents}</g>`,
    references: nodes.map((d) => {
      const l = laidNodes.get(d.id)!;
      return {
        deviceUid: d.device.uid,
        designation: d.device.designation,
        functions: d.functions.map((f) => f.id.functionKey),
        x: l.x! + d.width / 2,
        y: l.y! + d.height / 2,
      };
    }),
    coverage: circuitDrawingCoverage(state, fs, pins),
  };
  return drawing;
}

function circuitDrawingCoverage(
  state: CircuitLabelState,
  fs: IrFunction[],
  pins: CircuitPins,
) {
  const { cs, nodes, fkey, compare, key } = state;
  return {
    conductorIds: cs.map((c) => c.id),
    functionIds: fs.map(fkey).sort(compare),
    terminalIds: [...pins.keys()].sort(compare),
    boundaryTerminalIds: nodes
      .flatMap((d) =>
        d.pins
          .filter(
            (p) =>
              !d.functions.some((f) =>
                f.terminals.some((t) => key(t) === key(p.terminal)),
              ),
          )
          .map((p) => key(p.terminal)),
      )
      .sort(compare),
  };
}
