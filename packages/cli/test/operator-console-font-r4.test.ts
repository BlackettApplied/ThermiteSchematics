import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { compileProject } from "@thermite/compiler";
import { renderSchematicPacket } from "../../render/src/sheets.js";
import { embedPrintableFont } from "../src/printable-font.js";
import { launchBrowser, browserPath } from "./helpers/pdf-raster.js";
import { openSheet } from "../../../evals/draw/browser.mjs";
import { inside, throughBox } from "../../../evals/draw/checks.mjs";
import { printDiagnostics } from "./helpers/print-diagnostics.js";
it.skipIf(!browserPath)(
  "bounds the distinct operator-console wiring path against all 132 frozen dev label instances",
  async () => {
    const baseline = JSON.parse(
        await readFile(
          new URL("./operator-console-label-baseline.json", import.meta.url),
          "utf8",
        ),
      ),
      c = await compileProject("examples/operator-console");
    if (!c.ok) throw Error(JSON.stringify(c));
    const request = JSON.parse(
        await readFile("examples/operator-console/packet.request.json", "utf8"),
      ),
      r = await renderSchematicPacket(c.ir, request, c.presentation);
    if (!r.ok) throw Error(JSON.stringify(r));
    const browser = await launchBrowser(),
      actual: { file: string; text: string; distance: number }[] = [];
    try {
      for (const s of r.value.sheets) {
        const page = await browser.newPage();
        try {
          const g: any = await openSheet(page, embedPrintableFont(s.svg)),
            routes = g.shapes.filter((s: any) => s.conductor && s.wire);
          for (const t of g.texts.filter((t: any) => t.wire)) {
            const own = routes.filter((s: any) => s.wire === t.wire);
            if (!own.length) continue;
            const b = t.bbox,
              dist = (s: any) =>
                s.points.slice(1).reduce((best: number, p: any, i: number) => {
                  const a = s.points[i];
                  return Math.min(
                    best,
                    Math.hypot(
                      Math.max(
                        Math.min(p.x, a.x) - b.x - b.w,
                        b.x - Math.max(p.x, a.x),
                        0,
                      ),
                      Math.max(
                        Math.min(p.y, a.y) - b.y - b.h,
                        b.y - Math.max(p.y, a.y),
                        0,
                      ),
                    ),
                  );
                }, Infinity),
              inline =
                t.plate &&
                inside(t.bbox, t.plate.bbox) &&
                own.some((s: any) =>
                  s.points
                    .slice(1)
                    .some((p: any, i: number) =>
                      throughBox(s.points[i], p, t.plate.bbox, 0),
                    ),
                );
            actual.push({
              file: `sheet-${String(s.number).padStart(3, "0")}.svg`,
              text: t.text,
              distance: inline
                ? 0
                : Math.min(
                    ...own.map((s: any) =>
                      Math.max(0, dist(s) - (s.stroke ?? 0) / 2),
                    ),
                  ),
            });
          }
          const diagnosticWire = g.texts.find(
            (t: any) => t.text === "W-C01",
          )?.wire;
          await printDiagnostics(
            browser,
            page,
            s.svg,
            `operator-console-sheet-${s.number}`,
            ["W-C01", "16 AWG / Blue"],
            {
              labels: actual.filter(
                (row) =>
                  row.file === `sheet-${String(s.number).padStart(3, "0")}.svg`,
              ),
              wireTexts: g.texts
                .filter((t: any) => diagnosticWire && t.wire === diagnosticWire)
                .map((t: any) => ({
                  text: t.text,
                  bbox: t.bbox,
                  baselineShiftMm: t.baselineShiftMm,
                  advanceRatio: t.advanceRatio,
                  plate: t.plate,
                })),
              routes: routes
                .filter(
                  (route: any) =>
                    diagnosticWire && route.wire === diagnosticWire,
                )
                .map((route: any) => ({
                  wire: route.wire,
                  bbox: route.bbox,
                  stroke: route.stroke,
                  routePath: route.routePath,
                  routeMatrix: route.routeMatrix,
                })),
            },
          );
        } finally {
          await page.close();
        }
      }
    } finally {
      await browser.close();
    }
    let count = 0;
    for (const flow of ["left-to-right", "top-to-bottom"]) {
      const rows = baseline.rows.filter((r: any) =>
          r.file.startsWith(`operator-console-${flow}/`),
        ),
        used = new Map<string, number>();
      for (const row of rows) {
        const file = row.file.split("/").at(-1),
          key = file + "|" + row.text,
          n = used.get(key) ?? 0;
        used.set(key, n + 1);
        const a = actual.filter((a) => a.file === file && a.text === row.text)[
          n
        ];
        expect(a, key).toBeDefined();
        // Helm R4-16 accepts this separate path's sub-pixel bearing delta; no tolerance was enlarged.
        expect(
          Number((a!.distance - row.dev).toFixed(4)),
          key,
        ).toBeLessThanOrEqual(0.0128);
        count++;
      }
    }
    expect(count).toBe(132);
  },
);
