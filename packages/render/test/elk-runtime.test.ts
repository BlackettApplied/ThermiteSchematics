import BundledElk from "elkjs/lib/elk.bundled.js";
import type { ElkNode } from "elkjs/lib/elk-api.js";
import { describe, expect, it } from "vitest";

import { createElkEngine } from "../src/layout/elk-runtime.js";

const probe: ElkNode = {
  id: "root",
  layoutOptions: {
    "elk.algorithm": "layered",
    "elk.direction": "RIGHT",
    "elk.edgeRouting": "ORTHOGONAL",
    "elk.randomSeed": "1",
  },
  children: [
    { id: "a", width: 10, height: 10 },
    { id: "b", width: 10, height: 10 },
  ],
  edges: [{ id: "a-b", sources: ["a"], targets: ["b"] }],
};

describe("ELK runtime adapter", () => {
  it("lays out through the upstream faux worker and leaves the caller's global self unchanged", async () => {
    const scope = globalThis as { self?: unknown };
    // Bun exposes a global `self` without `document`, which is what sent the
    // upstream worker down its Web Worker branch. Reproduce that shape where
    // the runtime lacks it, before this file first loads the worker.
    const installed = !("self" in scope);
    if (installed) {
      Object.defineProperty(globalThis, "self", {
        value: {},
        configurable: true,
        enumerable: false,
        writable: true,
      });
    }
    try {
      const callerSelf = scope.self as { onmessage?: unknown };
      const selfBefore = Object.getOwnPropertyDescriptor(globalThis, "self");
      const onmessageBefore = Object.getOwnPropertyDescriptor(
        callerSelf,
        "onmessage",
      );
      const handlerBefore = callerSelf.onmessage;

      const engine = createElkEngine();
      expect(Object.getPrototypeOf(engine)).toBe(
        (BundledElk as unknown as { prototype: object }).prototype,
      );
      const graph: ElkNode = await engine.layout(structuredClone(probe));
      const a = graph.children?.find(({ id }) => id === "a");
      const b = graph.children?.find(({ id }) => id === "b");
      expect(Number.isFinite(a?.x) && Number.isFinite(b?.x)).toBe(true);
      expect(b!.x!).toBeGreaterThan(a!.x! + a!.width!);
      expect(graph.edges?.[0]?.sections).toHaveLength(1);
      expect(await engine.knownLayoutOptions()).not.toHaveLength(0);

      expect(Object.getOwnPropertyDescriptor(globalThis, "self")).toEqual(
        selfBefore,
      );
      expect(scope.self).toBe(callerSelf);
      expect(Object.getOwnPropertyDescriptor(callerSelf, "onmessage")).toEqual(
        onmessageBefore,
      );
      expect(callerSelf.onmessage).toBe(handlerBefore);
    } finally {
      if (installed) delete scope.self;
    }
  });

  it("gives independent engines identical layouts", async () => {
    const [first, second] = await Promise.all([
      createElkEngine().layout(structuredClone(probe)),
      createElkEngine().layout(structuredClone(probe)),
    ]);
    // GWT adds private object-identity hashes ($H) to raw graph objects. They
    // differ between instances and never enter Thermite's normalized geometry.
    const layout = (value: unknown) =>
      JSON.stringify(value, (key, item) => (key === "$H" ? undefined : item));
    expect(layout(second)).toBe(layout(first));
  });
});
