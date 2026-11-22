import { readFileSync } from "node:fs";
import { beforeAll, afterAll, it, expect } from "vitest";
import { launchBrowser } from "../../packages/cli/test/helpers/pdf-raster.ts";
import { packetPdf } from "../../packages/cli/dist/alpha-pdf.js";
import { embedPrintableFont } from "../../packages/cli/dist/printable-font.js";
import { loadPdfBytes, pdfText, rawPdfText } from "./pdf.mjs";
import { pdfIdentifierRuns } from "./identifier-pdf.mjs";
import { openSheet, drawingContextOptions } from "./browser.mjs";
import { pdfGeometryTexts, legibility } from "./checks.mjs";
import { continuationMediaIssues } from "./continuation-labels.mjs";
const fixtures = JSON.parse(
  readFileSync(
    new URL("./fixtures/pdf-clipped-continuations.json", import.meta.url),
  ),
);
let browser, context, page;
beforeAll(async () => {
  browser = await launchBrowser();
  context = await browser.newContext(drawingContextOptions);
  page = await context.newPage();
  await page.emulateMedia({ media: "print" });
});
afterAll(async () => {
  await context?.close();
  await browser?.close();
});
const esc = (s) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const text = (t) =>
  `<text x="${t.x}" y="${t.y}" font-size="${t.size}">${esc(t.text)}</text>`;
const sheet = (content) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="431.8mm" height="279.4mm" viewBox="0 0 431.8 279.4" font-family="Thermite Sans">${content}</svg>`;
async function withPdf(svg, work) {
  const document = await loadPdfBytes(
    await packetPdf(
      {
        page: { widthMm: 431.8, heightMm: 279.4 },
        sheets: [{ number: 1, svg }],
      },
      "Synthetic PDF clip control",
    ),
  );
  try {
    const p = await document.getPage(1);
    return await work(p, document);
  } finally {
    await document.loadingTask.destroy();
  }
}
const clipped = (t) => {
  const v = t.viewport;
  return `<svg x="${v.x}" y="${v.y}" width="${v.w}" height="${v.h}" viewBox="${v.x} ${v.y} ${v.w} ${v.h}" overflow="hidden">${text(t)}</svg>`;
};
it.each(fixtures.map((f) => [f.name, f]))(
  "real clip geometry: %s",
  async (name, f) => {
    const caption = `<a href="#sheet-1"><path d="M${f.rows[0].x - 3} ${f.rows[0].y}h2" stroke="black"/>${f.rows.map(text).join("")}</a>`,
      svg = sheet(f.hidden.map(clipped).join("") + caption),
      g = await openSheet(page, embedPrintableFont(svg));
    await withPdf(svg, async (p, doc) => {
      const raw = await rawPdfText(p, doc.fontFamilies, doc.fontCaps),
        painted = await pdfText(p, doc.fontFamilies, doc.fontCaps);
      expect(raw.length).toBeGreaterThan(painted.length);
      let oldBad = false;
      try {
        oldBad =
          continuationMediaIssues(
            g.texts,
            pdfGeometryTexts(g.texts, raw),
            "pdf",
          ).length > 0;
      } catch {
        oldBad = true;
      }
      expect(oldBad).toBe(true);
      const measured = pdfGeometryTexts(g.texts, painted);
      expect(continuationMediaIssues(g.texts, measured, "pdf")).toEqual([]);
      expect(legibility({ texts: measured })).toEqual([]);
      expect(
        (await pdfIdentifierRuns(p))
          .filter((t) => t.text.trim())
          .map((t) => t.text),
      ).toEqual(f.rows.map((t) => t.text));
    });
  },
);
it("keeps partial visible glyphs, excludes wholly clipped characters, and restores clips", async () => {
  const svg = sheet(
    '<svg x="20" y="20" width="2" height="8" viewBox="20 20 2 8" overflow="hidden"><text x="20" y="25" font-size="2.5">XYZ</text></svg><text x="30" y="25" font-size="2.5">RESTORED</text>',
  );
  await withPdf(svg, async (p, doc) => {
    const rows = await pdfText(p, doc.fontFamilies, doc.fontCaps);
    expect(rows.map((t) => t.text)).toEqual(["XY", "RESTORED"]);
    expect(rows[0].fontSize).toBeCloseTo(2.5, 5);
  });
});
it("uses embedded ink, keeping a Q tail visible outside its em box", async () => {
  const svg = sheet(
    '<svg x="20" y="25.05" width="10" height="1" viewBox="20 25.05 10 1" overflow="hidden"><text x="20" y="25" font-size="2.5">Q</text></svg>',
  );
  await withPdf(svg, async (p, doc) =>
    expect(
      (await pdfText(p, doc.fontFamilies, doc.fontCaps)).map((t) => t.text),
    ).toEqual(["Q"]),
  );
});
it("does not discard a painted decoy, a small row or a wrong/missing PDF row", async () => {
  const f = fixtures[0],
    base = f.rows.map(text).join(""),
    wrap = (rows) =>
      sheet(
        `<a href="#sheet-1"><path d="M397 130h2" stroke="black"/>${rows}</a>`,
      ),
    g = await openSheet(page, embedPrintableFont(wrap(base)));
  for (const rows of [
    base.replace("PE-SRC-M2", "WRONG"),
    base.replace("03.D1", "03.A1"),
    base.replace("C005", "C099"),
    base + text({ ...f.rows[1], text: "EXTRA", y: f.rows[1].y - 1.75 }),
  ]) {
    await withPdf(wrap(rows), async (p, doc) => {
      let refused = false;
      try {
        refused =
          continuationMediaIssues(
            g.texts,
            pdfGeometryTexts(
              g.texts,
              await pdfText(p, doc.fontFamilies, doc.fontCaps),
            ),
            "pdf",
          ).length > 0;
      } catch {
        refused = true;
      }
      expect(refused).toBe(true);
    });
  }
  await withPdf(wrap(base.replace(text(f.rows[1]), "")), async (p, doc) => {
    const missing = await pdfText(p, doc.fontFamilies, doc.fontCaps);
    expect(() => pdfGeometryTexts(g.texts, missing)).toThrow(/missing/);
  });
  await withPdf(
    wrap(text(f.rows[0]) + text({ ...f.rows[1], size: 2.2 })),
    async (p, doc) =>
      expect(
        legibility({
          texts: pdfGeometryTexts(
            g.texts,
            await pdfText(p, doc.fontFamilies, doc.fontCaps),
          ),
        }).length,
      ).toBeGreaterThan(0),
  );
});
