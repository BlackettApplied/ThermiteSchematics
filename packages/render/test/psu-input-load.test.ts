import { beforeAll, describe, expect, it } from "vitest";
import type { ElectricalIr } from "@thermite/compiler";
import { compileCoreFixture } from "./fixtures.js";
import { projectDeviceTypeSymbolMappings } from "../src/symbols/mappings.js";
import { renderSchematic } from "../src/renderer.js";
let ir: ElectricalIr;
beforeAll(async () => {
  ir = await compileCoreFixture();
});
describe("PSU AC input power load", () => {
  it.each(["left-to-right", "top-to-bottom"] as const)(
    "draws authored PSU input feed in %s without crossing the DC function",
    async (flow) => {
      // The reference starter already authors both AC-input conductors.
      const before = JSON.stringify(ir);
      const r = await renderSchematic(ir, {
        format: "schematic-view-request/0.1",
        root: { by: "designation", value: "PS1" },
        family: "power",
        flow,
      });
      expect(r.ok, JSON.stringify(r)).toBe(true);
      if (r.ok) {
        expect(r.value.svg).toContain("ais:ac-load");
        expect(r.value.svg).not.toContain("ais:power-source-dc");
      }
      expect(JSON.stringify(ir)).toBe(before);
    },
  );
  it("does not treat an arbitrary two-terminal load as an AC supply input", () => {
    const v = structuredClone(ir),
      t = v.deviceTypes.find((t) => t.id === "core:psu-24vdc")!;
    t.id = "local:psu";
    t.symbol = "iec:dc-power-supply";
    for (const p of t.terminals)
      if (p.role === "ac_line_input") p.role = "unknown";
    const m = projectDeviceTypeSymbolMappings(v).find(
      (m) => m.typeId === t.id,
    )!;
    expect(m.functions.some((f) => f.functionKey === "ac_input")).toBe(false);
  });
});
