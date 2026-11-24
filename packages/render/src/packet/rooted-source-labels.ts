import type {
  CompiledProjectPresentation,
  ElectricalIr,
} from "@thermite/compiler";
import type { PreparedSchematicDrawing } from "../renderer.js";
import {
  OUTER_SVG_PADDING,
  verticalSourcePortSpacing,
  type VerticalSourcePortSpec,
} from "../symbols/catalog.js";
import {
  labelInkWidth,
  originatingSymbolPortId,
  sourceTerminalCaptions,
  splitTwoLineNetLabel,
  twoLineNetLabel,
} from "../presentation/net-label-wrap.js";
import { MIN_PITCH_CLEARANCE } from "../presentation/vertical-source-spacing.js";
import type {
  LayoutLabel,
  LayoutNode,
  PresentationLabel,
  SchematicViewRequest,
  SymbolPresentationNode,
} from "../types.js";
import { bankBounds, continuationBanks } from "./continuation-bank.js";
import {
  ContinuationLabelError,
  continuationLabelSvg,
} from "./continuation-label.js";
import { resolveRootedContinuations } from "./continuation-resolve.js";
import { PacketDraftError } from "./errors.js";
import { hasCompactFrame } from "./frame-profile.js";
import { rootedPageBudget } from "./rooted-bound.js";
import {
  materializeRootedCandidate,
  rootedSpace,
  type RootedCandidate,
} from "./rooted-build.js";
import { protectedDrawingIntervals } from "./rooted-geometry.js";
import { retryRootedPagination } from "./rooted-pagination-retry.js";
import {
  nativeWinner,
  rootedWinner,
  searchRootedCandidates,
  type RootedSearch,
} from "./rooted-search.js";
import { mergedIntervals } from "./safe-cuts.js";
import type { Draft, PaperPage } from "./types.js";

export interface VerticalSourceLabelAttribution {
  readonly potentialNames: readonly string[];
  readonly wrappableLabelIds: ReadonlySet<string>;
}

interface SourceNetLabelEntry {
  readonly netLabel: PresentationLabel;
  readonly portIndex: number;
  readonly box: LayoutLabel | undefined;
}

interface SourceInSpan {
  readonly node: SymbolPresentationNode;
  readonly spec: VerticalSourcePortSpec;
  readonly southCount: number;
  readonly box: LayoutNode;
  readonly entries: readonly SourceNetLabelEntry[];
}

interface CandidateSourceNetLabels {
  readonly labelIds: ReadonlySet<string>;
  readonly potentialNames: readonly string[];
  readonly wrappableLabelIds: ReadonlySet<string>;
}

function sourceEntriesForNode(
  p: PreparedSchematicDrawing,
  node: SymbolPresentationNode,
  layoutLabels: ReadonlyMap<string, LayoutLabel>,
): { readonly southCount: number; readonly entries: SourceNetLabelEntry[] } {
  const southPorts = node.ports
    .filter((port) => port.side === "south")
    .sort((left, right) => left.offset - right.offset);
  const indexByPort = new Map(southPorts.map((port, i) => [port.id, i]));
  const entries: SourceNetLabelEntry[] = [];
  for (const edge of p.graph.edges) {
    const netLabel = edge.netLabel;
    if (netLabel === undefined) continue;
    const portIndex = indexByPort.get(originatingSymbolPortId(p.graph, edge));
    if (portIndex === undefined) continue;
    entries.push({
      netLabel,
      portIndex,
      box: layoutLabels.get(netLabel.id),
    });
  }
  return { southCount: southPorts.length, entries };
}

function verticalSourcesInDrawing(p: PreparedSchematicDrawing): SourceInSpan[] {
  const layoutNodes = new Map(p.layout.nodes.map((node) => [node.id, node]));
  const layoutLabels = new Map(
    p.layout.labels.map((label) => [label.id, label]),
  );
  const sources: SourceInSpan[] = [];
  for (const node of p.graph.nodes) {
    if (node.kind !== "symbol" || node.orientation !== "top-to-bottom")
      continue;
    const spec = verticalSourcePortSpacing(node.symbolId);
    const box = layoutNodes.get(node.id);
    if (spec === undefined || box === undefined) continue;
    const { southCount, entries } = sourceEntriesForNode(p, node, layoutLabels);
    sources.push({ node, spec, southCount, box, entries });
  }
  return sources;
}

