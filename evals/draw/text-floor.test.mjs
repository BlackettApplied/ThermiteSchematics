import { beforeAll, afterAll, it, expect } from "vitest";
import { chromium } from "playwright-core";
import { createRequire } from "node:module";
import { browserPath } from "./chromium-path.mjs";
import { browserFloorRuns, belowFloor } from "./text-floor.mjs";
import { pdfFloorRuns } from "./text-floor-pdf.mjs";
const require = createRequire(import.meta.url),
  PDFDocument = require("pdfkit");
let browser, page;
beforeAll(async () => {
  browser = await chromium.launch({
    executablePath: await browserPath(),
    headless: true,
  });
  page = await browser.newPage({ offline: true, javaScriptEnabled: false });
  await page.emulateMedia({ media: "print" });
});
afterAll(async () => {
  await browser?.close();
});
const svg = (body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 100 100">${body}</svg>`;
it.each([
  ["furniture", '<text x="10" y="10" font-size="2.4">Thermite 0.3.0</text>'],
  ["zone", '<text x="10" y="10" font-size="2.2">A</text>'],
  ["footer", '<text x="10" y="90" font-size="2.3">Footer text</text>'],
  ["boundary", '<text x="10" y="10" font-size="2.3">BOUNDARY</text>'],
  [
    "inherited transform",
    '<g transform="translate(10 10) scale(1 .8)" font-size="2.5"><text>Scaled text</text></g>',
  ],
  [
    "mixed tspan",
    '<text x="10" y="10" font-size="2.5">Good<tspan font-size="2.4">Bad</tspan></text>',
  ],
])("catches sub-floor %s without role exemptions", async (_name, body) => {
  const runs = await browserFloorRuns(page, Buffer.from(svg(body)));
  expect(runs.filter(belowFloor)).toHaveLength(1);
});
it("covers HTML print CSS, including a print-only shrinking transform", async () => {
  const html = `<style>@media print{svg{transform:scaleY(.9)}}header{display:none}</style><header>Not printed</header>${svg('<text x="10" y="10" font-size="2.5">Print</text>')}`;
  const runs = await browserFloorRuns(page, Buffer.from(html));
  expect(runs).toHaveLength(1);
  expect(runs[0].emMm).toBeCloseTo(2.25, 5);
  expect(belowFloor(runs[0])).toBe(true);
});
it("passes compliant inherited, rotated and anisotropic text; respects visibility", async () => {
  const runs = await browserFloorRuns(
    page,
    Buffer.from(
      svg(
        `<g font-size="2.5"><text x="10" y="10">Floor</text><g transform="translate(30 30) rotate(90) scale(.4 1)"><text>Vertical em</text></g></g><g style="display:none"><text font-size="1">Hidden</text></g><text visibility="hidden" font-size="1">Hidden</text><g opacity="0"><text font-size="1">Hidden</text></g>`,
      ),
    ),
  );
  expect(runs).toHaveLength(2);
  expect(runs.filter(belowFloor)).toEqual([]);
  for (const run of runs) expect(run.emMm).toBeCloseTo(2.5, 5);
});
async function pdfRun(size, scale = 1) {
  const doc = new PDFDocument({ size: [300, 300], margin: 0, compress: false });
  const chunks = [];
  doc.on("data", (chunk) => chunks.push(chunk));
  const done = new Promise((resolve) => doc.on("end", resolve));
  doc.font(require.resolve("dejavu-fonts-ttf/ttf/DejaVuSans.ttf"));
  doc
    .save()
    .translate(20, 20)
    .scale(1, scale)
    .fontSize(size)
    .text("PDF-only run", 0, 0);
  doc.restore();
  doc.end();
  await done;
  return pdfFloorRuns(Buffer.concat(chunks));
}
it("catches a PDF-only sub-floor run directly from native font operators", async () => {
  const runs = await pdfRun((2.4 * 72) / 25.4);
  expect(runs).toHaveLength(1);
  expect(runs[0].emMm).toBeCloseTo(2.4, 5);
  expect(runs.filter(belowFloor)).toHaveLength(1);
});
it("uses the PDF graphics CTM and passes a compliant PDF", async () => {
  expect(
    (await pdfRun((2.5 * 72) / 25.4, 0.8)).filter(belowFloor),
  ).toHaveLength(1);
  const runs = await pdfRun((2.5 * 72) / 25.4);
  expect(runs).toHaveLength(1);
  expect(runs.filter(belowFloor)).toEqual([]);
});
it("retains nested SVG scale and excludes fully clipped text", async () => {
  const runs = await browserFloorRuns(
    page,
    Buffer.from(
      svg(
        `<svg x="10" y="10" width="50" height="50" viewBox="0 0 1000 1000" overflow="hidden"><text x="10" y="100" font-size="50">Floor</text><text x="2000" y="100" font-size="1">Outside viewport</text></svg><defs><clipPath id="clip" clipPathUnits="userSpaceOnUse"><rect width="2" height="2"/></clipPath></defs><g clip-path="url(#clip)"><text x="50" y="50" font-size="1">Clipped</text></g>`,
      ),
    ),
  );
  expect(runs).toHaveLength(1);
  expect(runs[0].emMm).toBeCloseTo(2.5, 5);
  expect(runs.filter(belowFloor)).toEqual([]);
});
