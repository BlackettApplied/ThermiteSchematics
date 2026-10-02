import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import BundledElk from "elkjs/lib/elk.bundled.js";
import type { ELK, ElkNode } from "elkjs/lib/elk-api.js";
import { parseHTML } from "linkedom";
import { compileProject, type ElectricalIr } from "@thermite/compiler";
import {
  prepareConnectorAssemblyDrawing,
  type ConnectorAssemblyViewRequest,
} from "../src/connector-assembly.js";
import { renderSchematicPacket } from "../src/sheets.js";

let ir: ElectricalIr;
let view: ConnectorAssemblyViewRequest;
beforeAll(async () => {
  const directory = resolve("examples/cap-pagination");
  const compiled = await compileProject(directory);
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
  expect(compiled.diagnostics.map((d) => d.code)).toEqual([
    "W904",
    "W904",
    "W904",
  ]);
  ir = compiled.ir;
  view = JSON.parse(await readFile(resolve(directory, "packet.json"), "utf8"))
    .views[0];
});

describe("protective-cap packet pagination", () => {
  it.each(["tabloid", "a3", "a4", "letter"] as const)(
    "conserves every selected cap, port and body at readable size on %s",
    async (size) => {
      const before = JSON.stringify(ir);
      const original = await prepareConnectorAssemblyDrawing(ir, view);
      const request = {
        format: "schematic-packet-request/0.1" as const,
        page: { size, orientation: "landscape" as const },
        layout: "compact" as const,
        index: true,
        views: [view],
      };
      const result = await renderSchematicPacket(ir, request);
      if (!result.ok) throw new Error(result.error.message);
      const packet = result.value;
      const drawings = packet.sheets.filter(
        (s) => s.view.kind === "connector-assembly",
      );
      expect(drawings.length).toBeGreaterThan(1);
      const t = packet.coverage.topology;
      expect(t.counts.assemblies).toEqual({
        total: 9,
        represented: 8,
        outsideAuditedViews: 1,
      });
      expect(t.counts.connectorPorts).toEqual({
        total: 23,
        represented: 22,
        outsideAuditedViews: 1,
      });
      expect(t.counts.devices).toEqual({
        total: 11,
        represented: 10,
        outsideAuditedViews: 1,
      });
      expect(
        t.assemblies
          .filter((r) => r.appearances.length)
          .map((r) => r.id)
          .sort(),
      ).toEqual([...original.topologyCoverage!.relationIds].sort());
      expect(packet.coverage.counts.conductors.represented).toBe(0);
      const docs = drawings.map((s) => parseHTML(s.svg).document);
      const elements = docs.flatMap((d) => [
        ...d.querySelectorAll("[data-connector-assembly]"),
      ]);
      expect(elements).toHaveLength(8);
      for (const relation of t.assemblies.filter((r) => r.appearances.length)) {
        expect(relation.appearances).toHaveLength(1);
        const element = elements.filter(
          (e) => e.getAttribute("data-connector-assembly") === relation.id,
        );
        expect(element).toHaveLength(1);
        expect(
          JSON.parse(element[0]!.getAttribute("data-assembly-endpoints")!),
        ).toEqual(relation.endpoints);
        expect(element[0]!.getAttribute("data-pin-mapping")).toBe(
          "not-applicable",
        );
        expect(element[0]!.querySelector("title")!.textContent).toBe(
          relation.assembly.pinMapping.reason,
        );
      }
      for (const port of t.connectorPorts.filter((p) => p.appearances.length)) {
        expect(port.appearances).toHaveLength(1);
        const sheet = packet.sheets[port.appearances[0]!.sheet - 1]!;
        const document = parseHTML(sheet.svg).document;
        const owners = [
          ...document.querySelectorAll("[data-device-uid]"),
        ].filter((e) => e.getAttribute("data-device-uid") === port.deviceUid);
        expect(
          owners
            .flatMap((e) => [...e.querySelectorAll("[data-connector-port]")])
            .filter(
              (e) => e.getAttribute("data-connector-port") === port.portKey,
            ),
        ).toHaveLength(1);
      }
      expect(
        t.connectorPorts.find((p) => p.designation === "R1.X09")!
          .appearances[0]!.state,
      ).toBe("outside-view");
      expect(
        t.connectorPorts.find((p) => p.designation === "R1.X12")!
          .appearances[0]!.state,
      ).toBe("unoccupied");
      expect(
        t.connectorPorts.find((p) => p.designation === "D1.A")!.appearances[0]!
          .state,
      ).toBe("unoccupied");
      expect(
        t.devices.find((d) => d.designation === "R1")!.appearances.length,
      ).toBeGreaterThan(1);
      for (const document of docs) {
        expect(document.documentElement.textContent).toContain("Part ");
        for (const owner of document.querySelectorAll("[data-device-uid]")) {
          const total = original.topologyCoverage!.ports.filter(
            (p) => p.deviceUid === owner.getAttribute("data-device-uid"),
          ).length;
          if (owner.querySelectorAll("[data-connector-port]").length < total)
            expect(owner.textContent).toContain("ports on other parts");
        }
        for (const e of document.querySelectorAll(
          "[data-device-uid] text, [data-assembly-label] text",
        )) {
          let scale = 1;
          for (
            let owner = e.parentElement;
            owner;
            owner = owner.parentElement
          ) {
            const match = owner
              .getAttribute("transform")
              ?.match(/scale\(([\d.]+)\)/);
            if (match) scale *= Number(match[1]);
          }
          expect(
            Number(e.getAttribute("font-size")) * scale,
          ).toBeGreaterThanOrEqual(2.5);
        }
      }
      const notes = docs
        .flatMap((d) => [...d.querySelectorAll("text")])
        .filter((e) => e.textContent === view.notes![0]);
      expect(notes).toHaveLength(1);
      expect(t.unauditedSheets).toEqual(
        packet.sheets
          .filter((s) => s.view.kind !== "connector-assembly")
          .map((s) => s.number),
      );
      expect(await renderSchematicPacket(ir, request)).toEqual(result);
      expect(JSON.stringify(ir)).toBe(before);
      expect(ir.nets).toHaveLength(0);
    },
  );

  it("keeps fitting view geometry and exact-selector port summaries unchanged", async () => {
    const request: ConnectorAssemblyViewRequest = {
      format: "connector-assembly-view-request/0.1",
      assemblies: ["CAP-X01"],
    };
    const original = await prepareConnectorAssemblyDrawing(ir, request);
    const result = await renderSchematicPacket(ir, {
      format: "schematic-packet-request/0.1",
      views: [request],
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.sheets).toHaveLength(1);
    expect(result.value.sheets[0]!.svg).toContain(original.content);
    expect(result.value.sheets[0]!.view.title).not.toContain("Part ");
    expect(result.value.sheets[0]!.svg).toContain("11 other ports: schedule");
    expect(
      result.value.coverage.topology.counts.connectorPorts.represented,
    ).toBe(2);
  });

  it("does not partition a mixed cable/cap selection", async () => {
    const result = await renderSchematicPacket(ir, {
      format: "schematic-packet-request/0.1",
      views: [{ ...view, assemblies: undefined }],
    });
    expect(result).toMatchObject({ ok: false, error: { code: "R006" } });
    expect(result).not.toHaveProperty("value");
  });

  it("fails when a complete unit and the authored notes cannot fit", async () => {
    const result = await renderSchematicPacket(ir, {
      format: "schematic-packet-request/0.1",
      page: { size: "a4", orientation: "landscape" },
      views: [
        {
          ...view,
          notes: Array.from(
            { length: 12 },
            (_, i) => `${i}: ${"Detail text ".repeat(32)}`,
          ),
        },
      ],
    });
    expect(result).toMatchObject({ ok: false, error: { code: "R006" } });
    if (!result.ok)
      expect(result.error.message).toContain("cannot fit at readable size");
    expect(result).not.toHaveProperty("value");
  });

  it.each(["missing edge", "detached endpoint"])(
    "does not hide invalid ELK output by retrying smaller parts: %s",
    async (scenario) => {
      const prototype = (BundledElk as unknown as { prototype: ELK }).prototype;
      const original = prototype.layout;
      const spy = vi
        .spyOn(prototype, "layout")
        .mockImplementationOnce(async function (this: ELK, graph: ElkNode) {
          const result = await original.call(this, graph);
          if (scenario === "missing edge") result.edges!.pop();
          else result.edges![0]!.sections![0]!.startPoint.x += 2;
          return result;
        });
      try {
        const result = await renderSchematicPacket(ir, {
          format: "schematic-packet-request/0.1",
          views: [view],
        });
        expect(result).toMatchObject({ ok: false, error: { code: "R006" } });
        expect(result).not.toHaveProperty("value");
        expect(spy).toHaveBeenCalledOnce();
      } finally {
        spy.mockRestore();
      }
    },
  );
});
