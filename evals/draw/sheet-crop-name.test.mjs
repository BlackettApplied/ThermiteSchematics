import { expect, it } from "vitest";
import { sheetCropName } from "./sheet-crop-name.mjs";
const original = { id: "c/DQ-14/sheet-001", dq: "DQ-14", status: "fail" };
it("new semantic failures cannot rename or overwrite earlier row crops", () => {
  const added = {
    ...original,
    id: "c/DQ-14/check3-native-landings-1",
    mechanism: "N3",
  };
  const rows = [original, added];
  expect(sheetCropName("sheet-001", original, rows)).toBe(
    "sheet-001-DQ-14.png",
  );
  expect(sheetCropName("sheet-001", added, rows)).not.toBe(
    sheetCropName("sheet-001", original, rows),
  );
  expect(sheetCropName("sheet-001", added, rows)).toBe(
    sheetCropName("sheet-001", added, [added]),
  );
});
it("existing duplicate and medium naming is preserved", () => {
  const second = { ...original, id: "c/DQ-14/second" };
  const pdf = { ...original, medium: "pdf" },
    html = { ...original, medium: "html" };
  const rows = [original, second, pdf, html];
  expect(sheetCropName("sheet-001", original, rows)).toMatch(
    /^sheet-001-DQ-14-[a-f0-9]{10}\.png$/,
  );
  expect(sheetCropName("sheet-001", second, rows)).not.toBe(
    sheetCropName("sheet-001", original, rows),
  );
  expect(sheetCropName("sheet-001", pdf, rows)).toBe("sheet-001-DQ-14-pdf.png");
  expect(sheetCropName("sheet-001", html, rows, html)).toBe(
    "sheet-001-DQ-14-html.png",
  );
});
