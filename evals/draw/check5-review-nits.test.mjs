import { expect, it } from "vitest";
import { documents } from "./check4-fixture.mjs";
import { reportFurniture, reports } from "./report-checks.mjs";
import { paintedItems } from "./pdf-painted.mjs";
import { pdfIdentifierRuns } from "./identifier-pdf.mjs";
import { IdentifierMeasurementError } from "./identifier-errors.mjs";

it("CHECK5 empty wires report has no sheet-zone furniture obligation (5.22)", () => {
  const x = documents("wires");
  x.g.reportRows = [];
  x.g.texts = [];
  expect(reports(x.g, x.s, x.packet)).toEqual([]);
  expect(reportFurniture(x.g, x.s)).toEqual([]);
});
it("CHECK5 shared painted-PDF failure is not identifier instrumentation", () => {
  let error;
  try {
    paintedItems([{}], [], [], {});
  } catch (e) {
    error = e;
  }
  expect(error?.message).toBe("PDF extraction inventory changed");
  expect(error).not.toBeInstanceOf(IdentifierMeasurementError);
});
const fakePage = (failure) => ({
  getTextContent: async () => ({
    items: [
      { str: "X", transform: [2, 0, 0, 2, 10, 20], width: 2, fontName: "f" },
    ],
  }),
  getViewport: () => ({
    transform: [1, 0, 0, 1, 0, 0],
    convertToViewportPoint: (x, y) => [x, y],
  }),
  getOperatorList: async () => {
    if (failure) throw failure;
    return { fnArray: [], argsArray: [] };
  },
});
it("CHECK5 only the identifier PDF call wraps a typed painted measurement failure", async () => {
  await expect(pdfIdentifierRuns(fakePage())).rejects.toBeInstanceOf(
    IdentifierMeasurementError,
  );
});
it("CHECK5 an identifier PDF programming error propagates unchanged", async () => {
  const error = new TypeError("unrelated PDF programming failure");
  await expect(pdfIdentifierRuns(fakePage(error))).rejects.toBe(error);
});
