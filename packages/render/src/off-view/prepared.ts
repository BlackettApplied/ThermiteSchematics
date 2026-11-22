import type { ElectricalIr } from "@thermite/compiler";
import type { PreparedSchematicDrawing } from "../renderer.js";
import type {
  PresentationGraph,
  SelectedSubgraph,
  RenderOutcome,
} from "../types.js";
import type { DeviceTypeSymbolMapping } from "../symbols/mappings.js";
import {
  layoutPresentationGraph,
  type ElkLayoutRequestOptions,
} from "../layout/elk-adapter.js";
import { validatePresentationGraph } from "../presentation/validate.js";
import { preflightRenderText } from "../svg/escape.js";
import { nativeReservations } from "./native.js";
import { addOffViewCards, offViewLayoutFailure } from "./presentation.js";
import { recoverCardLayout } from "./recover.js";
import { required } from "../presentation/util.js";
import { rootedGangSegments } from "../symbols/rooted-gangs.js";
import { reservePowerJogSpace } from "./power-jog-space.js";
import type { ELK as ElkApi } from "elkjs/lib/elk-api.js";
import type { PaginationSpacing } from "../layout/spacing.js";

export interface DrawingContext {
  ir: Readonly<ElectricalIr>;
  selected: Readonly<SelectedSubgraph>;
  mappings: readonly DeviceTypeSymbolMapping[];
  options: Readonly<ElkLayoutRequestOptions>;
}
const contexts = new WeakMap<PreparedSchematicDrawing, DrawingContext>();
export function rememberDrawing(
  p: PreparedSchematicDrawing,
  context: DrawingContext,
) {
  contexts.set(p, context);
  return p;
}

/** Re-route the exact selected presentation, keeping its reservations, fixed
 * ports and source context. The supplied engine owns the single quality input. */
export async function relayoutDrawing(
  p: PreparedSchematicDrawing,
  engine: ElkApi,
): Promise<RenderOutcome<PreparedSchematicDrawing>> {
  const c = required(contexts.get(p), "Missing prepared source context");
  const layout = await layoutPresentationGraph(p.graph, {
    ...c.options,
    engine,
  });
  if (!layout.ok)
    return { ok: false, error: offViewLayoutFailure(p.graph, layout.error) };
  const gangs = rootedGangSegments(c.ir, p.graph, layout.value);
  return gangs.ok
    ? { ok: true, value: rememberDrawing({ ...p, layout: layout.value }, c) }
    : gangs;
}

export async function repaginateDrawing(
  p: PreparedSchematicDrawing,
  original: PreparedSchematicDrawing,
  spacing: PaginationSpacing,
): Promise<RenderOutcome<PreparedSchematicDrawing>> {
  const c = required(contexts.get(original), "Missing prepared source context");
  const layout = await layoutPresentationGraph(p.graph, {
    ...c.options,
    paginationRetry: { original: p.layout, spacing },
  });
  if (!layout.ok) return layout;
  const gangs = rootedGangSegments(c.ir, p.graph, layout.value);
  return gangs.ok
    ? { ok: true, value: rememberDrawing({ ...p, layout: layout.value }, c) }
    : gangs;
}
export async function initialCardLayout(
  graph: PresentationGraph,
  c: DrawingContext,
  repair: boolean,
) {
  const layout = await layoutPresentationGraph(graph, c.options);
  const gangs = layout.ok
    ? rootedGangSegments(c.ir, graph, layout.value)
    : undefined;
  if (
    repair &&
    ((!layout.ok && layout.failureKind === "symbol-intersection") ||
      (gangs && !gangs.ok))
  ) {
    const recovered = await recoverCardLayout(
      c.ir,
      graph,
      c.selected,
      c.mappings,
      c.options,
    );
    if (recovered) return recovered;
  }
  if (gangs && !gangs.ok)
    return {
      graph,
      layout: { ...gangs, failureKind: "mechanical-gang" as const },
    };
  return { graph, layout };
}

/** Same selected graph and source context, fresh reservations and ELK. Avoid
 * re-running selection/normalisation for each purely visual alternative. */
export async function repositionDrawing(
  p: PreparedSchematicDrawing,
  choices: Readonly<Record<string, number>>,
  jogSpace = 0,
  powerTurnSpacing = 0,
): Promise<RenderOutcome<PreparedSchematicDrawing>> {
  const c = required(contexts.get(p), "Missing prepared source context");
  const native = reservePowerJogSpace(nativeReservations(p.graph), jogSpace);
  const annotated = addOffViewCards(c.ir, native, choices);
  if (!annotated.ok) return annotated;
  validatePresentationGraph(c.ir, c.selected, annotated.value, c.mappings);
  const preflight = preflightRenderText(annotated.value);
  if (!preflight.ok) return preflight;
  const layout = await layoutPresentationGraph(annotated.value, {
    ...c.options,
    powerTurnSpacing,
  });
  if (!layout.ok)
    return {
      ok: false,
      error: offViewLayoutFailure(annotated.value, layout.error),
    };
  const gangs = rootedGangSegments(c.ir, annotated.value, layout.value);
  if (!gangs.ok) return gangs;
  return {
    ok: true,
    value: rememberDrawing(
      { ...p, graph: annotated.value, layout: layout.value },
      c,
    ),
  };
}

/** Reuse the exact validated selection/options for the no-card comparison. */
export async function nativeDrawing(
  p: PreparedSchematicDrawing,
): Promise<RenderOutcome<PreparedSchematicDrawing>> {
  const c = required(contexts.get(p), "Missing prepared source context"),
    graph = nativeReservations(p.graph);
  const layout = await layoutPresentationGraph(graph, c.options);
  if (layout.ok) {
    const gangs = rootedGangSegments(c.ir, graph, layout.value);
    if (!gangs.ok) return gangs;
  }
  return layout.ok
    ? { ok: true, value: { ...p, graph, layout: layout.value } }
    : { ok: false, error: layout.error };
}
