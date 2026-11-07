import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser, Page } from "playwright-core";
import { compileProject, type ElectricalIr } from "@thermite/compiler";
import { renderSchematicPacket, type RenderedPacket } from "@thermite/render";
import { buildDocumentation } from "@thermite/query";
import { documentationFixture } from "../../query/test/documentation-fixture.js";
import { browserPath, launchBrowser } from "./helpers/pdf-raster.js";

// Run in Chromium. Compare identical SVG shaping with/without forced lengths,
// rather than counting hanging, unpainted authored whitespace as glyph advance.
function reportScaleIssues() {
  const matched = [
    ...document.querySelectorAll<SVGTextElement>("[data-report-column] text"),
  ];
  if (!matched.some((text) => text.textContent?.trim()))
    return [{ text: "", kind: "no-report-text" }];
  const headerIssues = [...document.querySelectorAll("[data-report-column]")]
    .filter((cell) => !cell.closest("[data-report-row]"))
    .flatMap((cell) => {
      const expected = (cell.getAttribute("data-column-name") ?? "")
        .replace(/\s+/gu, " ")
        .trim();
      const pieces = [...cell.querySelectorAll("text")].map(
        (t) => t.textContent ?? "",
      );
      const hyphenated = pieces.some((t) => t.endsWith("-"));
      const actual = pieces
        .join(" ")
        .replace(/- (?=\S)/gu, "")
        .replace(/\s+/gu, " ")
        .trim();
      return expected === actual &&
        (!hyphenated ||
          !!cell.closest("svg")?.querySelector("[data-report-header-note]"))
        ? []
        : [{ text: actual, kind: "header-word-split" }];
    });
  const glyphIssues = [
    ...document.querySelectorAll<SVGTextElement>("svg text"),
  ].flatMap((text) => {
    const value = text.textContent ?? "";
    if (!value.trim()) return [];
    const issues: { text: string; kind: string; scale?: number }[] = [];
    if (text.closest("[data-report-column]") && value !== value.trim())
      issues.push({ text: value, kind: "cell-wrap-space" });
    const reference = text.cloneNode(true) as SVGTextElement;
    for (const element of [reference, ...reference.querySelectorAll("*")]) {
      element.removeAttribute("textLength");
      element.removeAttribute("lengthAdjust");
    }
    text.parentElement!.appendChild(reference);
    const natural = reference.getComputedTextLength();
    reference.remove();
    const matrix = text.getScreenCTM()!,
      scale = natural
        ? (((text.hasAttribute("textLength")
            ? Number(text.getAttribute("textLength"))
            : text.getComputedTextLength()) /
            natural) *
            Math.hypot(matrix.a, matrix.b)) /
          Math.hypot(matrix.c, matrix.d)
        : 1;
    // Only numeric DOM/CTM rounding tolerance, not a wider distortion policy.
    if (Math.max(scale, 1 / scale) > 1.1 + 1e-9 || scale > 1 + 1e-9)
      issues.push({ text: value, kind: "glyph-scale", scale });
    return issues;
  });
  return [...headerIssues, ...glyphIssues];
}

const papers = ["letter", "a4", "tabloid", "a3"] as const;
let browser: Browser,
  page: Page,
  filtering: ElectricalIr,
  fixture: ElectricalIr;
beforeAll(async () => {
  if (!browserPath) return;
  browser = await launchBrowser();
  page = await browser.newPage();
  await page.emulateMedia({ media: "print" });
  const compiled = await compileProject("examples/report-filtering");
  if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
  filtering = compiled.ir;
  fixture = await documentationFixture();
});
afterAll(async () => {
  await browser?.close();
});
async function checked(packet: RenderedPacket) {
  // Standalone SVG and the real packet HTML use different enclosing styles.
  for (const [medium, documents] of [
    ["svg", packet.sheets.map((s) => s.svg)],
    ["html", [packet.html]],
  ] as const) {
    for (const content of documents) {
      await page.setContent(content);
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(reportScaleIssues), medium).toEqual([]);
    }
  }
}

