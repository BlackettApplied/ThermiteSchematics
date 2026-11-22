import { afterAll, beforeAll, expect, it } from "vitest";
import { launch, openSheet, drawingContextOptions } from "./browser.mjs";
import { issuedRows } from "./m3-documents.mjs";
let browser, context, page;
beforeAll(async () => {
  browser = await launch();
  context = await browser.newContext(drawingContextOptions);
  page = await context.newPage();
});
afterAll(async () => {
  await context?.close();
  await browser?.close();
});
const svg = (kind) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="210mm" height="200mm" viewBox="0 0 210 200"><g data-document-id="auto-document/1/inline" data-document-origin="auto" ${kind === undefined ? "" : `data-document-kind="${kind}"`}><g id="row-ink" data-report-row='["native-device","X3"]'><rect x="25" y="40" width="128" height="10" fill="white" stroke="#9ba6b4"/><g data-report-column="1" data-column-name="Assembly / cable"><text x="26" y="46" font-size="3.5">Unoccupied</text></g></g></g></svg>`;
it("C5 measures an inline document kind on actual row text and cell rectangles", async () => {
  const g = await openSheet(page, svg("assemblies")),
    packet = { sheets: [{ number: 1, view: { kind: "connector-assembly" } }] };
  expect(g.texts.filter((t) => t.row).map((t) => t.documentKind)).toEqual([
    "assemblies",
  ]);
  expect(g.reportCells.map((c) => c.documentKind)).toEqual(["assemblies"]);
  expect(issuedRows(packet, [g])[0].kind).toBe("assemblies");
});
it("C5 an absent kind preserves legacy measurements and a blank kind fails closed", async () => {
  const packet = { sheets: [{ number: 1, view: { kind: "assemblies" } }] },
    legacy = await openSheet(page, svg());
  expect(legacy.texts.every((t) => !Object.hasOwn(t, "documentKind"))).toBe(
    true,
  );
  expect(
    legacy.reportCells.every((c) => !Object.hasOwn(c, "documentKind")),
  ).toBe(true);
  expect(issuedRows(packet, [legacy])[0].kind).toBe("assemblies");
  const blank = await openSheet(page, svg(""));
  expect(issuedRows(packet, [blank])[0].kind).toBe("unresolved-document-kind");
  blank.reportCells[0].documentKind = "assemblies";
  expect(issuedRows(packet, [blank])[0].kind).toBe("unresolved-document-kind");
});
