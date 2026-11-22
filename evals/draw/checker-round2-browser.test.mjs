import { loadPdfBytes, renderPdf } from "./pdf.mjs";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  launch,
  drawingContextOptions,
  openSheet,
  screenshotCrop,
  cropBox,
} from "./browser.mjs";
import { netDrawing } from "./net-label-fixture.mjs";
import { netLabelRepetition } from "./checks.mjs";
import { svgLocators, identities } from "./locators.mjs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
let browser, page;
beforeAll(async () => {
  browser = await launch();
  page = await (await browser.newContext(drawingContextOptions)).newPage();
});
afterAll(async () => {
  await browser?.close();
});
it("r2.3 tspan net findings retain the original issue fields, identity and crop bounds", async () => {
  let svg = netDrawing({ tspan: true, repeat: true }).replace(
    /(<text class="label-net"[^>]*>.*?<\/text>)/u,
    '<a href="#sheet-2"><path d="M20 30 H25" stroke="black"/>$1</a>',
  );
  const clip = svg.match(/<text class="label-net"[^>]*clip-path="([^"]+)"/u)[1];
  svg = svg.replace("<tspan>", `<tspan clip-path="${clip}">`);
  const g = await openSheet(page, svg);
  const label = g.texts.find((t) => t.labelRole === "net");
  expect(label.element).toMatch(/^tspan-/);
  expect(label.locatorElement).toMatch(/^text-/);
  label.medium = "pdf";
  label.boxKind = "ink";
  const finding = netLabelRepetition(g).find(
    (f) => f.kind === "net-label-repeats-terminal-caption",
  );
  expect(finding).toMatchObject({
    locatorElement: label.locatorElement,
    medium: "pdf",
    boxKind: "ink",
    emBbox: label.emBbox,
  });
  expect(Object.keys(finding).slice(0, 7)).toEqual([
    "element",
    "locatorElement",
    "medium",
    "boxKind",
    "designation",
    "bbox",
    "emBbox",
  ]);
  expect(Object.keys(finding).at(-1)).toBe("kind");
  const index = svgLocators(svg, {}, {}),
    row = { id: "case/DQ-17/sheet-001", dq: "DQ-17", sheet: 1, medium: "svg" };
  const identity = identities(row, finding, index, {}, {});
  expect(identity[0].locator).toBe(
    [
      index.get(label.locatorElement).locator,
      index.get(finding.otherElement).locator,
    ]
      .sort()
      .join(" overlaps "),
  );
  expect(identity[0].medium).toBe("pdf");
  await verifyPdfCrop(page, finding);
  const directory = await mkdtemp(join(tmpdir(), "checker-r2-crop-"));
  try {
    const path = join(directory, "crop.png");
    await screenshotCrop(page, cropBox(finding.bbox, 200, 100), path);
    const png = await readFile(path);
    expect(png.subarray(1, 4).toString()).toBe("PNG");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

async function verifyPdfCrop(page, finding) {
  // This is the same medium dispatch used by the retained runner crop branches.
  expect(finding.medium).toBe("pdf");
  const pdf = await loadPdfBytes(
    await page.pdf({
      width: "200mm",
      height: "100mm",
      printBackground: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    }),
  );
  try {
    const bounds = cropBox(finding.bbox, 200, 100);
    const canvas = await renderPdf(await pdf.getPage(1), 300, bounds);
    expect(Math.abs(canvas.width - (bounds.w * 300) / 25.4)).toBeLessThan(2);
    expect(
      canvas
        .getContext("2d")
        .getImageData(0, 0, canvas.width, canvas.height)
        .data.some((v, i) => i % 4 === 0 && v < 100),
    ).toBe(true);
  } finally {
    await pdf.loadingTask.destroy();
  }
}