function collectBlockingLabels(
  sources: readonly SourceInSpan[],
  excessUnits: number,
  availableWidthMm: number,
  scale: number,
) {
  const labelIds = new Set<string>();
  const potentialNames = new Set<string>();
  const wrappableLabelIds = new Set<string>();
  for (const source of sources) {
    const baseWidth = source.spec.widthForPitch(source.spec.defaultPitch);
    const maxSymbolWidth = source.node.symbolSize.width - excessUnits;
    const forbidden = sourceTerminalCaptions(source.node);
    for (const entry of source.entries) {
      const inkWidth = labelInkWidth(entry.netLabel);
      const pitch = Math.ceil((inkWidth + MIN_PITCH_CLEARANCE) / 2) * 2;
      const forcesWidth =
        entry.portIndex < source.southCount - 1 &&
        source.node.symbolSize.width > baseWidth + 0.001 &&
        pitch > source.spec.defaultPitch &&
        source.spec.widthForPitch(pitch) > maxSymbolWidth + 0.001;
      const boxOverflows =
        entry.box !== undefined &&
        (entry.box.width + 24) * scale > availableWidthMm + 0.001;
      if (!forcesWidth && !boxOverflows) continue;
      labelIds.add(entry.netLabel.id);
      potentialNames.add(entry.netLabel.text);
      if (entry.netLabel.lines !== undefined) continue;
      const lines = splitTwoLineNetLabel(
        entry.netLabel.printableText ?? entry.netLabel.text,
        forbidden,
      );
      if (lines === undefined) continue;
      const candidate = twoLineNetLabel(entry.netLabel, lines);
      if (labelInkWidth(candidate) < inkWidth) {
        wrappableLabelIds.add(entry.netLabel.id);
      }
    }
  }
  return { labelIds, potentialNames, wrappableLabelIds };
}

function candidatesInPrepared(
  p: PreparedSchematicDrawing,
  availableWidthMm: number,
  scale: number,
): CandidateSourceNetLabels | undefined {
  const { protectedX } = protectedDrawingIntervals(p.layout, OUTER_SVG_PADDING);
  const overflowing = mergedIntervals(protectedX).filter(
    (interval) =>
      (interval.end - interval.start) * scale > availableWidthMm + 0.001,
  );
  if (overflowing.length === 0) return undefined;
  const allSources = verticalSourcesInDrawing(p);
  const labelIds = new Set<string>();
  const potentialNames = new Set<string>();
  const wrappableLabelIds = new Set<string>();
  for (const enclosing of overflowing) {
    const inSpan = allSources.filter((source) => {
      const left = source.box.x + OUTER_SVG_PADDING;
      const right = left + source.box.width;
      return enclosing.start <= left && enclosing.end >= right;
    });
    if (inSpan.length === 0) return undefined;
    const spanMm = (enclosing.end - enclosing.start) * scale;
    const found = collectBlockingLabels(
      inSpan,
      (spanMm - availableWidthMm) / scale,
      availableWidthMm,
      scale,
    );
    if (found.labelIds.size === 0) return undefined;
    for (const id of found.labelIds) labelIds.add(id);
    for (const name of found.potentialNames) potentialNames.add(name);
    for (const id of found.wrappableLabelIds) wrappableLabelIds.add(id);
  }
  return labelIds.size > 0
    ? { labelIds, potentialNames: [...potentialNames], wrappableLabelIds }
    : undefined;
}

function candidateVerticalSourceNetLabels(
  run: RootedSearch,
  page: PaperPage,
): CandidateSourceNetLabels | undefined {
  const labelIds = new Set<string>();
  const potentialNames = new Set<string>();
  const wrappableLabelIds = new Set<string>();
  for (const { p, profile } of run.prepared) {
    if (p.view.flow !== "top-to-bottom") continue;
    const { b, scale } = rootedSpace(p, page, !!profile);
    const banks = continuationBanks(
      p,
      b,
      scale,
      run.referenceOffset ?? 0,
      true,
    );
    const maxAvailableWidth = Math.max(
      b.w,
      ...banks.map((bank) => bankBounds(b, bank).w),
    );
    const found = candidatesInPrepared(p, maxAvailableWidth, scale);
    if (found === undefined) continue;
    for (const id of found.labelIds) labelIds.add(id);
    for (const name of found.potentialNames) potentialNames.add(name);
    for (const id of found.wrappableLabelIds) wrappableLabelIds.add(id);
  }
  return labelIds.size > 0
    ? { labelIds, potentialNames: [...potentialNames], wrappableLabelIds }
    : undefined;
}

