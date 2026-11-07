import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { compileProject } from "@thermite/compiler";
import { renderSchematicPacket } from "../../render/src/sheets.js";
import { create } from "fontkit";
import { unshapedPrintableFont } from "../../render/src/symbols/font-shaping.js";
import {
  embedPrintableFont,
  subsetPrintableFont,
} from "../src/printable-font.js";
import { PRINTABLE_FONT_FAMILY } from "../../render/src/symbols/printable-font.js";
import { parseHTML } from "linkedom";
import { packetPdf } from "../src/alpha-pdf.js";
import {
  browserPath,
  launchBrowser,
  browserCrop,
  pdfCrop,
  inkBounds,
  unmatchedInk,
} from "./helpers/pdf-raster.js";

it("pins a deterministic document subset with unchanged selected advances", async () => {
  const text = "W M I - DC coil office A1 A2 3~ Ω →";
  const a = subsetPrintableFont("NotoSans-Regular", text),
    b = subsetPrintableFont("NotoSans-Regular", text);
  expect(a).toEqual(b);
  expect(createHash("sha256").update(a).digest("hex")).toBe(
    "446d2253cde6fc3ba7c1754825ee80bcf55b8f174943f067a5adfa91dc175e1e",
  );
  const original = create(
      unshapedPrintableFont(
        await readFile("packages/render/assets/fonts/NotoSans-Regular.ttf"),
      ),
    ),
    subset = create(a);
  if (!("unitsPerEm" in original) || !("unitsPerEm" in subset)) throw Error();
  for (const c of text)
    expect(subset.glyphForCodePoint(c.codePointAt(0)!).advanceWidth).toBe(
      original.glyphForCodePoint(c.codePointAt(0)!).advanceWidth,
    );
  expect(subset.layout(text).advanceWidth).toBe(
    original.layout(text).advanceWidth,
  );
  expect(subset.layout(text).positions).toEqual(
    original.layout(text).positions,
  );
});
it("keeps raw payloads font-free and bounds SVG/packet font delivery size", async () => {
  const c = await compileProject("examples/motor-starter");
  if (!c.ok) throw Error();
  const r = await renderSchematicPacket(c.ir, {
    format: "schematic-packet-request/0.1",
    views: [
      {
        format: "schematic-view-request/0.1",
        family: "control",
        root: { by: "designation", value: "K1" },
      },
    ],
  });
  if (!r.ok) throw Error(r.error.message);
  expect(JSON.stringify(r.value)).not.toMatch(/base64|@font-face/u);
  const raw = await (
    await import("../../render/src/renderer.js")
  ).renderSchematic(c.ir, {
    format: "schematic-view-request/0.1",
    family: "control",
    root: { by: "designation", value: "K1" },
  });
  if (!raw.ok) throw Error();
  const svg = raw.value.svg,
    standalone = embedPrintableFont(svg),
    html = embedPrintableFont(r.value.html);
  expect(
    Buffer.byteLength(standalone) - Buffer.byteLength(svg),
  ).toBeLessThanOrEqual(60 * 1024);
  expect(
    Buffer.byteLength(embedPrintableFont(r.value.sheets[0]!.svg)) -
      Buffer.byteLength(r.value.sheets[0]!.svg),
  ).toBeLessThanOrEqual(60 * 1024);
  expect(
    Buffer.byteLength(html) - Buffer.byteLength(r.value.html),
  ).toBeLessThanOrEqual(500 * 1024);
  expect(html.match(/data-thermite-font=/gu)).toHaveLength(1);
  expect(html.indexOf("data-thermite-font=")).toBeLessThan(
    html.indexOf("</head>"),
  );
});
it.skipIf(!browserPath)(
  "uses the same bundled face and ink in rooted/circuit browser and PDF labels",
  async () => {
    const compiled = await compileProject("examples/motor-starter");
    if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
    const browser = await launchBrowser();
    try {
      for (const view of [
        {
          format: "schematic-view-request/0.1",
          family: "control",
          root: { by: "designation", value: "K1" },
        },
        {
          format: "circuit-view-request/0.1",
          title: "Font parity",
          groups: [
            {
              id: "coil",
              functions: [
                { device: { by: "designation", value: "K1" }, key: "coil" },
              ],
              conductors: [],
            },
          ],
        },
      ]) {
        const result = await renderSchematicPacket(compiled.ir, {
          format: "schematic-packet-request/0.1",
          views: [view],
        });
        if (!result.ok) throw Error(result.error.message);
        const sheet = result.value.sheets[0]!;
        for (const t of parseHTML(sheet.svg).document.querySelectorAll(
          "text[font-family]",
        ))
          expect(t.getAttribute("font-family")).toBe(PRINTABLE_FONT_FAMILY);
        expect(sheet.svg).not.toContain('font-family="monospace"');
        const page = await browser.newPage({
          viewport: { width: 1800, height: 1400 },
        });
        let crop;
        try {
          await page.setContent(
            `<style>body{margin:0}svg{display:block}</style>${embedPrintableFont(sheet.svg)}`,
          );
          await page.evaluate(() => document.fonts.ready);
          crop = await page.evaluate(() => {
            const text = [...document.querySelectorAll("text")].find(
              (t) => t.textContent === "DC",
            )!;
            const b = text.getBoundingClientRect(),
              mm = 25.4 / 96;
            return {
              x: b.x * mm - 1,
              y: b.y * mm - 1,
              width: b.width * mm + 2,
              height: b.height * mm + 2,
            };
          });
          expect(
            await page.evaluate(() =>
              document.fonts.check("10px 'Thermite Sans'"),
            ),
          ).toBe(true);
        } finally {
          await page.close();
        }
        // Isolate the emitted label while retaining its complete transform stack.
        // Enclosure strokes at crop edges have different pixel rounding in the two rasterizers.
        const specimen = sheet.svg
          .replace(/<(?:path|rect|circle|line|polyline)\b[^>]*\/>/gu, "")
          .replace(/<text\b[^>]*>[\s\S]*?<\/text>/gu, (t) =>
            t.endsWith(">DC</text>") ? t : "",
          );
        const a = await browserCrop(
            browser,
            embedPrintableFont(specimen),
            crop,
          ),
          b = await pdfCrop(
            await packetPdf(
              { ...result.value, sheets: [{ ...sheet, svg: specimen }] },
              "R4 parity",
            ),
            crop,
          );
        const ba = inkBounds(a),
          bb = inkBounds(b);
        expect(ba.count).toBeGreaterThan(40);
        expect(Math.abs(ba.width - bb.width)).toBeLessThanOrEqual(2);
        expect(Math.abs(ba.height - bb.height)).toBeLessThanOrEqual(2);
        expect(unmatchedInk(a, b)).toBeLessThan(0.04);
        expect(unmatchedInk(b, a)).toBeLessThan(0.04);
      }
    } finally {
      await browser.close();
    }
  },
);

