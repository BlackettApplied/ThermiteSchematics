import { repeatRequest } from "./wire-column-search-fixture.js";
import { beforeAll, expect, it } from "vitest";
import {
  compileProject,
  type ElectricalIr,
  type CompiledProjectPresentation,
} from "@thermite/compiler";
import { buildDocumentation } from "@thermite/query";
import { documentationFixture } from "../../query/test/documentation-fixture.js";
import {
  paginatedReportCells,
  reportPageCount,
} from "../src/packet/report-layout.js";
import { reportCells, emitReportRow } from "../src/packet/report-cells.js";
import { normalizePaperPage } from "../src/packet/page.js";
import {
  WIRE_GRID_DIVISIONS,
  WIRE_SEARCH_CANDIDATES,
  type WireAllocationAttempt,
} from "../src/packet/wire-column-search.js";
import { renderSchematicPacket } from "../src/sheets.js";
import type { RenderedSheet } from "../src/packet/types.js";
import { parseSvg } from "./off-view-fixtures.js";

let ir: ElectricalIr,
  small: ElectricalIr,
  presentation: CompiledProjectPresentation | undefined;
beforeAll(async () => {
  const c = await compileProject("examples/machine-demo");
  if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
  ir = c.ir;
  presentation = c.presentation;
  small = await documentationFixture();
});
const report = (source = ir) =>
  buildDocumentation(
    source,
    { format: "documentation-view-request/0.1", kind: "wires" },
    {},
  );
function paper() {
  const p = normalizePaperPage({ size: "letter", orientation: "landscape" });
  if (!p.ok) throw Error(p.error.message);
  return p.value;
}
const fit = () => paginatedReportCells(ir, report(), 223.4, 132.9, paper(), 31);
const compact = (s: string | null) => s?.normalize("NFC").replace(/\s/gu, "");

function paintedInventory(sheets: RenderedSheet[]) {
  const expected = new Map(report().rows.map((row) => [row.key, row.cells]));
  const keys: string[] = [];
  for (const sheet of sheets) {
    const svg = parseSvg(sheet.svg);
    const header = svg.querySelector('[id$="-document-header"]');
    expect(header?.querySelectorAll(":scope > rect")).toHaveLength(7);
    for (const row of svg.querySelectorAll("[data-report-row]")) {
      const key = row.getAttribute("data-report-row");
      if (key === null) throw Error("Missing native row key");
      keys.push(key);
      expect(row.querySelectorAll(":scope > rect")).toHaveLength(7);
      const cells = expected.get(key);
      if (!cells) throw Error("Unexpected native row");
      for (let col = 1; col <= 7; col++) {
        const field = row.querySelector(`[data-report-column="${col}"]`);
        if (!field) throw Error("Missing painted field");
        expect(Number(field.getAttribute("data-cell-y"))).toBe(
          Number(
            row
              .querySelector('[data-report-column="1"]')
              ?.getAttribute("data-cell-y"),
          ),
        );
        if (col <= 5)
          expect(compact(field.textContent)).toBe(
            compact(cells[col - 1] ?? ""),
          );
        else
          expect(field.textContent?.trim()).toMatch(
            /^(?:\d{2,3}\.[A-Z]+\d+|not drawn)$/u,
          );
        expect(
          [...field.querySelectorAll("text")].every(
            (t) => t.getAttribute("font-size") === "2.6",
          ),
        ).toBe(true);
      }
    }
  }
  expect(keys).toEqual(report().rows.map((row) => row.key));
  expect(new Set(keys).size).toBe(61);
}

it.each(["left-to-right", "top-to-bottom"] as const)(
  "keeps the FITREG repeat machine packet at 41 sheets with six ordinary wire parts (%s)",
  async (flow) => {
    const r = await renderSchematicPacket(
      ir,
      repeatRequest(flow),
      presentation,
    );
    if (!r.ok) throw Error(JSON.stringify(r.error));
    expect(r.value.sheets).toHaveLength(43);
    const wires = r.value.sheets.filter(
      (s) => "kind" in s.view && s.view.kind === "wires",
    );
    expect(wires).toHaveLength(6);
    paintedInventory(wires);
  },
);

function order(a: WireAllocationAttempt, b: WireAllocationAttempt) {
  const primary =
    (a.pages ?? Infinity) - (b.pages ?? Infinity) ||
    (a.wrapLines ?? Infinity) - (b.wrapLines ?? Infinity);
  if (primary) return primary;
  for (const [i, width] of a.widths.entries()) {
    const other = b.widths[i];
    if (other === undefined) throw Error("Missing width");
    if (width !== other) return width - other;
  }
  return 0;
}
it("enumerates beyond the failed weighted probe and minimizes pages, wrap lines and vector order", () => {
  const measured = fit(),
    receipt = measured.allocationReceipt;
  if (!receipt) throw Error("Missing bounded enumeration receipt");
  expect(receipt.bounds).toEqual({
    divisions: WIRE_GRID_DIVISIONS,
    nativeColumns: 5,
    maxCandidates: WIRE_SEARCH_CANDIDATES,
  });
  expect(receipt.candidates).toHaveLength(1821);
  expect(receipt.candidates[0]?.pages).toBeNull();
  expect(receipt.candidates[0]?.prunedAtPage).toBe(7);
  expect(receipt.nativePages).toBe(6);
  expect(receipt.tier).toBe("b");
  const best = [...receipt.candidates]
    .filter((a) => a.pages !== null && a.pages <= 6)
    .sort(order)[0];
  if (!best || receipt.selected === null)
    throw Error("No selected legal candidate");
  expect(receipt.candidates[receipt.selected]).toEqual(best);
  expect(measured.widths).toEqual(best.widths);
  expect(reportPageCount(report(), measured, 223.4, 132.9, 31)).toBe(6);
  expect(measured.cellSize).toBe(2.6);
  for (const row of report().rows)
    expect(
      measured.geometry(measured.split(row.cells, "probe", row.key)).insets,
    ).toEqual([2, 2, 2, 2, 2, 2, 2]);
});

it("uses the independently painted stacked tier only when every enumerated real-column candidate would add pages", () => {
  const table = report(small),
    measured = paginatedReportCells(small, table, 130, 90, paper(), 31),
    receipt = measured.allocationReceipt;
  if (!receipt) throw Error("Missing fallback receipt");
  expect(receipt.tier).toBe("c");
  expect(receipt.selected).toBeNull();
  expect(receipt.nativePages).toBe(2);
  expect(receipt.candidates).toHaveLength(1821);
  expect(receipt.candidates.every((c) => c.pages === null || c.pages > 2)).toBe(
    true,
  );
  expect(receipt.candidates.some((c) => c.prunedAtPage === 3)).toBe(true);
  expect(measured.inlineLocations).toBe(true);
  expect(reportPageCount(table, measured, 130, 90, 31)).toBe(2);
  const cells = measured.split(table.columns, "header"),
    height = measured.geometry(cells, true).height;
  const svg = parseSvg(
    `<svg>${emitReportRow(cells, height, measured.widths, table.columns, 0, 0, measured.geometry, true, true).join("")}</svg>`,
  );
  expect(svg.querySelectorAll("rect")).toHaveLength(7);
  expect(measured.cellSize).toBe(
    reportCells(small, table, 130, paper()).cellSize,
  );
});

it("is deterministic without mutating native inputs or retaining state across allocations", () => {
  const before = JSON.stringify([ir, report()]),
    a = fit(),
    b = fit();
  expect(a.allocationReceipt).toEqual(b.allocationReceipt);
  expect(a.widths).toEqual(b.widths);
  expect(JSON.stringify([ir, report()])).toBe(before);
});