function printableDraftsFit(
  drafts: readonly Draft[],
  native: RootedCandidate,
  page: PaperPage,
): boolean {
  const probe = structuredClone([...drafts]);
  const first = probe[0];
  if (!first) return false;
  first.rootedFit = {
    basePages: native.drafts.length,
    actualPages: probe.length,
    context: "counterfactual source-label check",
  };
  const { fits, limit } = rootedPageBudget(probe);
  if (fits.length > 0 && probe.length > limit) return false;
  try {
    resolveRootedContinuations(probe, page);
    for (const draft of probe)
      for (const link of draft.links) continuationLabelSvg(link);
  } catch (error) {
    if (
      error instanceof PacketDraftError ||
      error instanceof ContinuationLabelError
    ) {
      return false;
    }
    throw error;
  }
  return true;
}

async function counterfactualRootedFits(
  ir: Readonly<ElectricalIr>,
  request: SchematicViewRequest,
  presentation: CompiledProjectPresentation | undefined,
  page: PaperPage,
  mode: "standard" | "compact",
  referenceOffset: number,
  omitNetLabelIds: ReadonlySet<string>,
): Promise<boolean> {
  const probePage = hasCompactFrame(page) ? { ...page } : page;
  const run = await searchRootedCandidates(
    ir,
    request,
    presentation,
    probePage,
    mode === "compact",
    referenceOffset,
    { omitNetLabelIds },
  );
  const winner = rootedWinner(run, probePage);
  const native = nativeWinner(run);
  if (winner && native) {
    if (winner.printableDrafts) return true;
    const materialized = materializeRootedCandidate(ir, winner, probePage);
    return (
      materialized.ok &&
      printableDraftsFit(materialized.value, native, probePage)
    );
  }
  if (run.paginationRetry) {
    const recovered = await retryRootedPagination(
      ir,
      run.paginationRetry,
      probePage,
      referenceOffset,
    );
    if (recovered) {
      return printableDraftsFit(
        recovered.winner.drafts,
        recovered.native,
        probePage,
      );
    }
  }
  return false;
}

/**
 * Attribute a failed TTB rooted layout to oversized vertical source net labels
 * only when a real counterfactual layout/pagination with those labels omitted
 * actually fits the requested page.
 */
export async function attributeVerticalSourceNetLabels(
  ir: Readonly<ElectricalIr>,
  request: SchematicViewRequest,
  presentation: CompiledProjectPresentation | undefined,
  run: RootedSearch,
  page: PaperPage,
  mode: "standard" | "compact" = "standard",
  referenceOffset = 0,
): Promise<VerticalSourceLabelAttribution | undefined> {
  const candidates = candidateVerticalSourceNetLabels(run, page);
  if (candidates === undefined) return undefined;
  const fitsWithoutLabels = await counterfactualRootedFits(
    ir,
    request,
    presentation,
    page,
    mode,
    referenceOffset,
    candidates.labelIds,
  );
  if (!fitsWithoutLabels) return undefined;
  return {
    potentialNames: candidates.potentialNames,
    wrappableLabelIds: candidates.wrappableLabelIds,
  };
}

export async function wrappableVerticalSourceNetLabelIds(
  ir: Readonly<ElectricalIr>,
  request: SchematicViewRequest,
  presentation: CompiledProjectPresentation | undefined,
  run: RootedSearch,
  page: PaperPage,
  mode: "standard" | "compact" = "standard",
  referenceOffset = 0,
): Promise<ReadonlySet<string> | undefined> {
  const attributed = await attributeVerticalSourceNetLabels(
    ir,
    request,
    presentation,
    run,
    page,
    mode,
    referenceOffset,
  );
  return attributed && attributed.wrappableLabelIds.size > 0
    ? attributed.wrappableLabelIds
    : undefined;
}