it.skipIf(!browserPath).each(["left-to-right", "top-to-bottom"] as const)(
  "keeps the authored coil qualifier clear of its outline in %s",
  async (flow) => {
    const c = await compileProject("examples/motor-starter");
    if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
    const result = await renderSchematicPacket(c.ir, {
      format: "schematic-packet-request/0.1",
      views: [
        {
          format: "circuit-view-request/0.1",
          title: "Coil qualifier",
          flow,
          groups: [
            {
              id: "coil",
              functions: [
                { device: { by: "designation", value: "K1" }, key: "coil" },
              ],
              conductors: [],
            },
          ],
        },
      ],
    });
    if (!result.ok) throw Error(result.error.message);
    const browser = await launchBrowser(),
      page = await browser.newPage();
    try {
      await page.setContent(embedPrintableFont(result.value.sheets[0]!.svg));
      await page.evaluate(() => document.fonts.ready);
      const gap = await page.evaluate(() => {
        const text = [...document.querySelectorAll("text")].find(
          (t) => t.textContent === "DC",
        )!;
        const rect = text
          .closest("[data-function-key]")!
          .querySelector('[data-circuit-mark="coil"] rect')!;
        const t = text.getBoundingClientRect(),
          r = rect.getBoundingClientRect(),
          mm = 25.4 / 96;
        return {
          left: (t.left - r.left) * mm,
          right: (r.right - t.right) * mm,
          top: (t.top - r.top) * mm,
          bottom: (r.bottom - t.bottom) * mm,
        };
      });
      // Horizontal ink clearance includes half the catalog stroke plus breathing room.
      expect(gap.left).toBeGreaterThan(0.2);
      expect(gap.right).toBeGreaterThan(0.2);
    } finally {
      await page.close();
      await browser.close();
    }
  },
);

it.skipIf(!browserPath).each(["left-to-right", "top-to-bottom"] as const)(
  "keeps rooted coil qualifier ink inside the coil in %s",
  async (flow) => {
    const c = await compileProject("examples/motor-starter");
    if (!c.ok) throw Error();
    const r = await renderSchematicPacket(c.ir, {
      format: "schematic-packet-request/0.1",
      views: [
        {
          format: "schematic-view-request/0.1",
          family: "control",
          root: { by: "designation", value: "K1" },
          flow,
        },
      ],
    });
    if (!r.ok) throw Error(r.error.message);
    const browser = await launchBrowser(),
      page = await browser.newPage();
    try {
      await page.setContent(embedPrintableFont(r.value.sheets[0]!.svg));
      await page.evaluate(() => document.fonts.ready);
      const gaps = await page.evaluate(() => {
        const coil = document.querySelector('[data-symbol-id="ais:coil"]')!;
        const t = [...coil.querySelectorAll("text")]
          .find((t) => t.textContent === "DC")!
          .getBoundingClientRect();
        const rect = coil.querySelector("rect")!.getBoundingClientRect();
        return [
          t.left - rect.left,
          rect.right - t.right,
          t.top - rect.top,
          rect.bottom - t.bottom,
        ];
      });
      for (const gap of gaps) expect(gap).toBeGreaterThan(0.25);
    } finally {
      await page.close();
      await browser.close();
    }
  },
);

it.each(["NotoSans-Regular", "NotoSans-Bold", "NotoSansMath-Regular"])(
  "preserves selected feature-free positions and outlines in %s",
  async (name) => {
    const text = "AV To W15 M1 office ffi é Å Ω ∆ ≥ μ → [1] 3~";
    const original = create(
      unshapedPrintableFont(
        await readFile(`packages/render/assets/fonts/${name}.ttf`),
      ),
    );
    const subset = create(subsetPrintableFont(name, text));
    if (!("unitsPerEm" in original) || !("unitsPerEm" in subset)) throw Error();
    const a = original.layout(text.normalize("NFC")),
      b = subset.layout(text.normalize("NFC"));
    expect(b.positions).toEqual(a.positions);
    expect(b.glyphs.map((g) => g.id)).toEqual(a.glyphs.map((g) => g.id));
    expect(b.glyphs.map((g) => g.bbox)).toEqual(a.glyphs.map((g) => g.bbox));
  },
);
