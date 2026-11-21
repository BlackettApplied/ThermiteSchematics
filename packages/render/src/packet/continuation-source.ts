import type { PresentationGraph } from "../types.js";
import {
  continuationIdentity,
  type ContinuationIdentity,
} from "./continuation-identity.js";
import { labelMetrics } from "./label-text.js";

const sources = new WeakMap<
  Readonly<PresentationGraph>,
  readonly (ContinuationIdentity & { readonly width: number })[]
>();
/** Prepare the literal source envelopes before ELK; paper banks belong to the
 * packet planner, not to electrical nodes. Layout discovery supplies cut sides
 * and the serial-number envelope before the accepted cut layout is built. */
export function reserveContinuationSources(graph: Readonly<PresentationGraph>) {
  const found = sources.get(graph);
  if (found) return found;
  const values = graph.edges.flatMap((e) => {
    const i = continuationIdentity(e);
    return i ? [i] : [];
  });
  const reserved = Object.freeze(
    values.map((v) =>
      Object.freeze({ ...v, width: labelMetrics(v.conductor).width }),
    ),
  );
  sources.set(graph, reserved);
  return reserved;
}
