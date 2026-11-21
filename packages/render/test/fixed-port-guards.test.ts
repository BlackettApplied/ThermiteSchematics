import type { ElkNode } from "elkjs/lib/elk-api.js";
import { afterEach, expect, it, vi } from "vitest";
import * as runtime from "../src/layout/elk-runtime.js";
import { assertTopologyRouteEndpoints } from "../src/layout/topology-conservation.js";
import { prepareWiringDrawing } from "../src/wiring.js";
import { prepareSignalLoopDrawing } from "../src/signal-loop.js";
import { directFixture, directView } from "./direct-loop-fixture.js";

const factory = runtime.createElkEngine;
afterEach(() => vi.restoreAllMocks());

// Move a fixed port and every incident route end together. Coherence with the
// returned port still passes; only comparison with the declared input catches it.
function movePort(axis: "x" | "y") {
  vi.spyOn(runtime, "createElkEngine").mockImplementation(() => {
    const engine = factory();
    return {
      layout: async (input: ElkNode) => {
        const graph = await engine.layout(input);
        const port = graph.children![0]!.ports![0]!;
        port[axis]! += 0.02;
        for (const edge of graph.edges ?? []) {
          if (edge.sources.includes(port.id))
            edge.sections![0]!.startPoint[axis] += 0.02;
          if (edge.targets.includes(port.id))
            edge.sections!.at(-1)!.endPoint[axis] += 0.02;
        }
        assertTopologyRouteEndpoints(graph);
        return graph;
      },
    } as ReturnType<typeof factory>;
  });
}

it.each(["x", "y"] as const)(
  "refuses a coherent wiring port moved in %s beyond 0.01",
  async (axis) => {
    const f = await directFixture();
    try {
      movePort(axis);
      await expect(
        prepareWiringDrawing(f.ir, {
          format: "wiring-view-request/0.1",
          title: "Fixed wiring ports",
          conductors: ["W10", "W11"],
        }),
      ).rejects.toThrow("Topology layout moved a fixed source port.");
    } finally {
      await f.dispose();
    }
  },
);

it.each(["left-to-right", "top-to-bottom"] as const)(
  "refuses a coherent direct-loop fixed port displacement in %s",
  async (flow) => {
    const f = await directFixture();
    try {
      movePort(flow === "left-to-right" ? "y" : "x");
      await expect(
        prepareSignalLoopDrawing(f.ir, directView({ flow })),
      ).rejects.toThrow("Topology layout moved a fixed source port.");
    } finally {
      await f.dispose();
    }
  },
);