describe.skipIf(!browserPath)(
  "report glyph-scale bound in SVG and HTML",
  () => {
    it("rejects an empty selector and detects forced scale on report titles and notes", async () => {
      await page.setContent(
        '<svg xmlns="http://www.w3.org/2000/svg"><text>Not a report</text></svg>',
      );
      expect(await page.evaluate(reportScaleIssues)).toEqual([
        { text: "", kind: "no-report-text" },
      ]);
      const result = await renderSchematicPacket(filtering, {
        format: "schematic-packet-request/0.1",
        views: [{ format: "documentation-view-request/0.1", kind: "bom" }],
      });
      if (!result.ok) throw Error(result.error.message);
      for (const content of [result.value.sheets[0]!.svg, result.value.html])
        for (const prefix of ["Bill of materials", "Qty counts instances"]) {
          await page.setContent(content);
          await page.evaluate((prefix) => {
            const text = [
              ...document.querySelectorAll<SVGTextElement>("text"),
            ].find((t) => t.textContent?.startsWith(prefix))!;
            text.setAttribute(
              "textLength",
              String(text.getComputedTextLength() * 0.9),
            );
            text.setAttribute("lengthAdjust", "spacingAndGlyphs");
          }, prefix);
          expect(
            (await page.evaluate(reportScaleIssues)).some(
              (issue) => issue.kind === "glyph-scale",
            ),
          ).toBe(true);
        }
    });
    it("prints a wrapped Order number header without unused break spaces", async () => {
      const result = await renderSchematicPacket(filtering, {
        format: "schematic-packet-request/0.1",
        page: { size: "letter", orientation: "landscape", marginMm: 10 },
        views: [{ format: "documentation-view-request/0.1", kind: "bom" }],
      });
      if (!result.ok) throw Error(result.error.message);
      await checked(result.value);
    });
    it("rejects excessive compression and any stretch, while accepting the exact compression limit", async () => {
      await page.setContent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 30"><g data-report-row="control"><g data-report-column="1"><text x="5" y="15" font-size="3">ORDER</text></g></g></svg>',
      );
      for (const [scale, fails] of [
        [1, false],
        [1 / 1.1, false],
        [1 / 1.1 - 1e-7, true],
        [0.9091, false],
        [0.9, true],
        [1.001, true],
      ] as const) {
        await page.evaluate((scale) => {
          const text = document.querySelector<SVGTextElement>("text")!;
          text.removeAttribute("textLength");
          const natural = text.getComputedTextLength();
          text.setAttribute("textLength", String(natural * scale));
          text.setAttribute("lengthAdjust", "spacingAndGlyphs");
        }, scale);
        expect(
          (await page.evaluate(reportScaleIssues)).length > 0,
          String(scale),
        ).toBe(fails);
      }
      for (const [scale, fails] of [
        [0.9091, false],
        [0.9, true],
        [1.001, true],
      ] as const) {
        await page.evaluate((scale) => {
          const text = document.querySelector<SVGTextElement>("text")!;
          text.removeAttribute("textLength");
          text.setAttribute("transform", `scale(${scale} 1)`);
        }, scale);
        expect(
          (await page.evaluate(reportScaleIssues)).length > 0,
          `transform ${scale}`,
        ).toBe(fails);
      }
    });
    it("guards all report-filtering report columns on every paper, orientation and layout", async () => {
      for (const size of papers)
        for (const orientation of ["landscape", "portrait"] as const)
          for (const layout of ["standard", "compact"] as const)
            for (const marginMm of [5, 10, 25]) {
              const result = await renderSchematicPacket(filtering, {
                format: "schematic-packet-request/0.1",
                page: { size, orientation, marginMm },
                layout,
                views: (
                  [
                    "bom",
                    "wires",
                    "cables",
                    "terminals",
                    "io",
                    "io-ports",
                    "network",
                    "assemblies",
                  ] as const
                ).map((kind) => ({
                  format: "documentation-view-request/0.1",
                  kind,
                })),
              });
              if (!result.ok) throw Error(result.error.message);
              await checked(result.value);
            }
    });
    it.each(["W", "i", "電", "😀", "e\u0301", "ΩЖ", "→−"])(
      "guards bounded long %s type text in both BOM column sets and cables on every paper and layout",
      async (glyph) => {
        for (const wide of [false, true]) {
          const input = structuredClone(fixture);
          for (const type of [...input.deviceTypes, ...input.cableTypes])
            type.description = glyph.repeat(2000);
          if (wide)
            for (let i = 0; i < 20; i++) {
              const device = {
                ...input.devices[0]!,
                uid: `scale-device-${i}`,
                designation: `CR${100 + i}`,
              };
              delete device.description;
              input.devices.push(device);
            }
          expect(
            buildDocumentation(input, {
              format: "documentation-view-request/0.1",
              kind: "bom",
            }).widths[1],
          ).toBe(wide ? 0.23 : 0.1);
          for (const size of papers)
            for (const orientation of ["landscape", "portrait"] as const)
              for (const layout of ["standard", "compact"] as const)
                for (const marginMm of [10]) {
                  const result = await renderSchematicPacket(input, {
                    format: "schematic-packet-request/0.1",
                    page: { size, orientation, marginMm },
                    layout,
                    views: [
                      { format: "documentation-view-request/0.1", kind: "bom" },
                      {
                        format: "documentation-view-request/0.1",
                        kind: "cables",
                      },
                    ],
                  });
                  if (!result.ok) throw Error(result.error.message);
                  await checked(result.value);
                }
        }
      },
    );
  },
);

it.each([
  [1 / 1.1, false],
  [1.1, false],
  [1 / (1.1 + 1e-7), true],
  [1.1 + 1e-7, true],
])(
  "shares E3's symmetric anisotropy boundary at %s (report stretching is separately forbidden)",
  (scale, bad) => {
    expect(Math.max(scale!, 1 / scale!) > 1.1 + 1e-9).toBe(bad);
  },
);
