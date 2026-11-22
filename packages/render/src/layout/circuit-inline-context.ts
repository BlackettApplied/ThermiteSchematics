import { serialize } from "node:v8";
import { AsyncLocalStorage } from "node:async_hooks";
import { InlineLabelFitError } from "./inline-label-error.js";
import type { CircuitLayoutRun } from "./circuit-inline.js";
import type { ElkLayoutArguments } from "elkjs/lib/elk-api.js";
import { chargeElkWork, recordElkDispatch } from "./elk-work.js";

export interface CircuitInlineContext {
  baselineLayouts?: number;
  cursor: number;
  runs: CircuitLayoutRun[];
  currentRun?: CircuitLayoutRun;
  selected: Set<number>;
  layouts: Map<string, unknown>;
  qualityPhase: boolean;
  permittedInputs: Set<string>;
  viewDecisions: { view: number; reason: string }[];
}
export const circuitInlineContext =
  new AsyncLocalStorage<CircuitInlineContext>();

export const circuitInlineTrace = new AsyncLocalStorage<
  CircuitInlineContext[]
>();

export function circuitLayoutContext(): CircuitInlineContext {
  return {
    cursor: 0,
    runs: [],
    selected: new Set(),
    layouts: new Map(),
    qualityPhase: false,
    permittedInputs: new Set(),
    viewDecisions: [],
  };
}

/** Standalone rooted searches use the same cache as packet recomposition.
 * Search order and its saved outputs remain unchanged; only exact repeats hit. */
export function withCircuitLayoutCache<T>(
  render: () => Promise<T>,
): Promise<T> {
  return circuitInlineContext.getStore()
    ? render()
    : circuitInlineContext.run(circuitLayoutContext(), render);
}

export const circuitLayoutCacheKey = (
  input: unknown,
  options?: ElkLayoutArguments,
) => serialize([input, options]).toString("base64");

/** Within the packet cache, misses lay out a clone and hits return a clone:
 * neither mutates its input, and callers consume the returned graph. Only an
 * authorised circuit or LTR power alternative has a new input in the quality
 * pass. Both families share this exact-input cache and original packet guard. */
export async function cachedCircuitLayout<Input, T>(
  input: Input,
  layout: (copy: Input) => Promise<T>,
  options?: ElkLayoutArguments,
): Promise<T> {
  const context = circuitInlineContext.getStore();
  if (!context) {
    chargeElkWork();
    recordElkDispatch();
    return layout(input);
  }
  const key = circuitLayoutCacheKey(input, options),
    found = context.layouts.get(key);
  if (found) {
    chargeElkWork(true);
    return structuredClone(found) as T;
  }
  chargeElkWork();
  if (context.qualityPhase && !context.permittedInputs.has(key))
    throw new InlineLabelFitError(
      "Circuit alternative requires recovery outside the original printable composition.",
    );
  recordElkDispatch();
  const output = await layout(structuredClone(input));
  context.layouts.set(key, structuredClone(output));
  return output;
}
