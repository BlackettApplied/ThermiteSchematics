import { expect, it } from "vitest";
import { compileProject } from "@thermite/compiler";
import { buildDocumentation, REPORT_KINDS } from "../src/documentation.js";
import { documentationFixture } from "./documentation-fixture.js";

it("scopes absent terminal connections to their column without replacing known peers", async () => {
  const ir = await documentationFixture();
  const report = buildDocumentation(ir, {
    format: "documentation-view-request/0.1",
    kind: "terminals",
    device: "M1",
  });
  expect(report.rows.length).toBeGreaterThan(0);
  for (const row of report.rows) {
    expect(row.cells[4]).toBe("No same-location connections");
    expect(row.cells[5]).toContain(" -> ");
    expect(row.cells[5]).not.toContain("No connections");
  }
  const d = ir.devices.find((d) => d.designation === "M1")!;
  const disconnected = structuredClone(ir);
  disconnected.wires = disconnected.wires.filter(
    (w) => !w.endpoints.some((e) => e.terminal.deviceUid === d.uid),
  );
  disconnected.jumpers = [];
  disconnected.cables = [];
  disconnected.cableConductors = [];
  const absent = buildDocumentation(disconnected, {
    format: "documentation-view-request/0.1",
    kind: "terminals",
    device: "M1",
  });
  expect(
    absent.rows.every(
      (r) =>
        r.cells[4] === "No same-location connections" &&
        r.cells[5] === "No other / unspecified location connections",
    ),
  ).toBe(true);
});

it("preserves native statuses, protocols and pin-map reasons and changes only absent values", async () => {
  const compiled = await compileProject("examples/report-filtering");
  if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
  const ir = structuredClone(compiled.ir);
  for (const r of ir.relations) {
    const kind = r.connection
      ? "network"
      : r.assembly
        ? "assemblies"
        : undefined;
    if (!kind) continue;
    const native = r.connection ?? r.assembly!;
    native.status = "verified";
    if (r.connection)
      r.connection.protocol = "Vendor protocol (Unspecified is authored text)";
    if (r.assembly)
      r.assembly.pinMapping.reason =
        "Vendor pinout unspecified; None is a source word (null)";
    const report = () =>
      buildDocumentation(ir, {
        format: "documentation-view-request/0.1",
        kind,
      });
    const row = () => report().rows.find((row) => row.key === r.uid)!;
    expect(row().cells[4]).toBe(
      r.assembly
        ? `verified\nPin mapping: ${r.assembly.pinMapping.status}\n${r.assembly.pinMapping.reason}`
        : "verified",
    );
    if (r.connection) expect(row().cells[1]).toBe(r.connection.protocol);
    delete native.status;
    expect(row().cells[4]).toBe(
      r.assembly
        ? `Status not specified\nPin mapping: ${r.assembly.pinMapping.status}\n${r.assembly.pinMapping.reason}`
        : "Status not specified",
    );
  }
  // Every kind uses this same source projection, including filtered automatic
  // inventories; no cell-wide replacement may erase authored literal text.
  for (const kind of REPORT_KINDS) {
    const table = buildDocumentation(ir, {
      format: "documentation-view-request/0.1",
      kind,
    });
    expect(
      table.rows.every((r) => r.cells.length === table.columns.length),
    ).toBe(true);
    expect(
      table.rows
        .flatMap((r) => r.cells)
        .some((s) => /^(None|Unspecified)$/u.test(s)),
    ).toBe(false);
  }
});
