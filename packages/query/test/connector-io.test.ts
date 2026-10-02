import { describe, it, expect } from "vitest";
import { connectorIoFixture } from "../../compiler/test/connector-io-fixture.js";
import {
  buildDocumentation,
  documentationCsv,
  createQueryEngine,
  createProjectSnapshot,
  reviewProject,
} from "../src/index.js";

describe("connector I/O schedules", () => {
  it("conserves every module socket, includes immediate assembly peers and keeps terminal channels separate", async () => {
    const f = await connectorIoFixture();
    try {
      if (!f.result.ok) throw new Error(JSON.stringify(f.result.diagnostics));
      const ir = f.result.ir,
        before = JSON.stringify(ir);
      const request = {
        format: "documentation-view-request/0.1" as const,
        kind: "io-ports" as const,
      };
      const table = buildDocumentation(ir, request);
      expect(table.rows.map((r) => r.cells[1].split("\n")[0])).toEqual([
        "X1",
        "X2",
        "X3",
        "X4",
      ]);
      const [sensor, cap, empty, splitter] = table.rows;
      expect(sensor!.cells[5]).toContain("S1.M12");
      expect(sensor!.cells[6]).toContain("unresolved");
      expect(cap!.cells[5]).toContain("CAP1.P");
      expect(cap!.cells[4]).toBe("Unspecified\nUsage: Unspecified");
      expect(cap!.cells[6]).toContain("not-applicable");
      expect(empty!.cells[5]).toBe("Unoccupied");
      expect(empty!.cells[4]).toContain("Usage: spare");
      expect(empty!.cells[7]).toContain("Reserved socket.");
      expect(splitter!.cells[5]).toContain("Y1.IN");
      expect(splitter!.cells[5]).not.toContain("S2");
      expect(
        table.rows.every((r) => r.cells.length === table.columns.length),
      ).toBe(true);
      expect(table.widths.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
      expect(buildDocumentation(ir, request)).toEqual(table);
      const rack = ir.devices.find((d) => d.designation === "R1")!;
      expect(buildDocumentation(ir, { ...request, device: rack.uid })).toEqual({
        ...table,
        title: "R1 connector I/O plan",
      });
      expect(
        buildDocumentation(ir, { ...request, device: "PLC1" }).rows,
      ).toHaveLength(0);
      expect(() =>
        buildDocumentation(ir, { ...request, device: "Missing" }),
      ).toThrow("does not resolve uniquely");
      const channels = buildDocumentation(ir, { ...request, kind: "io" });
      expect(channels.rows).toHaveLength(1);
      expect(channels.rows[0]!.cells.slice(0, 6)).toEqual([
        "PLC1",
        "di1",
        "input",
        "PLC1",
        "%I0.0",
        "Start",
      ]);
      const inspected = createQueryEngine(ir).inspect({
        by: "designation",
        value: "R1",
      });
      expect(JSON.stringify(inspected)).toContain('"connectorIo"');
      const previous = createProjectSnapshot(ir),
        changed = structuredClone(ir);
      changed.devices.find(
        (d) => d.designation === "R1",
      )!.connectorIo!.ports.X1!.signal = "Edited pressure";
      expect(
        reviewProject(previous, createProjectSnapshot(changed)).changes.some(
          (c) => c.kind === "device" && c.label === "R1",
        ),
      ).toBe(true);
      expect(JSON.stringify(ir)).toBe(before);
    } finally {
      await f.dispose();
    }
  });

  it("lists all ports of an explicitly identified module with no assignments, including reversed direct connections", async () => {
    const f = await connectorIoFixture((_types, objects) => {
      const rack = objects.find((o) => o.designation === "R1")!;
      if (rack.kind !== "device") throw new Error("fixture");
      rack.connectorIo = { ports: {} };
      const relation = objects.find((o) => o.designation === "W1")!;
      if (relation.kind !== "relation") throw new Error("fixture");
      [relation.from, relation.to] = [relation.to, relation.from];
      [relation.assembly!.fromPort, relation.assembly!.toPort] = [
        relation.assembly!.toPort,
        relation.assembly!.fromPort,
      ];
      relation.assembly!.kind = "direct";
      delete relation.assembly!.cable;
    });
    try {
      if (!f.result.ok) throw new Error(JSON.stringify(f.result.diagnostics));
      const table = buildDocumentation(f.result.ir, {
        format: "documentation-view-request/0.1",
        kind: "io-ports",
      });
      expect(table.rows).toHaveLength(4);
      expect(table.rows[0]!.cells[5]).toContain(
        "W1 (direct; documented)\nS1.M12",
      );
      expect(
        table.rows.every(
          (r) =>
            r.cells[2] === "Unspecified" &&
            r.cells[3] === "Unspecified\nUnassigned",
        ),
      ).toBe(true);
    } finally {
      await f.dispose();
    }
  });

  it("quotes and neutralizes spreadsheet formulas in port-level CSV", async () => {
    const f = await connectorIoFixture((_t, objects) => {
      const rack = objects.find((o) => o.designation === "R1")!;
      if (rack.kind === "device")
        rack.connectorIo!.ports.X1!.signal = '=HYPERLINK("example")';
    });
    try {
      if (!f.result.ok) throw new Error(JSON.stringify(f.result.diagnostics));
      const csv = documentationCsv(
        buildDocumentation(f.result.ir, {
          format: "documentation-view-request/0.1",
          kind: "io-ports",
        }),
      );
      expect(csv).toContain('"\'=HYPERLINK(""example"")');
    } finally {
      await f.dispose();
    }
  });
});
