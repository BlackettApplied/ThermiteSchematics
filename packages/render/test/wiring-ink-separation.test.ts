import { writeFile } from "node:fs/promises";
import { beforeAll, afterAll, expect, it } from "vitest";
import { renderSchematicPacket } from "../src/sheets.js";
import { consoleWiringFixture } from "./wiring-landings-fixture.js";
import { required } from "./fixtures.js";
import { launchBrowser } from "../../cli/test/helpers/pdf-raster.js";
import { svgOutlineGeometry } from "../../cli/test/helpers/svg-outline-geometry.js";

type Point = { x: number; y: number };
let fixture: Awaited<ReturnType<typeof consoleWiringFixture>>;
let packet: Extract<
  Awaited<ReturnType<typeof renderSchematicPacket>>,
  { ok: true }
>["value"];
let browser: Awaited<ReturnType<typeof launchBrowser>>;
beforeAll(async () => {
  fixture = await consoleWiringFixture();
  const r = await renderSchematicPacket(fixture.ir, fixture.request);
  if (!r.ok) throw Error(JSON.stringify(r.error));
  packet = r.value;
  browser = await launchBrowser();
});
afterAll(async () => {
  await browser?.close();
});
function runs(ps: readonly Point[]) {
  return ps.slice(1).map((b, i) => ({ a: required(ps[i]), b }));
}
function narrowRuns(
  a: { points: Point[]; stroke: number },
  b: { points: Point[]; stroke: number },
  marks: Point[],
) {
  const bad: unknown[] = [];
  for (const s of runs(a.points))
    for (const t of runs(b.points))
      for (const [axis, cross] of [
        ["x", "y"],
        ["y", "x"],
      ] as const) {
        if (
          Math.abs(s.a[cross] - s.b[cross]) > 1e-7 ||
          Math.abs(t.a[cross] - t.b[cross]) > 1e-7
        )
          continue;
        const lo = Math.max(
            Math.min(s.a[axis], s.b[axis]),
            Math.min(t.a[axis], t.b[axis]),
          ),
          hi = Math.min(
            Math.max(s.a[axis], s.b[axis]),
            Math.max(t.a[axis], t.b[axis]),
          );
        if (hi - lo <= 1e-7) continue;
        const clearGap =
          Math.abs(s.a[cross] - t.a[cross]) - (a.stroke + b.stroke) / 2;
        const shortFan = marks.some((m) =>
          [lo, hi].every((v) =>
            [s, t].every(
              (r) => Math.hypot(v - m[axis], r.a[cross] - m[cross]) <= 3 + 1e-7,
            ),
          ),
        );
        if (clearGap < 0.7 - 1e-7 && !shortFan)
          bad.push({ clearGap, axis, lo, hi });
      }
  return bad;
}
it.each([1, 4])(
  "keeps printed conductor ink 0.7 mm apart beyond a 3 mm fan-in, converging on the existing marks on console sheet %s",
  async (number) => {
    const page = await browser.newPage();
    try {
      const svg = required(packet.sheets.find((s) => s.number === number)).svg;
      const measured = await svgOutlineGeometry(page, svg, true);
      const marks = await terminalMarks(page);
      expect(measured.shapes).toHaveLength(number === 1 ? 5 : 3);
      const failures: unknown[] = [];
      for (const [i, a] of measured.shapes.entries()) {
        const wire = required(fixture.ir.wires.find((w) => w.uid === a.wire));
        expect(a.stroke).toBeCloseTo(0.35, 6);
        const ends = wire.endpoints.map((e) =>
          required(
            marks.find(
              (m) =>
                m.uid === e.terminal.deviceUid &&
                m.key === e.terminal.terminalKey,
            ),
          ),
        );
        const start = required(a.points[0]),
          end = required(a.points.at(-1));
        const distance = (p: Point, m: (typeof ends)[number]) =>
          Math.hypot(p.x - m.x, p.y - m.y) - m.radius;
        const first = required(ends[0]),
          last = required(ends[1]);
        expect(
          Math.min(
            Math.max(distance(start, first), distance(end, last)),
            Math.max(distance(start, last), distance(end, first)),
          ),
        ).toBeLessThanOrEqual(0.0011);
        for (const b of measured.shapes.slice(i + 1)) {
          const other = required(
            fixture.ir.wires.find((w) => w.uid === b.wire),
          );
          const common = ends.filter((m) =>
            other.endpoints.some(
              (e) =>
                e.terminal.deviceUid === m.uid &&
                e.terminal.terminalKey === m.key,
            ),
          );
          failures.push(...narrowRuns(a, b, common));
        }
      }
      if (process.env.THERMITE_LAYOUT_RECEIPTS)
        await writeFile(
          `${process.env.THERMITE_LAYOUT_RECEIPTS}/r2-n3-printed-ink-sheet-${number}.json`,
          JSON.stringify(
            { number, shapes: measured.shapes, marks, failures },
            null,
            2,
          ),
        );
      expect(failures).toEqual([]);
      expect(await page.locator("circle[data-wiring-junction]").count()).toBe(
        0,
      );
    } finally {
      await page.close();
    }
  },
);

async function terminalMarks(
  page: Awaited<ReturnType<typeof browser.newPage>>,
) {
  return page.evaluate(() => {
    const root = document.querySelector<SVGSVGElement>("svg");
    if (!root) throw Error("Missing sheet");
    const inverse = root.getScreenCTM()?.inverse();
    if (!inverse) throw Error("Missing sheet transform");
    return [
      ...document.querySelectorAll<SVGCircleElement>(
        "[data-device-uid] circle[data-terminal-key]",
      ),
    ]
      .filter(
        (c) =>
          getComputedStyle(c).stroke !== "none" ||
          getComputedStyle(c).fill !== "none",
      )
      .map((c) => {
        const matrix = c.getScreenCTM();
        if (!matrix) throw Error("Missing terminal transform");
        const m = inverse.multiply(matrix),
          p = new DOMPoint(
            c.cx.baseVal.value,
            c.cy.baseVal.value,
          ).matrixTransform(m);
        return {
          uid: c.closest("[data-device-uid]")?.getAttribute("data-device-uid"),
          key: c.getAttribute("data-terminal-key"),
          x: p.x,
          y: p.y,
          radius: c.r.baseVal.value * Math.hypot(m.a, m.b),
        };
      });
  });
}
