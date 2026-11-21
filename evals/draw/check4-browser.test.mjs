import { expect, it, beforeAll, afterAll } from "vitest";
import {
  launch,
  drawingContextOptions,
  displaySheet,
  evaluateSheetGeometry,
} from "./browser.mjs";
import { IdentifierMeasurementError } from "./identifier-errors.mjs";
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
const drawing = (rectangle = true) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="200mm" height="100mm" viewBox="0 0 200 100"><g data-report-row="row"><g>${rectangle ? '<rect x="10" y="10" width="80" height="12" fill="white" stroke="#9ba6b4"/>' : ""}<g data-report-column="1"><text x="12" y="17" font-size="3.5">LABEL</text></g></g></g></svg>`;
it("CHECK4 browser missing-cell data crosses the boundary as a typed measurement error", async () => {
  await displaySheet(page, drawing(false));
  await expect(evaluateSheetGeometry(page)).rejects.toBeInstanceOf(
    IdentifierMeasurementError,
  );
});
it("CHECK4 browser programming errors with measurement-looking messages propagate", async () => {
  await displaySheet(page, drawing());
  expect((await evaluateSheetGeometry(page)).reportCells).toHaveLength(1);
  await page.evaluate(() => {
    document.querySelector("text").getNumberOfChars = () => {
      throw new TypeError(
        "Identifier measurement: browser programming sentinel",
      );
    };
  });
  await expect(evaluateSheetGeometry(page)).rejects.toThrow(
    "browser programming sentinel",
  );
  try {
    await evaluateSheetGeometry(page);
  } catch (error) {
    expect(error).not.toBeInstanceOf(IdentifierMeasurementError);
  }
});
