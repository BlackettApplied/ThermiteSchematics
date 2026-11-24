import {
  boundedPrintableAdvance,
  continuousLabelSlot,
  printableTextMetrics,
} from "../text-metrics.js";
import type {
  PresentationEdge,
  PresentationGraph,
  PresentationLabel,
  SymbolPresentationNode,
} from "../types.js";

export const TWO_LINE_NET_LABEL_PITCH = 14;
export const TWO_LINE_NET_LABEL_HEIGHT = 28;

const MIN_TWO_LINE_NON_SPACE_CHARS = 4;
const NET_LABEL_SEPARATORS = new Set(["-", "_", ".", "/", " "]);

function normalizeForbiddenRow(value: string): string {
  return value.normalize("NFC").replace(/\s+/gu, " ").trim().toLowerCase();
}

function nonSpaceCharCount(value: string): number {
  return Array.from(value.replace(/\s+/gu, "")).length;
}

export function twoLineSlotWidth(text: string): number {
  return continuousLabelSlot(text, true);
}

function lineInkWidth(
  text: string,
  capacity?: number,
  preserveSpace = false,
): number {
  const metrics = preserveSpace
    ? printableTextMetrics(text.normalize("NFC"), 10, false, true)
    : printableTextMetrics(text, 10);
  const advance =
    capacity === undefined
      ? metrics.advance
      : boundedPrintableAdvance(text, 10, capacity, preserveSpace);
  const scale = metrics.advance ? advance / metrics.advance : 1;
  return (metrics.right - metrics.left) * scale;
}

export function labelInkWidth(label: PresentationLabel): number {
  if (label.lines !== undefined) {
    return Math.max(
      lineInkWidth(label.lines[0], label.textLength, true),
      lineInkWidth(label.lines[1], label.textLength, true),
    );
  }
  return lineInkWidth(label.printableText ?? label.text, label.textLength);
}

export function originatingSymbolPortId(
  graph: Readonly<PresentationGraph>,
  edge: PresentationEdge,
): string {
  let portId = edge.sourcePortId;
  const visited = new Set<string>();
  while (!visited.has(portId)) {
    visited.add(portId);
    const owner = graph.nodes.find((node) =>
      node.ports.some((port) => port.id === portId),
    );
    if (owner === undefined || owner.kind !== "junction") return portId;
    const incoming = graph.edges.find(
      (candidate) =>
        candidate.kind === "boundary-segment" &&
        owner.ports.some((port) => port.id === candidate.targetPortId),
    );
    if (incoming === undefined) return portId;
    portId = incoming.sourcePortId;
  }
  return portId;
}

export function sourceTerminalCaptions(
  node: Readonly<SymbolPresentationNode>,
): readonly string[] {
  const captions = new Set<string>();
  for (const port of node.ports) {
    captions.add(port.terminal.terminalKey);
    if (port.label) captions.add(port.label);
  }
  for (const label of node.labels) {
    if (label.role !== "terminal") continue;
    captions.add(label.text);
    if (label.printableText !== undefined) captions.add(label.printableText);
  }
  return [...captions];
}

/**
 * Split a potential name onto two lines at an existing authored separator,
 * preferring the separator closest to the middle while keeping whitespace runs
 * attached to the end of row 1 so concatenating both lines yields the exact
 * name. Rejects splits where either row has fewer than 4 non-space characters
 * or matches (case-insensitively) a terminal caption/key at the source symbol.
 */
export function splitTwoLineNetLabel(
  text: string,
  forbiddenRows?: Iterable<string>,
): readonly [string, string] | undefined {
  const chars = Array.from(text);
  const mid = chars.length / 2;
  const forbidden = new Set<string>();
  if (forbiddenRows !== undefined) {
    for (const row of forbiddenRows) {
      const normalized = normalizeForbiddenRow(row);
      if (normalized) forbidden.add(normalized);
    }
  }
  let best:
    | {
        readonly lines: readonly [string, string];
        readonly distance: number;
        readonly maxWidth: number;
      }
    | undefined;
  for (let i = 0; i < chars.length - 1; i++) {
    const ch = chars[i];
    if (ch === undefined || !NET_LABEL_SEPARATORS.has(ch)) continue;
    const distance = Math.abs(i + 1 - mid);
    let splitEnd = i + 1;
    while (splitEnd < chars.length && chars[splitEnd] === " ") splitEnd++;
    const first = chars.slice(0, splitEnd).join("");
    const second = chars.slice(splitEnd).join("");
    if (
      nonSpaceCharCount(first) < MIN_TWO_LINE_NON_SPACE_CHARS ||
      nonSpaceCharCount(second) < MIN_TWO_LINE_NON_SPACE_CHARS
    ) {
      continue;
    }
    if (
      forbidden.has(normalizeForbiddenRow(first)) ||
      forbidden.has(normalizeForbiddenRow(second))
    ) {
      continue;
    }
    const maxWidth = Math.max(
      lineInkWidth(first, undefined, true),
      lineInkWidth(second, undefined, true),
    );
    if (
      best === undefined ||
      distance < best.distance ||
      (distance === best.distance && maxWidth < best.maxWidth)
    ) {
      best = { lines: [first, second], distance, maxWidth };
    }
  }
  return best?.lines;
}

export function twoLineNetLabel(
  label: PresentationLabel,
  lines: readonly [string, string],
): PresentationLabel {
  const width = Math.max(
    twoLineSlotWidth(lines[0]),
    twoLineSlotWidth(lines[1]),
  );
  return {
    ...label,
    lines,
    width,
    height: TWO_LINE_NET_LABEL_HEIGHT,
    textLength: Number((width - 6).toFixed(3)),
  };
}

export function wrapPresentationNetLabels(
  graph: Readonly<PresentationGraph>,
  labelIds?: ReadonlySet<string>,
): PresentationGraph {
  if (graph.view.flow !== "top-to-bottom" || !labelIds?.size) return graph;
  let changed = false;
  const edges = graph.edges.map((edge) => {
    const netLabel = edge.netLabel;
    if (netLabel === undefined || !labelIds.has(netLabel.id)) return edge;
    const portId = originatingSymbolPortId(graph, edge);
    const owner = graph.nodes.find(
      (node): node is SymbolPresentationNode =>
        node.kind === "symbol" && node.ports.some((port) => port.id === portId),
    );
    const forbidden = owner ? sourceTerminalCaptions(owner) : undefined;
    const lines = splitTwoLineNetLabel(
      netLabel.printableText ?? netLabel.text,
      forbidden,
    );
    if (lines === undefined) return edge;
    changed = true;
    return { ...edge, netLabel: twoLineNetLabel(netLabel, lines) };
  });
  return changed ? { ...graph, edges } : graph;
}

export function omitPresentationNetLabels(
  graph: Readonly<PresentationGraph>,
  labelIds?: ReadonlySet<string>,
): PresentationGraph {
  if (!labelIds?.size) return graph;
  let changed = false;
  const edges = graph.edges.map((edge) => {
    if (edge.netLabel === undefined || !labelIds.has(edge.netLabel.id)) {
      return edge;
    }
    changed = true;
    const { netLabel: _omitted, ...rest } = edge;
    return rest;
  });
  return changed ? { ...graph, edges } : graph;
}
