import type { ElkNode } from "elkjs/lib/elk-api.js";
import { required } from "../presentation/util.js";
import { circuitInlineContext } from "./circuit-inline-context.js";
import type { CircuitLayoutRun } from "./circuit-inline.js";

export function rememberCircuitDrawing<T extends object>(
  drawing: T,
  input: ElkNode,
  run?: CircuitLayoutRun,
): T {
  run?.drawings.set(drawing, JSON.stringify(input));
  return drawing;
}

/** Only drawings emitted into the original printable drafts establish defects.
 * Whole-group and pagination probes that were discarded cannot affect a view. */
export function recordPrintedCircuitDrawing(drawing: object) {
  const context = circuitInlineContext.getStore(),
    run = context?.currentRun;
  if (!context || context.qualityPhase || !run) return;
  run.printed.add(
    required(run.drawings.get(drawing), "Missing printed circuit layout"),
  );
}
