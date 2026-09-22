import ELK from "elkjs/lib/elk.bundled.js";
import { describe, expect, it } from "vitest";

import * as render from "../src/index.js";

describe("render public API", () => {
  it("exports the frozen renderer version constants", () => {
    expect(Object.keys(render).sort()).toEqual([
      "LAYOUT_CONFIG_VERSION",
      "RENDERER_VERSION",
      "SYMBOL_CATALOG_VERSION",
      "createSchematicRenderer",
      "normalizePaperPage",
      "printPacketHtml",
      "renderSchematic",
      "renderSchematicPacket",
      "renderSchematicSheets",
    ]);
    expect(render.RENDERER_VERSION).toBe("render/0.3");
    expect(render.SYMBOL_CATALOG_VERSION).toBe("ais-symbols/0.3");
    expect(render.LAYOUT_CONFIG_VERSION).toBe("elk-layered/0.4+elkjs-0.12.0");
    expect(render.createSchematicRenderer).toBeTypeOf("function");
    expect(render.renderSchematic).toBeTypeOf("function");
  });

  it("loads the bundled ELK implementation without worker configuration", async () => {
    const elk = new ELK();
    const graph = await elk.layout({
      id: "root",
      layoutOptions: { "elk.algorithm": "layered" },
      children: [],
    });

    expect(graph.id).toBe("root");
  });
});
