import { beforeAll, expect, it } from "vitest";
import { buildDocumentation } from "@thermite/query";
import type { ElectricalIr } from "@thermite/compiler";
import { documentationFixture } from "../../query/test/documentation-fixture.js";
import { wireReportColumns } from "../src/packet/wire-report-columns.js";
import { reportColumns } from "../src/packet/report-column-widths.js";
import { reportCells, emitReportRow } from "../src/packet/report-cells.js";
import { measureText } from "../src/text-metrics.js";
import { paginatedReportCells } from "../src/packet/report-layout.js";
import { tableDrafts } from "../src/packet/reports.js";
import { normalizePaperPage } from "../src/packet/page.js";
import { parseSvg } from "./off-view-fixtures.js";

let ir: ElectricalIr;
beforeAll(async () => {
  ir = await documentationFixture();
});
const table = () =>
  buildDocumentation(
    ir,
    { format: "documentation-view-request/0.1", kind: "wires" },
    {},
  );
const native = () =>
  buildDocumentation(ir, {
    format: "documentation-view-request/0.1",
    kind: "wires",
  });

it("measures both locator columns including the unresolved phrase without a percentage reservation", () => {
  const report = table();
  const measured = reportCells(ir, report, 374);
  expect(measured.inlineLocations).toBe(false);
  expect(measured.cellSize).toBe(2.6);
  for (const column of [5, 6]) {
    const width =
      Math.max(
        measureText("not drawn", 2.6).width,
        ...report.columns[column]!.split(/\s+/u).map(
          (s) => measureText(s, 2.6).width,
        ),
        ...report.rows.map((row) => measureText(row.cells[column]!, 2.6).width),
      ) + 4.02;
    expect(measured.widths[column]).toBeCloseTo(width, 6);
    // Every possible packet locator is narrower than the reserved printed form.
    for (const token of ["01.A1", "99.D6", "100.D6"])
      expect(measureText(token, 2.6).width + 4).toBeLessThanOrEqual(
        measured.widths[column]!,
      );
  }
});
it("preserves native body/header line counts and the em while adding locator columns", () => {
  for (const width of [193.4, 243.4, 374]) {
    const original = native(),
      report = table();
    const before = reportCells(ir, original, width),
      after = reportCells(ir, report, width);
    expect(after.cellSize).toBe(before.cellSize);
    const headerBefore = before.split(original.columns, "header"),
      headerAfter = after.split(report.columns, "header");
    for (let column = 0; column < 5; column++)
      expect(headerAfter[column]!.length).toBeLessThanOrEqual(
        headerBefore[column]!.length,
      );
    for (const row of report.rows) {
      const b = before.split(row.cells.slice(0, 5), "row", row.key),
        a = after.split(row.cells, "row", row.key);
      for (let column = 0; column < 5; column++)
        expect(a[column]!.length).toBeLessThanOrEqual(b[column]!.length);
      expect(after.geometry(a).insets).toEqual([2, 2, 2, 2, 2, 2, 2]);
    }
  }
});
it("uses separate semantic location cells beneath their native endpoint on narrow paper", () => {
  const report = table();
  const measured = reportCells(ir, report, 193.4);
  expect(measured.inlineLocations).toBe(true);
  const cells = measured.split(
    report.rows[0]!.cells,
    "row",
    report.rows[0]!.key,
  );
  const height = measured.geometry(cells).height;
  const svg = parseSvg(
    `<svg><g data-report-row="test">${emitReportRow(cells, height, measured.widths, report.columns, 10, 20, measured.geometry, false, true).join("")}</g></svg>`,
  );
  const header = measured.split(report.columns, "header");
  const paintedHeader = parseSvg(
    `<svg>${emitReportRow(header, measured.geometry(header, true).height, measured.widths, report.columns, 10, 20, measured.geometry, true, true).join("")}</svg>`,
  );
  expect(paintedHeader.querySelectorAll("rect")).toHaveLength(7);
  const row = svg.querySelector("[data-report-row]")!;
  expect(svg.querySelectorAll("rect")).toHaveLength(7);
  for (const [endpoint, location] of [
    [2, 6],
    [3, 7],
  ]) {
    const a = row.querySelector(`[data-report-column="${endpoint}"]`)!,
      b = row.querySelector(`[data-report-column="${location}"]`)!;
    expect(b.getAttribute("data-cell-x")).toBe(a.getAttribute("data-cell-x"));
    expect(Number(b.querySelector("text")!.getAttribute("y"))).toBeGreaterThan(
      Number(a.querySelector("text")!.getAttribute("y")),
    );
    expect(b.textContent!.trim()).toBe("not drawn");
    expect(
      Number(b.querySelector("text")!.getAttribute("x")) -
        Number(b.getAttribute("data-cell-x")),
    ).toBeCloseTo(2, 2);
  }
});

