import { describe, it, expect } from "vitest";
import type { Device } from "@thermite/schema";
import { connectorIoFixture } from "./connector-io-fixture.js";
import { resolve } from "node:path";
import { compileProject, serializeIr } from "../src/index.js";

describe("connector I/O validation", () => {
  it("compiles the shareable locked example without adding electrical continuity", async () => {
    const result = await compileProject(resolve("examples/connector-io"));
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.ir.relations.filter((r) => r.assembly)).toHaveLength(4);
    expect(result.ir.nets).toHaveLength(5);
    expect(result.diagnostics.map((d) => d.code).sort()).toEqual([
      "W903",
      "W903",
      "W904",
      "W904",
      "W904",
    ]);
  });
  it("preserves socket assignments and accepts unknown address spaces when no addresses are assigned", async () => {
    const f = await connectorIoFixture((_types, objects) => {
      const rack = objects.find((o) => o.designation === "R1") as Device;
      rack.connectorIo = { ports: {} };
    });
    try {
      if (!f.result.ok) throw new Error(JSON.stringify(f.result.diagnostics));
      expect(
        f.result.ir.devices.find((d) => d.designation === "R1")!.connectorIo,
      ).toEqual({ ports: {} });
      expect(serializeIr(f.result.ir)).toContain('"connectorIo"');
      expect(f.result.ir.wires).toHaveLength(0);
      expect(f.result.ir.nets.every((n) => n.terminalIds.length === 1)).toBe(
        true,
      );
    } finally {
      await f.dispose();
    }
  });

  it.each([
    "unknown port",
    "prototype key",
    "missing address space",
    "duplicate port address",
    "duplicate channel address",
    "no connector ports",
  ])("rejects %s with E202", async (scenario) => {
    const f = await connectorIoFixture((types, objects) => {
      const rack = objects.find((o) => o.designation === "R1") as Device;
      const io = rack.connectorIo!;
      if (scenario === "unknown port") io.ports.MISSING = {};
      if (scenario === "prototype key") io.ports.constructor = {};
      if (scenario === "missing address space") delete io.addressSpace;
      if (scenario === "duplicate port address")
        io.ports.X4 = { address: "%iw64" };
      if (scenario === "duplicate channel address")
        io.ports.X4 = { address: "%i0.0" };
      if (scenario === "no connector ports") delete types[0]!.connectorPorts;
    });
    try {
      expect(f.result.ok).toBe(false);
      expect(f.result.diagnostics.some((d) => d.code === "E202")).toBe(true);
      expect(
        f.result.diagnostics
          .filter((d) => d.code === "E202")
          .every((d) => d.related?.length),
      ).toBe(true);
    } finally {
      await f.dispose();
    }
  });

  it("keeps address spaces case-sensitive and does not infer byte overlap", async () => {
    const f = await connectorIoFixture((_types, objects) => {
      const rack = objects.find((o) => o.designation === "R1") as Device;
      rack.connectorIo!.addressSpace = "plc1";
      rack.connectorIo!.ports.X4 = { address: "%I0.0" };
      rack.connectorIo!.ports.X2 = { address: "%IB64" };
    });
    try {
      expect(f.result.ok).toBe(true);
    } finally {
      await f.dispose();
    }
  });

  it.each(["direction", "channel mapping", "empty signal"])(
    "rejects invalid %s in the closed assignment schema",
    async (scenario) => {
      const f = await connectorIoFixture((_types, objects) => {
        const rack = objects.find((o) => o.designation === "R1") as Device;
        const assignment = rack.connectorIo!.ports.X1! as Record<
          string,
          unknown
        >;
        if (scenario === "direction") assignment.direction = "analog";
        if (scenario === "channel mapping") assignment.channel = "di1";
        if (scenario === "empty signal") assignment.signal = "";
      });
      try {
        expect(f.result.ok).toBe(false);
      } finally {
        await f.dispose();
      }
    },
  );
});
