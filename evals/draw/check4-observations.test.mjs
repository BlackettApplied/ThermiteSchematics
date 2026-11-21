import { expect, it, vi } from "vitest";
vi.mock("./wire-locators.mjs", () => ({
  wireLocatorAudit: () => ({
    findings: [
      {
        sheet: 1,
        kind: "wire-locator-missing",
        element: "wire-row",
        designation: "W1",
        sheetLevel: true,
      },
    ],
    notMeasured: [],
    measurements: [],
  }),
}));
import { evaluateSheet } from "./evaluate.mjs";
import {
  svgIdentifiers,
  mediaIdentifiers,
} from "./identifier-observations.mjs";
import { observation } from "./evaluate.mjs";
import { c, fixture, documents } from "./check4-fixture.mjs";
const evaluate = (x) =>
  evaluateSheet(c, x.s, x.packet, x.g, x.ir, [], [], [], x.tables);
it("CHECK4 terminal lookup failure is sheet-level and retains subsequent observations", () => {
  const x = documents("terminals");
  x.tables.push(structuredClone(x.tables[0]));
  let rows;
  expect(() => {
    rows = evaluate(x);
  }).not.toThrow();
  expect(rows.find((r) => r.dq === "DQ-23")).toMatchObject({
    sheet: 1,
    status: "infrastructure-error",
  });
  expect(rows.some((r) => r.dq === "DQ-21")).toBe(true);
  expect(rows.some((r) => r.dq === "DQ-22")).toBe(true);
});
it("CHECK4 multiple requested terminal documents are measured without a case cascade", () => {
  const x = documents("terminals");
  let rows;
  expect(() => {
    rows = evaluate(x);
  }).not.toThrow();
  expect(rows.find((r) => r.dq === "DQ-23")).toMatchObject({ status: "fail" });
  expect(rows.filter((r) => r.status === "infrastructure-error")).toEqual([]);
});
it("CHECK4 identifier failure never relabels independent DQ-19 findings", () => {
  const x = fixture();
  x.g.reportRows = ["row"];
  x.g.texts = [
    {
      element: "null-cell",
      text: "UNSPECIFIED",
      row: "row",
      columnIndex: 4,
      fontSize: 3.5,
      bbox: { x: 20, y: 20, w: 30, h: 3 },
      cell: { x: 0, y: 0, w: 1, h: 1 },
    },
  ];
  const rows = evaluate(x),
    row = rows.find((r) => r.id.endsWith("DQ-19/sheet-001"));
  expect(row.evidence.findings.map((f) => f.kind)).toEqual(
    expect.arrayContaining([
      "wire-locator-missing",
      "text-outside-cell",
      "report-null-placeholder",
    ]),
  );
  expect(row.status).toBe("fail");
  const failed = rows.filter((r) => r.status === "infrastructure-error");
  expect(failed).toHaveLength(1);
  expect(failed[0]).toMatchObject({
    dq: "DQ-19",
    sheet: 1,
    instrumentation: "identifier",
    evidence: { findings: [] },
  });
  expect(failed[0].id).not.toBe(row.id);
});
it("CHECK4 SVG programming errors propagate even with a measurement-looking message", () => {
  const x = fixture();
  const error = new TypeError("Identifier measurement: programming sentinel");
  Object.defineProperty(x.g, "reportRows", {
    get() {
      throw error;
    },
  });
  expect(() => svgIdentifiers(x.s, x.packet, x.g, x.ir, [], {})).toThrow(error);
});
it("CHECK4 HTML/PDF programming errors propagate", async () => {
  const x = fixture();
  const error = new ReferenceError("programming sentinel");
  Object.defineProperty(x.g, "reportRows", {
    get() {
      throw error;
    },
  });
  await expect(
    mediaIdentifiers(c, x.s, x.packet, x.g, x.g, x.ir, [], {}, {}, observation),
  ).rejects.toThrow(error);
});