it("retains tier a before considering any wrapping allocation", () => {
  const paper = normalizePaperPage({
    size: "tabloid",
    orientation: "landscape",
  });
  if (!paper.ok) throw Error("paper");
  expect(
    paginatedReportCells(ir, table(), 374, 240, paper.value).widths,
  ).toEqual(reportCells(ir, table(), 374, paper.value).widths);
});

it("prefers seven real columns when added native wraps do not add a page", () => {
  const paper = normalizePaperPage({
    size: "letter",
    orientation: "portrait",
    marginMm: 5,
  });
  if (!paper.ok) throw Error("paper");
  const rendered = tableDrafts(ir, table(), undefined, paper.value);
  if (!rendered.ok) throw Error(rendered.error.message);
  expect(rendered.value).toHaveLength(1);
  const svg = parseSvg(`<svg>${rendered.value[0]!.content}</svg>`);
  const row = svg.querySelector("[data-report-row]")!;
  expect(row.querySelectorAll(":scope > rect")).toHaveLength(7);
  expect(
    row.querySelector('[data-report-column="6"]')!.getAttribute("data-cell-y"),
  ).toBe(
    row.querySelector('[data-report-column="2"]')!.getAttribute("data-cell-y"),
  );
  expect(
    row.querySelector('[data-report-column="6"]')!.getAttribute("data-cell-x"),
  ).not.toBe(
    row.querySelector('[data-report-column="2"]')!.getAttribute("data-cell-x"),
  );
});

it("delivers complete native rows when locations share the endpoint columns", async () => {
  const { renderSchematicPacket } = await import("../src/sheets.js");
  const result = await renderSchematicPacket(ir, {
    format: "schematic-packet-request/0.1",
    page: { size: "letter", orientation: "portrait", marginMm: 5 },
    views: [{ format: "documentation-view-request/0.1", kind: "wires" }],
  });
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (!result.ok) throw Error(JSON.stringify(result.error));
  const nativeKeys = table()
    .rows.map((r) => r.key)
    .sort();
  const issuedKeys = result.value
    .navigation!.documents!.filter((d) => d.kind === "wires")
    .flatMap((d) => d.rows.map((r) => r.nativeKey))
    .sort();
  expect(issuedKeys).toEqual(nativeKeys);
});

it("restores 2 mm clearance without adding a legacy compact header wrap", () => {
  const report = table();
  const measured = reportCells(
    ir,
    { ...report, rows: report.rows.slice(0, 1) },
    223.4,
  );
  const header = measured.split(report.columns, "header");
  expect(header[0]).toEqual(["Conductor / label"]);
  expect(measured.geometry(header, true).insets).toEqual([2, 2, 2, 2, 2, 2, 2]);
});

it("refuses squeezed native fields instead of adding legacy body wraps", () => {
  const source = table();
  const legacy = reportColumns(
    {
      ...source,
      columns: source.columns.slice(0, 5),
      rows: [],
      widths: [0.15, 0.24, 0.24, 0.18, 0.19],
    },
    223.4,
    2.6,
    [],
    new Map(),
    [],
    1,
  );
  expect(legacy.error).toBe(false);
  // Fill each original compact cell to its one-line capacity. Restoring the
  // insets needs more width; a lossy allocation must not silently add wraps.
  const glyph = measureText("i", 2.6).width;
  const cells = legacy.widths.map((w) =>
    "i".repeat(Math.floor((w - 2.01) / glyph)),
  );
  const allocation = wireReportColumns(
    {
      ...source,
      rows: [
        {
          key: "synthetic",
          deviceUids: [],
          cells: [...cells, "not drawn", "not drawn"],
        },
      ],
    },
    223.4,
    2.6,
    [],
    new Map(),
  );
  expect(allocation.error).toBe(true);
});
