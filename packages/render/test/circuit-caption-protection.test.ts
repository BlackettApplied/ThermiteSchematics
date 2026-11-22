import { expect, it, vi } from "vitest";
import { captionHostWitness } from "./helpers/circuit-caption-host.js";
import { recoverLeaderCaptionBlocks } from "../src/circuit/caption-block.js";
import { circuitCaptionPlacement } from "../src/circuit/caption-placement.js";
import * as search from "../src/layout/wiring-label-support.js";
import { required } from "./fixtures.js";

async function fixture() {
  const [, , , native] = await captionHostWitness(),
    a = { index: 0, x: 21.5, y: 20.5, width: 5, height: 3.8, text: "A" },
    b = { index: 1, x: 50, y: 24.4, width: 4, height: 3.8, text: "B" },
    segments = [
      { index: 0, a: { x: 23, y: 26 }, b: { x: 24, y: 26 } },
      { index: 1, a: { x: 28.5, y: 24.4 }, b: { x: 28.5, y: 34.4 } },
      { index: 2, a: { x: 19.5, y: 19 }, b: { x: 19.5, y: 23 } },
    ],
    state = {
      ...native,
      cs: native.cs.slice(0, 3).map((c) => ({ ...c, jumper: false })),
      labels: [a, b],
      segments,
      graph: {
        id: "protected-captions",
        width: 70,
        height: 60,
        children: [],
        edges: segments.slice(0, 2).map((s) => ({
          id: `e${s.index}`,
          sources: [`s${s.index}`],
          targets: [`t${s.index}`],
          sections: [
            {
              id: `route${s.index}`,
              startPoint: s.a,
              endPoint: s.b,
            },
          ],
        })),
      },
    },
    bad = { ...b, x: 24.225 };
  const before = circuitCaptionPlacement(a.text, 0, a, state),
    obstructed = { ...state, labels: [a, bad] };
  expect(before?.points).toBeDefined();
  expect(circuitCaptionPlacement(bad.text, 0, bad, obstructed)).toBeDefined();
  expect(circuitCaptionPlacement(a.text, 0, a, obstructed)).toBeUndefined();
  return { state, a, b, bad, before };
}
it("searches past a fitting block that would obstruct an already-placed caption's leader", async () => {
  const { state, a, b, before } = await fixture(),
    result = recoverLeaderCaptionBlocks(state, state.labels),
    after = { ...state, labels: result.labels };
  expect(result.labels[0]).toEqual(a);
  expect(result.labels[1]).toEqual({ ...b, x: 28.775 });
  expect(
    circuitCaptionPlacement(a.text, 0, required(result.labels[0]), after),
  ).toEqual(before);
  expect(
    circuitCaptionPlacement(b.text, 0, required(result.labels[1]), after),
  ).toBeDefined();
  expect(after.graph).toEqual(state.graph);
});
it("rechecks protection when the search boundary returns an inadmissible proposal", async () => {
  const { state, a, b, bad, before } = await fixture();
  // Deliberately return the rejected proposal to exercise the independent
  // acceptance guard; glyph/leader admission itself is the real planner.
  const spy = vi
    .spyOn(search, "ownedWiringLabels")
    .mockImplementation((graph) => {
      const copy = structuredClone(graph),
        edge = required(copy.edges?.find((e) => e.id === "e1"));
      const { index, ...label } = bad;
      edge.labels = [label];
      return copy;
    });
  try {
    const result = recoverLeaderCaptionBlocks(state, state.labels),
      after = { ...state, labels: result.labels };
    expect(spy).toHaveBeenCalledTimes(1);
    expect(result.labels).toEqual([a, b]);
    expect(result.baseFallbacks.size).toBe(0);
    expect(
      circuitCaptionPlacement(a.text, 0, required(result.labels[0]), after),
    ).toEqual(before);
  } finally {
    spy.mockRestore();
  }
});
