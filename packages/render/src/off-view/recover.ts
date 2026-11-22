import type { ElectricalIr } from "@thermite/compiler";
import type { PresentationGraph, SelectedSubgraph } from "../types.js";
import type { ElkLayoutRequestOptions } from "../layout/elk-adapter.js";
import { layoutPresentationGraph } from "../layout/elk-adapter.js";
import { validatePresentationGraph } from "../presentation/validate.js";
import { addOffViewCards } from "./presentation.js";
import { nativeReservations } from "./native.js";
import type { DeviceTypeSymbolMapping } from "../symbols/mappings.js";
import { rootedGangSegments } from "../symbols/rooted-gangs.js";
export const MAX_INITIAL_CARD_REPAIRS = 16;

/** Reservation changes may move a routed wire onto a symbol. Retry real ELK
 * layouts; the original symbol-intersection guard remains mandatory. */
export async function recoverCardLayout(
  ir: Readonly<ElectricalIr>,
  graph: PresentationGraph,
  selected: SelectedSubgraph,
  mappings: readonly DeviceTypeSymbolMapping[],
  options: Readonly<ElkLayoutRequestOptions>,
) {
  if (
    !graph.nodes.some(
      (n) => n.kind !== "junction" && n.labels.some((l) => l.offView),
    )
  )
    return;
  const native = nativeReservations(graph);
  for (let rank = 1; rank <= MAX_INITIAL_CARD_REPAIRS; rank++) {
    const annotated = addOffViewCards(ir, native, { "*": rank });
    if (!annotated.ok) continue;
    validatePresentationGraph(ir, selected, annotated.value, mappings);
    const result = await layoutPresentationGraph(annotated.value, options);
    if (result.ok && rootedGangSegments(ir, annotated.value, result.value).ok)
      return { graph: annotated.value, layout: result };
  }
}
