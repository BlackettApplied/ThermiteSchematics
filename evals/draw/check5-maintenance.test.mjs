import { expect, it } from "vitest";
import { documents } from "./check4-fixture.mjs";
import { documentObservations } from "./document-observations.mjs";
import { reports } from "./checks.mjs";
import { missingMarkerRow } from "./marker-missing.mjs";
import { paintedItems, PaintedPdfMeasurementError } from "./pdf-painted.mjs";
const rows = (x) =>
  documentObservations({
    ...x,
    wireFindings: [],
    policy: {},
    cohort: (f) => f,
    obs: (dq, findings, extra = {}) => ({
      id: "check5/DQ-19/sheet-001",
      case: "check5",
      dq,
      status: findings.length ? "fail" : "pass",
      evidence: { findings },
      ...extra,
    }),
  });
it("CHECK5 missing native table cannot award a report-placeholder retirement", () => {
  const x = documents("assemblies");
  x.g.texts[0].text = "R1.X3 Unspecified";
  x.tables[0].rows[0].cells[4] = "R1.X3\nUnspecified";
  expect(
    rows(x)[0].evidence.findings.some(
      (f) => f.kind === "report-null-placeholder",
    ),
  ).toBe(true);
  x.tables.shift();
  const actual = rows(x);
  expect(actual.some((r) => r.status === "infrastructure-error")).toBe(true);
  const marker = {
    id: "null",
    dq: "DQ-19",
    check: "sheet",
    kind: "report-null-placeholder",
  };
  expect(
    missingMarkerRow(
      marker,
      "key",
      { case: "check5", sheet: "sheet:1" },
      false,
      actual,
    ).status,
  ).toBe("infrastructure-error");
});
it("CHECK5 two-document wire sheet retains its unowned sheet-zone legend", () => {
  const x = documents("wires");
  x.g.texts.push({ text: "From sheet.zone / To sheet.zone", painted: true });
  expect(rows(x).filter((r) => r.status === "infrastructure-error")).toEqual(
    [],
  );
  expect(reports(x.g, x.s, x.packet).map((f) => f.kind)).not.toContain(
    "wire-schedule-without-sheet-zones",
  );
  expect(rows(x)[0].evidence.findings.map((f) => f.kind)).not.toContain(
    "wire-schedule-without-sheet-zones",
  );
});
it("CHECK5 missing shared zone furniture is reported once on a two-document sheet", () => {
  const x = documents("wires");
  expect(
    rows(x)[0].evidence.findings.filter(
      (f) => f.kind === "wire-schedule-without-sheet-zones",
    ),
  ).toHaveLength(1);
});
const item = { text: "ABC", fontSize: 2, bbox: { x: 10, y: 18, w: 6, h: 2 } },
  raw = [{ fontName: "f", transform: [2, 0, 0, 2, 10, 20] }],
  viewport = { transform: [1, 0, 0, 1, 0, 0] },
  glyph = (x, visible, run) => ({
    text: "X",
    font: "f",
    size: 2,
    base: [x, 20],
    end: [x + 2, 20],
    points: [
      [x, 18],
      [x + 2, 20],
    ],
    visible,
    run,
  });
it.each(["inventory", "association", "ambiguous"])(
  "CHECK5 PDF %s measurement failure is typed",
  (kind) => {
    const glyphs =
      kind === "ambiguous"
        ? [glyph(10, true, 1), glyph(12, true, 2), glyph(14, false, 2)]
        : [];
    expect(() =>
      paintedItems([item], kind === "inventory" ? [] : raw, glyphs, viewport),
    ).toThrow(PaintedPdfMeasurementError);
  },
);
