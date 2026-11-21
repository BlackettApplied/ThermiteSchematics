import type { ELK as ElkApi } from "elkjs/lib/elk-api.js";
import type {
  NormalizedSchematicLayout,
  PresentationGraph,
  SelectedSubgraph,
} from "../types.js";
import type { SymbolDefinition } from "../symbols/types.js";
import { SYMBOL_CATALOG } from "../symbols/catalog.js";
import { required } from "../presentation/util.js";
import { reserveContinuationSources } from "../packet/continuation-source.js";
import { buildElkAdapterGraph } from "./elk-adapter.js";
import { validateLayoutOptions } from "./elk-contract.js";
import { createElkEngine } from "./elk-runtime.js";
import { rootedRouteAlternatives } from "./direct-load-routes.js";
import { contextForkOrderAlternatives } from "./context-fork-order.js";
import { rootedRecovery, type RootedRecovery } from "./rooted-recovery.js";
import { applyLayoutSpacing, type PaginationSpacing } from "./spacing.js";
import {
  orderControlArms,
  placeControlJoin,
  type ControlReconvergence,
} from "./control-reconvergence.js";
import {
  normalizeAndValidateLayout,
  type LayoutValidationOutcome,
} from "./validate-output.js";

export interface ElkLayoutRequestOptions {
  readonly packetContinuations?: boolean;
  readonly catalog?: readonly SymbolDefinition[];
  readonly engine?: ElkApi;
  readonly selected?: Readonly<SelectedSubgraph>;
  readonly spacingProfile?: "compact" | "dense";
  readonly powerTurnSpacing?: number;
  readonly paginationRetry?: {
    readonly original: NormalizedSchematicLayout;
    readonly spacing: PaginationSpacing;
    readonly join?: ControlReconvergence;
  };
}

const packetLayoutInputs = new WeakMap<
  NormalizedSchematicLayout,
  { graph: Readonly<PresentationGraph>; recovery: RootedRecovery | undefined }
>();

function keepPacketInput(
  graph: PresentationGraph,
  options: ElkLayoutRequestOptions,
) {
  return (
    options.packetContinuations &&
    (graph.view.flow === "top-to-bottom" || graph.view.family === "control")
  );
}

export async function layoutPresentationGraph(
  graph: Readonly<PresentationGraph>,
  options: Readonly<ElkLayoutRequestOptions> = {},
): Promise<LayoutValidationOutcome> {
  const catalog = options.catalog ?? SYMBOL_CATALOG;
  const engine = options.engine ?? createElkEngine();
  const run = async (
    candidate: Readonly<PresentationGraph>,
    recovery?: RootedRecovery,
  ) => {
    const join = options.paginationRetry?.join;
    if (join) candidate = orderControlArms(candidate, join);
    if (options.packetContinuations) reserveContinuationSources(candidate);
    const build = buildElkAdapterGraph(candidate, options.selected, recovery);
    if (join) placeControlJoin(build.graph, join);
    await validateLayoutOptions(build, engine, options.engine);
    const input = structuredClone(build.graph);
    applyLayoutSpacing(input, candidate, {
      ...options,
      ...(options.paginationRetry
        ? { paginationSpacing: options.paginationRetry.spacing }
        : {}),
    });
    const output = await engine.layout(input);
    const result = normalizeAndValidateLayout(
      candidate,
      build.graph,
      output,
      catalog,
    );
    if (result.ok && keepPacketInput(candidate, options))
      packetLayoutInputs.set(result.value, { graph: candidate, recovery });
    return result;
  };
  // Replay the already validated routing input with only the spacing change.
  // The proposal has one native call and its own full validation.
  if (options.paginationRetry) {
    const base = required(
      packetLayoutInputs.get(options.paginationRetry.original),
      "Missing original packet layout input",
    );
    return run(base.graph, base.recovery);
  }
  const first = await run(graph);
  if (first.ok) return first;
  if (
    (graph.view.format === "schematic-view/0.2" &&
      graph.view.intent === "loads") ||
    first.failureKind === "ambiguous-intersection" ||
    first.failureKind === "collinear-overlap"
  ) {
    // Preserve the existing fork and route search before changing model order.
    for (const alternatives of [
      contextForkOrderAlternatives(graph),
      rootedRouteAlternatives(graph),
    ])
      for (const candidate of alternatives) {
        const result = await run(candidate);
        if (result.ok) return result;
      }
  }
  const recovery = rootedRecovery(graph, first, options.selected);
  if (recovery !== undefined) {
    const recovered = await run(graph, recovery);
    if (recovered.ok) return recovered;
  }
  return first;
}
