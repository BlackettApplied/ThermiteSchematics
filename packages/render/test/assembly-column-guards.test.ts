import { beforeAll, expect, it, vi } from "vitest";
import { compileProject, type ElectricalIr } from "@thermite/compiler";
import { buildDocumentation, type DocumentationTable } from "@thermite/query";
import * as cells from "../src/packet/report-cells.js";
import { denserAssemblyCells } from "../src/packet/report-assembly-columns.js";
import { normalizePaperPage } from "../src/packet/page.js";
import { ReportMeasurementError } from "../src/packet/report-measurement.js";

let ir: ElectricalIr, table: DocumentationTable;
beforeAll(async () => {
  const c = await compileProject("examples/cap-pagination");
  if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
  ir = c.ir;
  table = buildDocumentation(ir, {
    format: "documentation-view-request/0.1",
    kind: "assemblies",
  });
});
function fixture() {
  const p = normalizePaperPage({ size: "letter", orientation: "landscape" });
  if (!p.ok) throw Error("Missing page");
  return {
    page: p.value,
    baseline: cells.reportCells(ir, table, 223.4, p.value),
  };
}
it("retains the exact baseline when no allocation reduces pages, within ten attempts", () => {
  const f = fixture(),
    score = vi.fn(() => 1),
    measure = vi.spyOn(cells, "reportCells");
  try {
    const out = denserAssemblyCells(
      ir,
      table,
      223.4,
      f.page,
      f.baseline,
      score,
    );
    expect(out).toBe(f.baseline);
    expect(measure).toHaveBeenCalledTimes(10);
    expect(score).toHaveBeenCalledTimes(11);
  } finally {
    measure.mockRestore();
  }
});
it("rejects a lower page count bought by smaller text", () => {
  const f = fixture(),
    measure = vi
      .spyOn(cells, "reportCells")
      .mockReturnValue({ ...f.baseline, cellSize: 2.5 });
  try {
    expect(
      denserAssemblyCells(ir, table, 223.4, f.page, f.baseline, (m) =>
        m === f.baseline ? 3 : 1,
      ),
    ).toBe(f.baseline);
  } finally {
    measure.mockRestore();
  }
});
it("retains a printable baseline on candidate fit errors and propagates programming errors by identity", () => {
  const f = fixture(),
    measure = vi.spyOn(cells, "reportCells").mockImplementation(() => {
      throw new ReportMeasurementError("candidate cannot fit");
    });
  const score = (m: ReturnType<typeof cells.reportCells>) =>
    m === f.baseline ? 3 : 1;
  try {
    expect(
      denserAssemblyCells(ir, table, 223.4, f.page, f.baseline, score),
    ).toBe(f.baseline);
    const error = new Error("unexpected metrics failure");
    measure.mockImplementation(() => {
      throw error;
    });
    let caught: unknown;
    try {
      denserAssemblyCells(ir, table, 223.4, f.page, f.baseline, score);
    } catch (value) {
      caught = value;
    }
    expect(caught).toBe(error);
  } finally {
    measure.mockRestore();
  }
});
