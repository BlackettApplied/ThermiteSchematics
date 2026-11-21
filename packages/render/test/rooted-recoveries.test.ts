import { beforeAll, expect, it } from "vitest";
import {
  compileProject,
  type ElectricalIr,
  type CompiledProjectPresentation,
} from "@thermite/compiler";
import { renderSchematicPacket } from "../src/sheets.js";
let ir: ElectricalIr, presentation: CompiledProjectPresentation | undefined;
beforeAll(async () => {
  const c = await compileProject("examples/motor-starter");
  if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
  ir = c.ir;
  presentation = c.presentation;
});
it.each([
  ["tabloid", "landscape", "compact", 2],
  ["a3", "landscape", "compact", 2],
  ["a3", "portrait", "standard", 4],
  ["letter", "portrait", "compact", 5],
] as const)(
  "recovers %s %s %s without borrowing another case's savings",
  async (size, orientation, layout, maximum) => {
    const r = await renderSchematicPacket(
      ir,
      {
        format: "schematic-packet-request/0.1",
        layout,
        page: { size, orientation },
        views: [
          {
            format: "schematic-view-request/0.1",
            root: { by: "designation", value: "M1" },
            family: "power",
            flow: "left-to-right",
          },
          {
            format: "schematic-view-request/0.1",
            root: { by: "designation", value: "K1" },
            family: "control",
            flow: "left-to-right",
          },
        ],
      },
      presentation,
    );
    if (!r.ok) throw Error(JSON.stringify(r.error));
    expect(r.value.sheets.length).toBeLessThanOrEqual(maximum);
  },
  30000,
);
