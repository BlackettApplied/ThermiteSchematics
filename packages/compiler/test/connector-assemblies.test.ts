import { describe, it, expect } from "vitest";
import { connectorFixture } from "./connector-fixture.js";
import { analyzeCompleteness, serializeIr } from "../src/index.js";
import type { Relation } from "@thermite/schema";

describe("connector assemblies", () => {
  it("preserves assembly identity and pin tables without joining electrical nets or satisfying required terminals", async () => {
    const f = await connectorFixture();
    try {
      expect(f.result.ok).toBe(true);
      if (!f.result.ok) throw new Error(JSON.stringify(f.result.diagnostics));
      const ir = f.result.ir;
      expect(ir.relations.filter((r) => r.assembly)).toHaveLength(4);
      expect(ir.wires).toHaveLength(0);
      expect(ir.cableConductors).toHaveLength(0);
      expect(ir.nets).toHaveLength(ir.terminals.length);
      expect(
        ir.deviceTypes.find((t) => t.id === "connector-fixture:sensor")!
          .connectorPorts!.M12!.pins!["5"]!.terminal,
      ).toBe("M");
      expect(serializeIr(ir)).toContain('"pinMapping"');
      const r = analyzeCompleteness(ir),
        rack = r.devices.find((d) => d.designation === "R1")!;
      expect(
        rack.connections.find(
          (c) => c.kind === "connector-port" && c.key === "X1",
        ),
      ).toMatchObject({ connection: "connected", pinMapping: "unresolved" });
      expect(
        rack.connections.find((c) => c.kind === "terminal" && c.key === "P"),
      ).toMatchObject({ connection: "unconnected", required: true });
      expect(rack.connections.find((c) => c.key === "X3")).toMatchObject({
        connection: "unconnected",
      });
      expect(f.result.diagnostics.some((d) => d.code === "W903")).toBe(true);
    } finally {
      await f.dispose();
    }
  });
  it.each([
    [
      "occupied",
      (_t: any[], o: any[]) => {
        o.find((x) => x.designation === "W2").assembly.fromPort = "X1";
      },
    ],
    [
      "undeclared",
      (_t: any[], o: any[]) => {
        o.find((x) => x.designation === "W1").assembly.fromPort = "constructor";
      },
    ],
    [
      "pin terminal",
      (t: any[]) => {
        t[1].connectorPorts.M12.pins["1"].terminal = "missing";
      },
    ],
    [
      "cap mapping",
      (_t: any[], o: any[]) => {
        o.find((x) => x.designation === "CAP-X2").assembly.pinMapping.status =
          "unresolved";
      },
    ],
    [
      "specification",
      (_t: any[], o: any[]) => {
        delete o.find((x) => x.designation === "W1").assembly.cable;
      },
    ],
    [
      "namespace",
      (t: any[]) => {
        t[0].ports = { X1: { medium: "ethernet", connector: "RJ45" } };
      },
    ],
  ])("rejects %s conflicts", async (_name, change) => {
    const f = await connectorFixture(change);
    try {
      expect(f.result.ok).toBe(false);
      expect(f.result.diagnostics.some((d) => d.code === "E207")).toBe(true);
    } finally {
      await f.dispose();
    }
  });
  it("rejects unknown connector review keys", async () => {
    const f = await connectorFixture((_t, o) => {
      const d = o.find((x) => x.designation === "R1")!;
      Object.assign(d, {
        connectionReview: {
          connectorPorts: { missing: { status: "deferred", reason: "Review" } },
        },
      });
    });
    try {
      expect(f.result.ok).toBe(false);
      expect(f.result.diagnostics.some((d) => d.code === "E205")).toBe(true);
    } finally {
      await f.dispose();
    }
  });
  it("rejects mixing communication with a connector assembly", async () => {
    const f = await connectorFixture((_t, o) => {
      const r = o.find((x) => x.designation === "W1") as Relation;
      r.connection = {
        fromPort: "X1",
        toPort: "M12",
        medium: "ethernet",
        protocol: "Ethernet",
      };
    });
    try {
      expect(f.result.ok).toBe(false);
    } finally {
      await f.dispose();
    }
  });
});
