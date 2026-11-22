import type { ElkNode } from "elkjs/lib/elk-api.js";
import { afterEach, expect, it, vi } from "vitest";
import { placeLoopLabels } from "../src/layout/direct-loop-labels.js";
import { elkWorkLedger, elkWorkScope } from "../src/layout/elk-work.js";
import { prepareSignalLoopDrawing } from "../src/signal-loop.js";
import { directFixture, directView, flows } from "./direct-loop-fixture.js";
import { fixture, removeFixtures } from "../../cli/test/analog-output.cases.js";

afterEach(async () => {
  vi.restoreAllMocks();
  await removeFixtures();
});

it("selects the unique longest vertical segment among two equal shorter segments", () => {
  const edge = {
    id: "wire",
    sources: ["a"],
    targets: ["b"],
    sections: [
      {
        id: "s",
        startPoint: { x: 0, y: 0 },
        bendPoints: [
          { x: 0, y: 6 },
          { x: 10, y: 6 },
          { x: 10, y: 26 },
          { x: 20, y: 26 },
        ],
        endPoint: { x: 20, y: 32 },
      },
    ],
    labels: [],
  };
  const graph: ElkNode = { id: "unequal", edges: [edge] };
  const routes = structuredClone(edge.sections);
  placeLoopLabels(
    graph,
    new Map([["wire", [{ text: "W1", width: 6, height: 4 }]]]),
  );
  expect(graph.edges?.[0]?.labels).toEqual([
    { text: "W1", width: 6, height: 4, x: 7, y: 14 },
  ]);
  expect(edge.sections).toEqual(routes);
});

it.each(flows)(
  "uses exactly one logical ELK request and dispatch for an input loop in %s",
  async (flow) => {
    const f = await directFixture((model) => {
      for (const object of model.objects)
        if (object.kind === "wire") object.designation += "-LONG-LABEL";
    });
    try {
      const work = elkWorkLedger("input-loop", 10);
      await elkWorkScope.run(work, () =>
        prepareSignalLoopDrawing(f.ir, directView({ flow })),
      );
      expect(work.calls).toBe(1);
      expect(work.dispatches).toBe(1);
      expect(work.cacheHits).toBe(0);
    } finally {
      await f.dispose();
    }
  },
);

it("uses exactly one logical ELK request and dispatch for an LTR output loop", async () => {
  const f = await fixture();
  const ir = await f.compile();
  const work = elkWorkLedger("ltr-output-loop", 10);
  await elkWorkScope.run(work, () =>
    prepareSignalLoopDrawing(ir, {
      ...f.packet.views[0],
      flow: "left-to-right",
    }),
  );
  expect(work.calls).toBe(1);
  expect(work.dispatches).toBe(1);
  expect(work.cacheHits).toBe(0);
});
