import { expect, it } from "vitest";
import PDFDocument from "pdfkit";
import { fileURLToPath } from "node:url";
import { OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { loadPdfBytes, pdfTextMeasurements } from "./pdf.mjs";
import { pdfDocumentFixture } from "./pdf-document-fixture.mjs";
import { pdfGlyphRuns } from "./pdf-ink-operators.mjs";
import { embeddedGlyphMetric } from "./pdf-glyph-metrics.mjs";
import { fontMetrics } from "./checks.mjs";

const size = (2.5 * 72) / 25.4;
async function measure(bytes, alter) {
  const doc = await loadPdfBytes(bytes);
  try {
    const page = await doc.getPage(1),
      glyphs = [];
    pdfGlyphRuns(
      await page.getOperatorList(),
      OPS,
      page.getViewport({ scale: 25.4 / 72 }).transform,
      embeddedGlyphMetric(page),
      (g) => glyphs.push(g),
    );
    const input = alter
      ? new Proxy(page, {
          get(target, key) {
            if (key === "getTextContent")
              return async (options) => {
                const content = await target.getTextContent(options);
                return {
                  ...content,
                  items: content.items.map((item) =>
                    item.str?.trim() ? alter(item) : item,
                  ),
                };
              };
            const value = Reflect.get(target, key, target);
            return typeof value === "function" ? value.bind(target) : value;
          },
        })
      : page;
    return {
      ...(await pdfTextMeasurements(input, doc.fontFamilies, doc.fontCaps)),
      glyphs,
    };
  } finally {
    await doc.loadingTask.destroy();
  }
}
const nativeWidth = (gs) =>
  Math.hypot(
    gs.at(-1).end[0] - gs[0].base[0],
    gs.at(-1).end[1] - gs[0].base[1],
  );
const label = (p, advance) => ({
  text: p.text,
  font: "NotoSans",
  bbox: p.bbox,
  advance,
});
const inferred = (item) => ({
  ...item,
  str: item.str + " ",
  width: item.width + 4,
});

it("DQ-21 ignores an extraction-inferred trailing space, preserving other PDF geometry", async () => {
  const result = await measure(
      await pdfDocumentFixture("D", 0, true, size),
      inferred,
    ),
    p = result.metrics[0],
    width = nativeWidth(result.glyphs);
  expect(result.text[0].renderedString).toBe("D ");
  expect(result.text[0].bbox.w).toBeGreaterThan(width + 1);
  expect(p.bbox.w).toBeCloseTo(width, 6);
  expect(fontMetrics([label(p, width)], result.metrics)).toEqual([]);
});
it("DQ-21 counts a genuinely painted trailing space even when extraction drops it", async () => {
  const result = await measure(await pdfDocumentFixture("D ", 0, true, size)),
    p = result.metrics[0],
    width = nativeWidth(result.glyphs);
  expect(result.glyphs.map((g) => g.text).join("")).toBe("D ");
  expect(result.text[0].renderedString).toBe("D");
  expect(p.bbox.w).toBeCloseTo(width, 6);
  expect(fontMetrics([label(p, width)], result.metrics)).toEqual([]);
  expect(
    fontMetrics(
      [label(p, nativeWidth(result.glyphs.slice(0, 1)))],
      result.metrics,
    ),
  ).toHaveLength(1);
});
it("DQ-21 still catches a real width mismatch at the unchanged tolerance", async () => {
  const result = await measure(await pdfDocumentFixture("D", 0, true, size)),
    p = result.metrics[0],
    width = nativeWidth(result.glyphs);
  const findings = fontMetrics([label(p, width + 0.4)], result.metrics);
  expect(findings).toHaveLength(1);
  expect(findings[0].deltaMm).toBeCloseTo(0.4, 6);
});
async function multiRunPdf() {
  const doc = new PDFDocument({ autoFirstPage: false }),
    chunks = [];
  const done = new Promise((resolve, reject) => {
    doc.on("data", (b) => chunks.push(b));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  doc.addPage({ size: [720, 360], margin: 0 });
  doc.font(
    fileURLToPath(
      new URL(
        "../../packages/render/assets/fonts/NotoSans-Regular.ttf",
        import.meta.url,
      ),
    ),
  );
  doc.fontSize(size).text("AB", 30, 30, { continued: true }).text("CD");
  doc.end();
  return done;
}
it("DQ-21 measures a multi-run line from all native show-text advances", async () => {
  const result = await measure(await multiRunPdf(), inferred),
    width = nativeWidth(result.glyphs);
  expect(new Set(result.glyphs.map((g) => g.operator)).size).toBe(2);
  expect(result.metrics.map((p) => p.text)).toEqual(["ABCD"]);
  expect(result.metrics[0].bbox.w).toBeCloseTo(width, 6);
  expect(
    fontMetrics([label(result.metrics[0], width)], result.metrics),
  ).toEqual([]);
});

it("routes native advances only to DQ-21, preserving every other sheet observation", async () => {
  const { evaluateSheet } = await import("./evaluate.mjs"),
    data = await measure(
      await pdfDocumentFixture("D", 0, true, size),
      inferred,
    ),
    width = nativeWidth(data.glyphs),
    sheet = {
      number: 1,
      view: { format: "documentation-view/0.1", kind: "wiring" },
      references: [],
      continuations: [],
    },
    packet = { sheets: [sheet] },
    g = {
      width: 432,
      height: 279,
      texts: [
        {
          ...data.text[0],
          element: "zone-D",
          advance: width,
          bbox: { ...data.text[0].bbox, w: width },
        },
      ],
      terminals: [],
      devices: [],
      shapes: [],
      catalogs: [],
      reportRows: [],
    },
    ir = { devices: [], functions: [], nets: [] };
  const evaluate = (metrics) =>
    evaluateSheet(
      { id: "native-width", flow: "left-to-right" },
      sheet,
      packet,
      g,
      ir,
      data.text,
      [],
      [],
      [],
      [g],
      undefined,
      {},
      metrics,
    );
  const original = evaluate(data.text),
    corrected = evaluate(data.metrics);
  expect(original.find((r) => r.dq === "DQ-21").status).toBe("fail");
  expect(corrected.find((r) => r.dq === "DQ-21").status).toBe("pass");
  expect(corrected.filter((r) => r.dq !== "DQ-21")).toEqual(
    original.filter((r) => r.dq !== "DQ-21"),
  );
});
