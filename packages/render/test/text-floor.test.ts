import { beforeAll, expect, it } from "vitest";
import { parseHTML } from "linkedom";
import type { ElectricalIr } from "@thermite/compiler";
import { THERMITE_RELEASE_VERSION } from "@thermite/schema";
import { renderSchematicPacket } from "../src/sheets.js";
import { compileCoreFixture } from "./fixtures.js";
import { motorCircuitView, controlCircuitView } from "./circuit-fixture.js";
import { breakerAuxiliaryFixture } from "./breaker-auxiliary-fixture.js";

let ir: ElectricalIr;
beforeAll(async () => {
  ir = await compileCoreFixture();
});
for (const flow of ["left-to-right", "top-to-bottom"] as const) {
  it(`keeps frame, zone, footer, boundary and relation text at the literal floor in ${flow}`, async () => {
    const r = await renderSchematicPacket(ir, {
      format: "schematic-packet-request/0.1",
      views: [
        { ...motorCircuitView(), flow },
        { ...controlCircuitView(), flow },
      ],
    });
    if (!r.ok) throw Error(JSON.stringify(r.error));
    const nodes = [
      ...parseHTML(r.value.html).document.querySelectorAll("text"),
    ];
    expect(nodes.length).toBeGreaterThan(30);
    for (const value of [
      "A",
      "6",
      "BOUNDARY",
      `Thermite ${THERMITE_RELEASE_VERSION}`,
    ])
      expect(nodes.some((n) => n.textContent === value)).toBe(true);
    const secondary = nodes.filter(
      (n) =>
        n.textContent?.includes(": 100") || n.textContent?.includes(": 200"),
    );
    expect(secondary.length).toBeGreaterThan(0);
    for (const n of nodes)
      expect(Number(n.getAttribute("font-size"))).toBeGreaterThanOrEqual(2.5);
    const designations = nodes.filter(
      (n) => n.getAttribute("data-tag-field") === "designation",
    );
    expect(designations.length).toBeGreaterThan(0);
    for (const n of designations)
      expect(Number(n.getAttribute("font-size"))).toBeGreaterThanOrEqual(2.7);
  });
  it(`reserves and prints both contact captions at the floor in ${flow}`, async () => {
    const f = await breakerAuxiliaryFixture();
    try {
      const r = await renderSchematicPacket(f.ir, {
        ...f.request,
        views: f.request.views.map((v) => ({ ...v, flow })),
      });
      if (!r.ok) throw Error(JSON.stringify(r.error));
      const doc = parseHTML(r.value.html).document;
      const captions = [...doc.querySelectorAll("[data-contact-caption] text")];
      expect(captions.map((c) => c.textContent).sort()).toEqual(["NC", "NO"]);
      for (const c of captions)
        expect(Number(c.getAttribute("font-size"))).toBe(2.5);
      expect(
        r.value.coverage.diagnostics?.filter((d) => d.code === "W907") ?? [],
      ).toEqual([]);
    } finally {
      await f.dispose();
    }
  });
}
