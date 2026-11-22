import { afterAll, beforeAll, expect, it } from "vitest";
import { launch, drawingContextOptions, openSheet } from "./browser.mjs";
import { netLabelRepetition } from "./checks.mjs";
let browser, page;
beforeAll(async () => {
  browser = await launch();
  page = await (await browser.newContext(drawingContextOptions)).newPage();
});
afterAll(async () => {
  await browser?.close();
});
import { netDrawing as drawing } from "./net-label-fixture.mjs";
it("222.3 painted label at the target fails with coherent false source claims", async () => {
  expect(netLabelRepetition(await openSheet(page, drawing()))).toEqual([]);
  const g = await openSheet(page, drawing({ far: true, falseSource: true }));
  expect(netLabelRepetition(g).map((f) => f.kind)).toEqual([
    "net-label-source-geometry-mismatch",
  ]);
});
