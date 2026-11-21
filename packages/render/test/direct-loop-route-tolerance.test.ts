import type { ElkNode } from "elkjs/lib/elk-api.js";
import { parseHTML } from "linkedom";
import { afterEach, expect, it, vi } from "vitest";
import * as runtime from "../src/layout/elk-runtime.js";
import { prepareSignalLoopDrawing } from "../src/signal-loop.js";
import { renderSchematicPacket } from "../src/sheets.js";
import {
  directFixture,
  directPacket,
  directView,
  flows,
} from "./direct-loop-fixture.js";

const factory = runtime.createElkEngine;
afterEach(() => vi.restoreAllMocks());

// Straddle the three-decimal output boundary with less than 1e-6 mm of noise.
// Rounding first turns this into a false 0.001 mm diagonal on the old path.
function injectNoise(flow: (typeof flows)[number], noise: number) {
  vi.spyOn(runtime, "createElkEngine").mockImplementation(() => {
    const engine = factory();
    return {
      layout: async (input: ElkNode) => {
        const g = await engine.layout(input);
        const section = g.edges![0]!.sections![0]!;
        const axis = flow === "left-to-right" ? "y" : "x";
        const shift =
          Math.round(section.startPoint[axis] * 1000) / 1000 +
          0.0004998 -
          section.startPoint[axis];
        for (const node of g.children!) node[axis]! += shift;
        for (const edge of g.edges!) {
          for (const label of edge.labels ?? []) label[axis]! += shift;
          for (const s of edge.sections!)
            for (const p of [s.startPoint, ...(s.bendPoints ?? []), s.endPoint])
              p[axis] += shift;
        }
        g.width! += Math.abs(shift) + 1;
        g.height! += Math.abs(shift) + 1;
        const next = section.bendPoints?.[0] ?? section.endPoint;
        expect(next[axis]).toBeCloseTo(section.startPoint[axis], 10);
        next[axis] += noise;
        return g;
      },
    } as ReturnType<typeof factory>;
  });
}

it.each(flows)(
  "draws and snaps a near-orthogonal direct route in %s",
  async (flow) => {
    const f = await directFixture();
    try {
      injectNoise(flow, 4e-7);
      const view = directView({ flow });
      const drawing = await prepareSignalLoopDrawing(f.ir, view);
      const { document } = parseHTML(drawing.content);
      const paths = [
        ...document.querySelectorAll("[data-loop-conductor] path"),
      ];
      expect(paths).toHaveLength(2);
      for (const path of paths) {
        const ps = [
          ...path.getAttribute("d")!.matchAll(/[ML] ([-.\d]+) ([-.\d]+)/g),
        ].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));
        expect(ps.length).toBeGreaterThanOrEqual(2);
        for (let i = 1; i < ps.length; i++)
          expect(ps[i]!.x === ps[i - 1]!.x || ps[i]!.y === ps[i - 1]!.y).toBe(
            true,
          );
      }
      const result = await renderSchematicPacket(f.ir, directPacket(view));
      expect(result.ok, JSON.stringify(result)).toBe(true);
    } finally {
      await f.dispose();
    }
  },
);

it.each(flows)(
  "still refuses a diagonal direct route above tolerance in %s",
  async (flow) => {
    const f = await directFixture();
    try {
      injectNoise(flow, 2e-6);
      const view = directView({ flow });
      await expect(prepareSignalLoopDrawing(f.ir, view)).rejects.toThrow(
        "Non-orthogonal signal loop route.",
      );
      const result = await renderSchematicPacket(f.ir, directPacket(view));
      expect(result).toMatchObject({
        ok: false,
        error: {
          code: "R006",
          reason: "unprintable-layout",
          message:
            'Packet view[0] "TX1 - signal loop": Non-orthogonal signal loop route.',
        },
      });
      expect(result).not.toHaveProperty("value");
    } finally {
      await f.dispose();
    }
  },
);
