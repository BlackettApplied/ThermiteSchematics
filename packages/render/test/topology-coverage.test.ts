import { describe, it, expect, vi } from "vitest";
import BundledElk from "elkjs/lib/elk.bundled.js";
import type { ELK, ElkNode } from "elkjs/lib/elk-api.js";
import { parseHTML } from "linkedom";
import { topologyFixture } from "./topology-fixture.js";
import { renderSchematicPacket } from "../src/sheets.js";
import { prepareConnectorAssemblyDrawing } from "../src/connector-assembly.js";
import { prepareCommunicationDrawing } from "../src/communication.js";
import {
  buildTopologyCoverage,
  type TopologyDrawingCoverage,
} from "../src/topology-coverage.js";

const assembly = {
  format: "connector-assembly-view-request/0.1" as const,
  assemblies: ["W1"],
};
const communication = {
  format: "communication-view-request/0.1" as const,
  medium: "ethernet" as const,
  devices: ["S1"],
};

describe("topology coverage", () => {
  it("inventories selected relations and individually drawn ports, preserving endpoints, caps, mappings and repeated appearances", async () => {
    const f = await topologyFixture();
    try {
      if (!f.result.ok) throw new Error(JSON.stringify(f.result.diagnostics));
      const ir = f.result.ir,
        before = JSON.stringify(ir);
      const request = {
        format: "schematic-packet-request/0.1" as const,
        page: { size: "tabloid" as const, orientation: "landscape" as const },
        views: [
          { ...assembly, devices: ["R1"] },
          { ...assembly, assemblies: ["CAP-X2"] },
          { ...assembly, assemblies: ["W2"] },
          { ...assembly, assemblies: ["W3"], devices: ["Y1"] },
          communication,
          communication,
          { ...communication, medium: "nrg-bus" as const, devices: undefined },
          { ...communication, devices: ["N3"] },
          {
            format: "documentation-view-request/0.1" as const,
            kind: "assemblies" as const,
          },
        ],
      };
      const result = await renderSchematicPacket(ir, request);
      if (!result.ok) throw new Error(result.error.message);
      const packet = result.value,
        t = packet.coverage.topology;
      expect(t.counts).toEqual({
        assemblies: { total: 4, represented: 4, outsideAuditedViews: 0 },
        communicationLinks: {
          total: 3,
          represented: 3,
          outsideAuditedViews: 0,
        },
        connectorPorts: { total: 11, represented: 10, outsideAuditedViews: 1 },
        communicationPorts: {
          total: 15,
          represented: 6,
          outsideAuditedViews: 9,
        },
        devices: { total: 6, represented: 6, outsideAuditedViews: 0 },
      });
      expect(packet.coverage.counts.conductors.represented).toBe(0);
      expect(packet.coverage.counts.functions.represented).toBe(0);
      expect(
        t.communicationLinks.find((l) => l.designation === "NET1")!.appearances,
      ).toHaveLength(2);
      expect(
        t.assemblies.find((a) => a.designation === "CAP-X2")!.assembly
          .pinMapping.status,
      ).toBe("not-applicable");
      expect(
        t.assemblies.find((a) => a.designation === "W1")!.assembly.pinMapping
          .reason,
      ).toContain("omits conductor mapping");
      expect(
        t.connectorPorts
          .find((p) => p.designation === "R1.X2")!
          .appearances.some((a) => a.state === "outside-view"),
      ).toBe(true);
      expect(
        t.connectorPorts.find((p) => p.designation === "Y1.B")!.appearances[0]!
          .state,
      ).toBe("unoccupied");
      expect(
        t.connectorPorts.find((p) => p.designation === "N3.M12")!.appearances,
      ).toEqual([]);
      expect(t.unauditedSheets).toEqual(
        packet.sheets
          .filter((s) => s.view.kind === "assemblies")
          .map((s) => s.number),
      );
      for (const [entries, attribute, endpoints] of [
        [t.assemblies, "data-connector-assembly", "data-assembly-endpoints"],
        [
          t.communicationLinks,
          "data-communication-link",
          "data-communication-endpoints",
        ],
      ] as const)
        for (const entry of entries)
          for (const appearance of entry.appearances) {
            const doc = parseHTML(
              packet.sheets[appearance.sheet - 1]!.svg,
            ).document;
            const elements = [...doc.querySelectorAll(`[${attribute}]`)].filter(
              (e) => e.getAttribute(attribute) === entry.id,
            );
            expect(elements).toHaveLength(1);
            expect(JSON.parse(elements[0]!.getAttribute(endpoints)!)).toEqual(
              entry.endpoints,
            );
          }
      for (const [ports, attr] of [
        [t.connectorPorts, "data-connector-port"],
        [t.communicationPorts, "data-communication-port"],
      ] as const)
        for (const port of ports)
          for (const appearance of port.appearances) {
            const doc = parseHTML(
              packet.sheets[appearance.sheet - 1]!.svg,
            ).document;
            const node = [...doc.querySelectorAll("[data-device-uid]")].find(
              (e) => e.getAttribute("data-device-uid") === port.deviceUid,
            )!;
            expect(
              [...node.querySelectorAll(`[${attr}]`)].filter(
                (e) => e.getAttribute(attr) === port.portKey,
              ),
            ).toHaveLength(1);
          }
      expect(await renderSchematicPacket(ir, request)).toEqual(result);
      expect(JSON.stringify(ir)).toBe(before);
      expect(ir.nets.every((n) => n.terminalIds.length === 1)).toBe(true);
    } finally {
      await f.dispose();
    }
  });

  it("counts only named endpoint ports when other connectors are summarized, and excludes schedules from both audits", async () => {
    const f = await topologyFixture();
    try {
      if (!f.result.ok) throw new Error(JSON.stringify(f.result.diagnostics));
      const result = await renderSchematicPacket(f.result.ir, {
        format: "schematic-packet-request/0.1",
        views: [
          assembly,
          { format: "documentation-view-request/0.1", kind: "network" },
        ],
      });
      if (!result.ok) throw new Error(result.error.message);
      expect(result.value.coverage.topology.counts.assemblies).toEqual({
        total: 4,
        represented: 1,
        outsideAuditedViews: 3,
      });
      expect(
        result.value.coverage.topology.counts.connectorPorts.represented,
      ).toBe(2);
      expect(
        result.value.coverage.topology.counts.communicationLinks.represented,
      ).toBe(0);
      const report = await renderSchematicPacket(f.result.ir, {
        format: "schematic-packet-request/0.1",
        views: [{ format: "documentation-view-request/0.1", kind: "network" }],
      });
      if (!report.ok) throw new Error(report.error.message);
      expect(
        report.value.coverage.topology.counts.communicationLinks.represented,
      ).toBe(0);
      expect(report.value.coverage.topology.unauditedSheets).toEqual(
        report.value.sheets.map((s) => s.number),
      );
    } finally {
      await f.dispose();
    }
  });

  it("retains topology appearances when compact composition merges projections and appends indexes", async () => {
    const f = await topologyFixture();
    try {
      if (!f.result.ok) throw new Error(JSON.stringify(f.result.diagnostics));
      const result = await renderSchematicPacket(f.result.ir, {
        format: "schematic-packet-request/0.1",
        layout: "compact",
        index: true,
        views: [
          { ...communication, medium: "nrg-bus", devices: ["R1"] },
          { ...communication, medium: "nrg-bus", devices: ["R1"] },
        ],
      });
      if (!result.ok) throw new Error(result.error.message);
      const t = result.value.coverage.topology;
      expect(t.counts.communicationLinks).toEqual({
        total: 3,
        represented: 1,
        outsideAuditedViews: 2,
      });
      expect(t.counts.communicationPorts.represented).toBe(2);
      const r1 = t.devices.find((d) => d.designation === "R1")!;
      expect(r1.appearances).toHaveLength(2);
      expect(new Set(r1.appearances.map((a) => a.sheet)).size).toBe(1);
      expect(t.unauditedSheets.length).toBeGreaterThan(0);
    } finally {
      await f.dispose();
    }
  });

  it.each([
    "unknown relation",
    "duplicate relation",
    "missing endpoint",
    "unknown device",
    "wrong namespace",
  ])("rejects %s in drawing coverage", async (scenario) => {
    const f = await topologyFixture();
    try {
      if (!f.result.ok) throw new Error(JSON.stringify(f.result.diagnostics));
      const drawing = structuredClone(
        (await prepareConnectorAssemblyDrawing(f.result.ir, assembly))
          .topologyCoverage!,
      ) as {
        kind: TopologyDrawingCoverage["kind"];
        relationIds: string[];
        deviceUids: string[];
        ports: { deviceUid: string; portKey: string }[];
      };
      if (scenario === "unknown relation") drawing.relationIds = ["missing"];
      if (scenario === "duplicate relation")
        drawing.relationIds.push(drawing.relationIds[0]!);
      if (scenario === "missing endpoint") drawing.ports.pop();
      if (scenario === "unknown device") drawing.deviceUids.push("missing");
      if (scenario === "wrong namespace") drawing.kind = "communication";
      expect(() =>
        buildTopologyCoverage(f.result.ir, [
          { sheet: 1, view: "test", topologyDrawings: [drawing] },
        ]),
      ).toThrow("Topology coverage");
    } finally {
      await f.dispose();
    }
  });

  it.each(["connector-assembly", "communication"] as const)(
    "matches source IDs when %s output edges are reordered",
    async (kind) => {
      const f = await topologyFixture();
      const prototype = (BundledElk as unknown as { prototype: ELK }).prototype;
      const original = prototype.layout;
      let spy: ReturnType<typeof vi.spyOn> | undefined;
      try {
        if (!f.result.ok) throw new Error(JSON.stringify(f.result.diagnostics));
        const prepare = () =>
          kind === "communication"
            ? prepareCommunicationDrawing(f.result.ir, communication)
            : prepareConnectorAssemblyDrawing(f.result.ir, {
                ...assembly,
                assemblies: ["W1", "CAP-X2"],
              });
        const baseline = await prepare();
        spy = vi
          .spyOn(prototype, "layout")
          .mockImplementationOnce(async function (this: ELK, graph: ElkNode) {
            const result = await original.call(this, graph);
            result.edges!.reverse();
            return result;
          });
        const reordered = await prepare();
        const attribute =
          kind === "communication"
            ? "data-communication-link"
            : "data-connector-assembly";
        const paths = (content: string) =>
          [...parseHTML(content).document.querySelectorAll(`[${attribute}]`)]
            .map((element) => ({
              id: element.getAttribute(attribute),
              path: element.querySelector("path")!.getAttribute("d"),
            }))
            .sort((a, b) => (a.id! < b.id! ? -1 : 1));
        expect(paths(reordered.content)).toEqual(paths(baseline.content));
        expect(reordered.topologyCoverage).toEqual(baseline.topologyCoverage);
        expect(spy).toHaveBeenCalledOnce();
      } finally {
        spy?.mockRestore();
        await f.dispose();
      }
    },
  );

  it.each(["connector-assembly", "communication"] as const)(
    "fails closed on lost or reassigned %s layout elements",
    async (kind) => {
      for (const scenario of [
        "missing edge",
        "duplicate edge",
        "missing device",
        "missing port",
        "changed endpoint",
        "detached route",
        "moved fixed port",
        "resized device",
      ]) {
        const f = await topologyFixture();
        const prototype = (BundledElk as unknown as { prototype: ELK })
            .prototype,
          original = prototype.layout;
        const spy = vi
          .spyOn(prototype, "layout")
          .mockImplementationOnce(async function (this: ELK, graph: ElkNode) {
            const result = await original.call(this, graph);
            if (scenario === "missing edge") result.edges!.pop();
            if (scenario === "duplicate edge")
              result.edges![1] = structuredClone(result.edges![0]!);
            if (scenario === "missing device") result.children!.pop();
            if (scenario === "missing port")
              result.children!.find((n) => n.ports!.length)!.ports!.pop();
            if (scenario === "changed endpoint")
              result.edges![0]!.sources = [result.edges![1]!.sources[0]!];
            if (scenario === "moved fixed port")
              result.children!.find((n) => n.ports!.length)!.ports![0]!.y! += 1;
            if (scenario === "resized device") result.children![0]!.width! += 1;
            if (scenario === "detached route")
              for (const section of result.edges![0]!.sections!)
                for (const p of [
                  section.startPoint,
                  ...(section.bendPoints ?? []),
                  section.endPoint,
                ])
                  p.y += 0.02;
            return result;
          });
        try {
          if (!f.result.ok)
            throw new Error(JSON.stringify(f.result.diagnostics));
          const result = await renderSchematicPacket(f.result.ir, {
            format: "schematic-packet-request/0.1",
            views: [
              kind === "communication"
                ? communication
                : { ...assembly, assemblies: ["W1", "CAP-X2"] },
            ],
          });
          expect(result, scenario).toMatchObject({
            ok: false,
            error: { code: "R006" },
          });
        } finally {
          spy.mockRestore();
          await f.dispose();
        }
      }
    },
  );
});
