import { afterEach, expect, it, vi } from "vitest";
import type { ELK } from "elkjs/lib/elk-api.js";
import { layoutWiring } from "../src/layout/wiring-layout.js";
import * as runtime from "../src/layout/elk-runtime.js";

const factory = runtime.createElkEngine;
afterEach(() => vi.restoreAllMocks());
it.each([true, false])(
  "keeps fixed-port self-loop compatibility (%s) in one ELK attempt",
  async (selfLoop) => {
    const engine = factory();
    const layout = vi.fn(engine.layout.bind(engine));
    vi.spyOn(runtime, "createElkEngine").mockReturnValue({
      layout,
    } as unknown as ELK);
    const port = (id: string, x: number, y: number) => ({
      id,
      x,
      y,
      width: 0,
      height: 0,
      layoutOptions: { "elk.port.side": x === 0 ? "WEST" : "EAST" },
    });
    const nodes = [
      {
        id: "a",
        width: 40,
        height: 40,
        layoutOptions: { "elk.portConstraints": "FIXED_POS" },
        ports: [port("a1", 40, 10), port("a2", 0, 20)],
      },
      {
        id: "b",
        width: 40,
        height: 40,
        layoutOptions: { "elk.portConstraints": "FIXED_POS" },
        ports: [port("b1", 0, 10)],
      },
    ];
    const edges = [
      { id: "e", sources: ["a1"], targets: [selfLoop ? "a2" : "b1"] },
    ];
    await layoutWiring(nodes, edges);
    expect(layout).toHaveBeenCalledTimes(1);
    expect(
      layout.mock.calls[0]![0].layoutOptions[
        "elk.layered.nodePlacement.strategy"
      ],
    ).toBe(selfLoop ? "BRANDES_KOEPF" : "NETWORK_SIMPLEX");
    expect(layout.mock.calls[0]![0].children).toBe(nodes);
    expect(layout.mock.calls[0]![0].edges).toBe(edges);
  },
);
