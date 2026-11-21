import { beforeAll, describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { compileProject, type ElectricalIr } from "@thermite/compiler";
import {
  buildDocumentation,
  documentationCsv,
  REPORT_KINDS,
  type DocumentationRequest,
} from "../src/documentation.js";
import { resolveDeviceFilter } from "../src/device-filter.js";
let ir: ElectricalIr;
beforeAll(async () => {
  const c = await compileProject(resolve("examples/report-filtering"));
  if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
  expect(c.diagnostics.map((d) => d.code)).toEqual(Array(7).fill("W904"));
  ir = c.ir;
});
const report = (
  kind: DocumentationRequest["kind"],
  filter?: DocumentationRequest["filter"],
) =>
  buildDocumentation(ir, {
    format: "documentation-view-request/0.1",
    kind,
    ...(filter ? { filter } : {}),
  });
const id = (name: string) =>
  ir.devices.find((d) => d.designation === name)!.uid;
describe("explicit report selection", () => {
  it("intersects includes, applies exclusions and resolves exact source identities without mutating the IR", () => {
    const before = JSON.stringify(ir);
    const r = resolveDeviceFilter(ir, {
      devices: ["PLC1", id("PLC2"), "DOC1"],
      types: ["filter-fixture:controller", "filter-fixture:documentary"],
      locations: ["Main"],
      excludeTypes: ["filter-fixture:documentary"],
    });
    expect(r.deviceUids).toEqual([id("PLC1")]);
    expect(r.outsideDeviceUids).toHaveLength(ir.devices.length - 1);
    expect(
      resolveDeviceFilter(ir, { excludeLocations: ["Main", "Remote", "Field"] })
        .deviceUids,
    ).toEqual([id("UNLOC")]);
    expect(JSON.stringify(ir)).toBe(before);
  });
  it.each([
    null,
    [],
    {},
    { typo: ["PLC1"] },
    { devices: [] },
    { devices: ["PLC1", "PLC1"] },
    { devices: ["PLC1", 0] },
    { devices: [" "] },
    { devices: ["Missing"] },
    { types: ["Missing"] },
    { locations: ["main"] },
    { excludeDevices: ["Missing"] },
    { excludeTypes: ["Missing"] },
    { excludeLocations: ["Missing"] },
  ])("rejects invalid/unknown filter %j", (value) => {
    expect(() => resolveDeviceFilter(ir, value as any)).toThrow();
  });
  it("rejects duplicate aliases and ambiguous selectors", () => {
    expect(() =>
      resolveDeviceFilter(ir, { devices: ["PLC1", id("PLC1")] }),
    ).toThrow("different selectors");
    const ambiguous = structuredClone(ir);
    ambiguous.devices[1]!.designation = "PLC1";
    expect(() => resolveDeviceFilter(ambiguous, { devices: ["PLC1"] })).toThrow(
      "does not resolve uniquely",
    );
    expect(() =>
      buildDocumentation(ir, {
        format: "documentation-view-request/0.1",
        kind: "io",
        device: "PLC1",
        filter: { devices: ["PLC1"] },
      }),
    ).toThrow("either device or filter");
  });
  for (const kind of REPORT_KINDS)
    it(`records retained/omitted source row identities for ${kind}`, () => {
      const before = JSON.stringify(ir),
        full = report(kind),
        r = report(kind, { excludeTypes: ["filter-fixture:documentary"] });
      const retained = new Set(r.rows.map((row) => row.key));
      expect(r.selection!.totalRows).toBe(full.rows.length);
      expect(r.selection!.retainedRows).toBe(r.rows.length);
      expect(r.selection!.omittedRowKeys).toEqual(
        full.rows.filter((row) => !retained.has(row.key)).map((row) => row.key),
      );
      expect(r.title).toContain("(filtered)");
      expect(r.notes.join(" ")).toContain("Filtered report:");
      for (const row of r.rows)
        expect(full.rows.some((original) => original.key === row.key)).toBe(
          true,
        );
      expect(report(kind)).toEqual(full);
      expect(full.selection).toBeUndefined();
      expect(JSON.stringify(ir)).toBe(before);
    });
  it("selects terminal and I/O owners rather than devices merely listed as peers", () => {
    const t = report("terminals", { devices: ["TB1"] });
    expect(t.rows.map((r) => r.cells[2])).toEqual(["2", "1"]);
    expect(t.rows.every((r) => r.cells[0] === "TB1")).toBe(true);
    expect(t.rows.map((r) => r.cells.join(" ")).join(" ")).toContain("S1.P");
    const field = report("terminals", { devices: ["S1"] });
    expect(field.rows.map((r) => r.cells[2])).toEqual(["M", "P"]);
    expect(report("io", { devices: ["PLC1"] }).rows).toEqual(
      report("io").rows.filter((r) => r.cells[0] === "PLC1"),
    );
    expect(report("io", { devices: ["TB1"] }).rows).toEqual([]);
    expect(report("io-ports", { devices: ["S1"] }).rows).toEqual([]);
    const sockets = report("io-ports", { devices: ["PLC1"] });
    expect(sockets.rows).toEqual(
      report("io-ports").rows.filter((r) => r.cells[0]!.startsWith("PLC1")),
    );
    expect(sockets.selection!.boundaryDeviceUids).toContain(id("S1"));
  });
  it("retains complete incident links and boundary details even when the peer is excluded", () => {
    const filter = { devices: ["PLC1"], excludeDevices: ["DOC1", "S1"] };
    for (const kind of ["network", "assemblies"] as const) {
      const full = report(kind),
        r = report(kind, filter);
      const link = r.rows.find(
        (row) => row.cells[0] === (kind === "network" ? "NET1" : "ASM1"),
      )!;
      expect(link).toEqual(full.rows.find((row) => row.key === link.key));
      expect(r.selection!.boundaryDeviceUids).toContain(
        id(kind === "network" ? "DOC1" : "S1"),
      );
      expect(
        r.rows.some(
          (row) => row.cells[0] === (kind === "network" ? "NET2" : "ASM2"),
        ),
      ).toBe(false);
      expect(
        r.rows
          .filter((row) => row.cells[0] === "--")
          .every((row) => row.deviceUids[0] === id("PLC1")),
      ).toBe(true);
    }
  });
  it("keeps all cores/counts of retained cables, plus endpoint-free records with explicit metadata", () => {
    const cables = report("cables", { devices: ["PLC1"] });
    expect(cables.rows.map((r) => r.cells[0])).toEqual(["CBL1", "LOOSE"]);
    expect(cables.rows).toEqual(
      report("cables").rows.filter((r) => r.cells[0] !== "CBL2"),
    );
    expect(cables.selection!.unscopedRowKeys).toEqual([
      ir.cables.find((c) => c.designation === "LOOSE")!.uid,
    ]);
    const wires = report("wires", { devices: ["PLC1"] });
    expect(wires.rows.map((r) => r.cells[0])).toEqual([
      "W1",
      "CBL1/1",
      "CBL1/2",
      "LOOSE/1",
      "LOOSE/2",
    ]);
    for (const row of wires.rows)
      expect(row).toEqual(report("wires").rows.find((r) => r.key === row.key));
    expect(wires.selection!.unscopedRowKeys).toHaveLength(3);
  });
  it("recomputes BOM quantities within partially retained groups and preserves whole cable records", () => {
    const full = report("bom"),
      r = report("bom", { devices: ["S1"] });
    const group = r.rows.find(
      (row) =>
        row.deviceUids.includes(id("S1")) &&
        row.cells[0] === "1" &&
        row.cells[1] === "S1",
    )!;
    expect(
      full.rows.find((row) => row.key === group.key)!.cells.slice(0, 2),
    ).toEqual(["2", "S1, S2"]);
    expect(group.deviceUids).toEqual([id("S1")]);
    expect(r.rows.some((row) => row.cells[1] === "CBL1")).toBe(true);
    expect(r.rows.some((row) => row.cells[1] === "CBL2")).toBe(false);
    expect(r.rows.some((row) => row.cells[1] === "ASM1")).toBe(true);
    expect(r.rows.some((row) => row.cells[1] === "LOOSE")).toBe(true);
    expect(r.notes.join(" ")).toContain(
      "quantities count selected device instances",
    );
    expect(documentationCsv(r)).toContain('"S1"');
    expect(documentationCsv(r)).not.toContain('"S1, S2"');
  });
  it("reports intentional empty selections without falling back to the full report", () => {
    const r = report("io", { devices: ["PLC1"], excludeDevices: ["PLC1"] });
    expect(r.rows).toEqual([]);
    expect(r.selection!.deviceUids).toEqual([]);
    expect(r.selection!.omittedRowKeys).toHaveLength(2);
    const c = report("cables", { devices: ["PLC1"], excludeDevices: ["PLC1"] });
    expect(c.rows.map((row) => row.cells[0])).toEqual(["LOOSE"]);
  });
});
