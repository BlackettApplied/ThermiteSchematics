import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser, Page } from "playwright-core";
import { compileProject, type ElectricalIr } from "@thermite/compiler";
import { renderSchematicPacket, type RenderedPacket } from "@thermite/render";
import { buildDocumentation } from "@thermite/query";
import { documentationFixture } from "../../query/test/documentation-fixture.js";
import { browserPath, launchBrowser } from "./helpers/pdf-raster.js";
import { openSheet } from "../../../evals/draw/browser.mjs";
import { identifierFindings } from "../../../evals/draw/identifier-checks.mjs";

import { reportScaleScript } from "../../../evals/draw/report-scale.mjs";

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
      expect(await page.evaluate(reportScaleScript), medium).toEqual([]);
    }
  }
}

describe.skipIf(!browserPath)(
  "report glyph-scale bound in SVG and HTML",
  () => {
    it("measures a positioned tspan break rather than counting parent text nodes", async () => {
      const g = await openSheet(
        page,
        `<svg xmlns="http://www.w3.org/2000/svg" width="200mm" height="100mm" viewBox="0 0 200 100"><g data-report-row="row"><rect x="10" y="10" width="100" height="30" stroke="#9ba6b4"/><g data-report-column="1"><text x="12" y="16" font-size="2.6"><tspan>CR-MOTOR-</tspan><tspan x="12" dy="3.6">START-101</tspan></text></g></g></svg>`,
      );
      expect(g.texts).toHaveLength(1);
      expect(
        g.texts[0].reportRuns.map((r: { text: string }) => r.text),
      ).toEqual(["CR-MOTOR-", "START-101"]);
      const table = {
        kind: "cables",
        columns: ["Cable"],
        rows: [{ key: "row", cells: ["CR-MOTOR-START-101"], deviceUids: [] }],
      };
      expect(identifierFindings(g, table, {})).toMatchObject([
        { kind: "identifier-line-break", lineCount: 2 },
      ]);
    });
    it("rejects an empty selector and detects forced scale on report titles and notes", async () => {
      await page.setContent(
        '<svg xmlns="http://www.w3.org/2000/svg"><text>Not a report</text></svg>',
      );
      expect(await page.evaluate(reportScaleScript)).toEqual([
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
            (await page.evaluate(reportScaleScript)).some(
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
          (await page.evaluate(reportScaleScript)).length > 0,
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
          (await page.evaluate(reportScaleScript)).length > 0,
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
