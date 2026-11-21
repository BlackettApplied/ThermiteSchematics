import type { ELK, ElkLayoutOptionDescription } from "elkjs/lib/elk-api.js";
import { deepFreeze } from "../internal.js";
import {
  circuitInlineContext,
  type CircuitInlineContext,
} from "./circuit-inline-context.js";

// Only a caller that owns the pinned default engine uses this reader. Neither
// injected engines nor the engine's public methods are changed. Weak render
// keys avoid retaining completed renders or engines.
const metadata = new WeakMap<
  CircuitInlineContext,
  Promise<ElkLayoutOptionDescription[]>
>();

export function defaultElkMetadata(
  engine: ELK,
): Pick<ELK, "knownLayoutOptions"> {
  return {
    knownLayoutOptions: async () => {
      const context = circuitInlineContext.getStore();
      if (!context) return engine.knownLayoutOptions();
      let pending = metadata.get(context);
      if (!pending) {
        pending = engine
          .knownLayoutOptions()
          .then((rows) => deepFreeze(structuredClone(rows)));
        metadata.set(context, pending);
        // A failed query must not poison later requests in the same render.
        void pending.catch(() => metadata.delete(context));
      }
      return pending;
    },
  };
}
