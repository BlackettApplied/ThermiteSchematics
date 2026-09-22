import { describe, it, expect, vi } from "vitest";
import BundledElk from "elkjs/lib/elk.bundled.js";
import type { ELK, ElkNode } from "elkjs/lib/elk-api.js";
import { parseHTML } from "linkedom";
import { connectorFixture } from "../../compiler/test/connector-fixture.js";
import {
  buildConnectorAssemblyInventory,
  buildDocumentation,
  buildCommunicationInventory,
  createQueryEngine,
} from "@thermite/query";
import {
  prepareConnectorAssemblyDrawing,
  assertAssemblyRouteSeparation,
} from "../src/connector-assembly.js";
import { renderSchematicPacket } from "../src/sheets.js";

describe("connector assembly documentation", () => {
  it("rejects source identities selected twice through designation and UID aliases", async () => {
    const f = await connectorFixture();
    try {
      if (!f.result.ok) throw new Error(JSON.stringify(f.result.diagnostics));
      const ir = f.result.ir;
      for (const selection of [
        {
          devices: ["R1", ir.devices.find((d) => d.designation === "R1")!.uid],
        },
        {
          assemblies: [
            "W1",
            ir.relations.find((r) => r.designation === "W1")!.uid,
          ],
        },
      ])
        await expect(
          prepareConnectorAssemblyDrawing(ir, {
            format: "connector-assembly-view-request/0.1",
            ...selection,
          }),
        ).rejects.toThrow("repeat a source identity");
    } finally {
      await f.dispose();
    }
  });
  it("validates routes at emitted precision despite ELK floating-point residue", async () => {
    const fixture = await connectorFixture();
    const prototype = (BundledElk as unknown as { prototype: ELK }).prototype;
    const original = prototype.layout;
    const spy = vi
      .spyOn(prototype, "layout")
      .mockImplementationOnce(async function (this: ELK, graph: ElkNode) {
        const result = await original.call(this, graph);
        const section = result.edges![0]!.sections![0]!;
        // Real ELK output has yielded y=93.2 beside y=93.19999999999999.
        // This is below the SVG's 0.001 mm output resolution, not a diagonal wire.
        section.startPoint.y += 1e-12;
        return result;
      });
    try {
      if (!fixture.result.ok)
        throw new Error(JSON.stringify(fixture.result.diagnostics));
      const drawing = await prepareConnectorAssemblyDrawing(fixture.result.ir, {
        format: "connector-assembly-view-request/0.1",
        assemblies: ["W1"],
      });
      expect(drawing.content).toContain("data-connector-assembly");
      expect(spy).toHaveBeenCalledOnce();
    } finally {
      spy.mockRestore();
      await fixture.dispose();
    }
  });
  it("rejects shared assembly route segments while permitting non-junction crossings", () => {
    expect(() =>
      assertAssemblyRouteSeparation([
        { a: { x: 0, y: 2 }, b: { x: 10, y: 2 }, edge: 0 },
        { a: { x: 5, y: 2 }, b: { x: 15, y: 2 }, edge: 1 },
      ]),
    ).toThrow("share a drawn segment");
    expect(() =>
      assertAssemblyRouteSeparation([
        { a: { x: 0, y: 2 }, b: { x: 10, y: 2 }, edge: 0 },
        { a: { x: 5, y: 0 }, b: { x: 5, y: 10 }, edge: 1 },
      ]),
    ).not.toThrow();
  });
  it("preserves disconnected selected devices and their unoccupied ports", async () => {
    const f = await connectorFixture((_t, objects) => {
      objects.splice(5);
    });
    try {
      if (!f.result.ok) throw new Error(JSON.stringify(f.result.diagnostics));
      const drawing = await prepareConnectorAssemblyDrawing(f.result.ir, {
        format: "connector-assembly-view-request/0.1",
        devices: ["R1", "S1"],
      });
      const doc = parseHTML(drawing.content).document;
      expect(doc.querySelectorAll("[data-device-uid]")).toHaveLength(2);
      expect(doc.querySelectorAll("[data-connector-assembly]")).toHaveLength(0);
      expect(
        doc.querySelectorAll('[data-port-occupancy="unoccupied"]'),
      ).toHaveLength(5);
      expect(drawing.width).toBeGreaterThan(0);
      expect(drawing.height).toBeGreaterThan(0);
    } finally {
      await f.dispose();
    }
  });
  it("renders exact selected assemblies with source ports, cable specification and mapping status", async () => {
    const f = await connectorFixture();
    try {
      if (!f.result.ok) throw new Error(JSON.stringify(f.result.diagnostics));
      const ir = f.result.ir,
        before = JSON.stringify(ir);
      const request = {
        format: "connector-assembly-view-request/0.1" as const,
        assemblies: ["W1"],
      };
      const drawing = await prepareConnectorAssemblyDrawing(ir, request),
        doc = parseHTML(drawing.content).document;
      expect(doc.querySelectorAll("[data-connector-assembly]")).toHaveLength(1);
      const link = doc.querySelector("[data-connector-assembly]")!;
      expect(link.getAttribute("data-connector-assembly")).toBe(
        ir.relations.find((r) => r.designation === "W1")!.uid,
      );
      expect(
        JSON.parse(link.getAttribute("data-assembly-endpoints")!),
      ).toHaveLength(2);
      expect(drawing.content).toContain("M12 molded cordset");
      expect(drawing.content).toContain("Pin mapping: unresolved");
      expect(drawing.content).toContain("Status: documented");
      expect(drawing.content).toContain("hydraulic pressure");
      expect(drawing.content).not.toContain("data-circuit-conductor");
      expect(await prepareConnectorAssemblyDrawing(ir, request)).toEqual(
        drawing,
      );
      const packet = await renderSchematicPacket(ir, {
        format: "schematic-packet-request/0.1",
        page: { size: "tabloid", orientation: "landscape" },
        views: [request],
      });
      if (!packet.ok) throw new Error(packet.error.message);
      expect(packet.value.sheets[0]!.view).toMatchObject({
        kind: "connector-assembly",
      });
      expect(JSON.stringify(ir)).toBe(before);
    } finally {
      await f.dispose();
    }
  });
  it("shows declared unoccupied and outside-view ports without inferring spare status", async () => {
    const f = await connectorFixture();
    try {
      if (!f.result.ok) throw new Error(JSON.stringify(f.result.diagnostics));
      const drawing = await prepareConnectorAssemblyDrawing(f.result.ir, {
        format: "connector-assembly-view-request/0.1",
        devices: ["R1"],
        assemblies: ["W1"],
      });
      const doc = parseHTML(drawing.content).document;
      const rack = [...doc.querySelectorAll("[data-device-uid]")].find((n) =>
        n.textContent!.includes("Remote I/O rack"),
      )!;
      expect(
        rack
          .querySelector('[data-connector-port="X3"]')!
          .getAttribute("data-port-occupancy"),
      ).toBe("unoccupied");
      expect(
        rack
          .querySelector('[data-connector-port="X2"]')!
          .getAttribute("data-port-occupancy"),
      ).toBe("outside view");
      expect(rack.textContent).not.toContain("SPARE");
    } finally {
      await f.dispose();
    }
  });
  it("offers a separate schedule and query inspection preserving connector data", async () => {
    const f = await connectorFixture();
    try {
      if (!f.result.ok) throw new Error(JSON.stringify(f.result.diagnostics));
      const ir = f.result.ir;
      const i = buildConnectorAssemblyInventory(ir);
      expect(i.assemblies).toHaveLength(4);
      expect(
        i.ports.some((p) => p.key === "X3" && p.assemblyUid === null),
      ).toBe(true);
      expect(buildCommunicationInventory(ir).links).toHaveLength(0);
      const d = buildDocumentation(ir, {
        format: "documentation-view-request/0.1",
        kind: "assemblies",
      });
      expect(
        d.rows.find((r) => r.cells[0] === "W1")!.cells.join(" "),
      ).toContain("Reference drawing identifies");
      const q = createQueryEngine(ir);
      expect(
        JSON.stringify(q.inspect({ by: "designation", value: "W1" })),
      ).toContain("pinMapping");
      expect(
        JSON.stringify(q.inspect({ by: "designation", value: "S1" })),
      ).toContain("connectorPorts");
      i.ports[0]!.definition.connector = "changed";
      expect(JSON.stringify(ir)).not.toContain('"changed"');
    } finally {
      await f.dispose();
    }
  });
});
