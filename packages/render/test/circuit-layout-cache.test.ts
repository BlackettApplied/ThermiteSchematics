import { expect, it } from "vitest";
import {
  cachedCircuitLayout,
  circuitInlineContext,
  circuitLayoutCacheKey,
  type CircuitInlineContext,
} from "../src/layout/circuit-inline-context.js";
import { InlineLabelFitError } from "../src/layout/inline-label-error.js";

function context(): CircuitInlineContext {
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

it("separates ELK call options in the cache and quality authorization", async () => {
  const state = context(),
    input = { id: "graph" },
    right = { layoutOptions: { "elk.direction": "RIGHT" } },
    down = { layoutOptions: { "elk.direction": "DOWN" } };
  let calls = 0;
  await circuitInlineContext.run(state, async () => {
    const layout = async () => ({ id: "graph", call: ++calls });
    const a = await cachedCircuitLayout(input, layout, right);
    const b = await cachedCircuitLayout(input, layout, down);
    expect(a.call).toBe(1);
    expect(b.call).toBe(2);
    expect(await cachedCircuitLayout(input, layout, right)).toEqual(a);
    state.qualityPhase = true;
    const other = { id: "authorised alternative" };
    state.permittedInputs.add(circuitLayoutCacheKey(other, right));
    await cachedCircuitLayout(other, layout, right);
    await expect(cachedCircuitLayout(other, layout, down)).rejects.toThrow(
      InlineLabelFitError,
    );
    expect(calls).toBe(3);
  });
});

it("leaves inputs untouched on cache misses and hits, returning independent graphs", async () => {
  const input = { id: "graph", child: { x: 0 } },
    expected = structuredClone(input);
  let calls = 0;
  await circuitInlineContext.run(context(), async () => {
    const layout = async (copy: typeof input) => {
      calls++;
      copy.child.x = 10;
      return copy;
    };
    const a = await cachedCircuitLayout(input, layout);
    expect(input).toEqual(expected);
    a.child.x = 999;
    const b = await cachedCircuitLayout(input, layout);
    expect(input).toEqual(expected);
    expect(b.child.x).toBe(10);
    expect(b).not.toBe(a);
    expect(calls).toBe(1);
  });
});

it("forwards ELK call options through the packet cache", async () => {
  const { createElkEngine } = await import("../src/layout/elk-runtime.js");
  const input = {
    id: "graph",
    children: [
      { id: "a", width: 10, height: 10 },
      { id: "b", width: 10, height: 10 },
    ],
    edges: [{ id: "e", sources: ["a"], targets: ["b"] }],
  };
  await circuitInlineContext.run(context(), async () => {
    const engine = createElkEngine();
    const right = await engine.layout(input, {
      layoutOptions: { "elk.algorithm": "layered", "elk.direction": "RIGHT" },
    });
    const down = await engine.layout(input, {
      layoutOptions: { "elk.algorithm": "layered", "elk.direction": "DOWN" },
    });
    expect(right.children![1]!.x).toBeGreaterThan(right.children![0]!.x!);
    expect(right.children![1]!.y).toBe(right.children![0]!.y);
    expect(down.children![1]!.y).toBeGreaterThan(down.children![0]!.y!);
    expect(down.children![1]!.x).toBe(down.children![0]!.x);
    expect(input.children.every((child) => !("x" in child))).toBe(true);
  });
});
