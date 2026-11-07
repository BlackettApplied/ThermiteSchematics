import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { compileProject } from "@thermite/compiler";
import { renderSchematicPacket } from "../../render/src/sheets.js";
import { launchBrowser, browserPath } from "./helpers/pdf-raster.js";
import { wiringOutlineDistances } from "./helpers/svg-outline-geometry.js";

type Row = { file: string; text: string; dev: number };
type Actual = { file: string; text: string; distance: number };
function assertBaseline(rows: Row[], actual: Actual[]) {
  let count = 0;
  for (const flow of ["left-to-right", "top-to-bottom"]) {
    const used = new Map<string, number>();
    for (const row of rows.filter((r) =>
      r.file.startsWith(`operator-console-${flow}/`),
    )) {
      const file = row.file.split("/").at(-1)!,
        key = file + "|" + row.text,
        n = used.get(key) ?? 0;
      used.set(key, n + 1);
      const a = actual.filter((a) => a.file === file && a.text === row.text)[n];
      expect(a, key).toBeDefined();
      expect(
        Number((a!.distance - row.dev).toFixed(4)),
        key,
      ).toBeLessThanOrEqual(0.0128);
      count++;
    }
  }
  expect(count).toBe(132);
}

it.skipIf(!browserPath)(
  "keeps wiring-label outline boxes within 0.0128 mm of their frozen own-conductor layout distance",
  async () => {
    const baseline = JSON.parse(
      await readFile(
        new URL("./operator-console-label-baseline.json", import.meta.url),
        "utf8",
      ),
    );
    expect(baseline.format).toBe("operator-console-label-baseline/2.0");
    expect(baseline.base).toBe("d7f10b3439540b88a4546b1f754c44b763029b44");
    const fontHashes = await Promise.all(
      ["NotoSans-Regular", "NotoSans-Bold", "NotoSansMath-Regular"].map(
        async (name) => [
          name,
          createHash("sha256")
            .update(
              await readFile(
                new URL(
                  `../../render/assets/fonts/${name}.ttf`,
                  import.meta.url,
                ),
              ),
            )
            .digest("hex"),
        ],
      ),
    );
    expect(baseline.fontSha256).toEqual(Object.fromEntries(fontHashes));
    const c = await compileProject("examples/operator-console");
    if (!c.ok) throw Error(JSON.stringify(c));
    const request = JSON.parse(
        await readFile("examples/operator-console/packet.request.json", "utf8"),
      ),
      r = await renderSchematicPacket(c.ir, request, c.presentation);
    if (!r.ok) throw Error(JSON.stringify(r));
    const browser = await launchBrowser(),
      page = await browser.newPage(),
      actual: Actual[] = [];
    try {
      for (const s of r.value.sheets) {
        const rows = await wiringOutlineDistances(page, s.svg);
        actual.push(
          ...rows.map((row) => ({
            ...row,
            file: `sheet-${String(s.number).padStart(3, "0")}.svg`,
          })),
        );
      }
      expect(actual).toHaveLength(66); // Wiring has no flow; both legacy flow captures cover these same instances.
      assertBaseline(baseline.rows, actual);
      await wiringOutlineDistances(page, r.value.sheets[0]!.svg);
      const mutated = await page.evaluate(() => {
        const t = [
          ...document.querySelectorAll<SVGTextElement>(
            "[data-wiring-conductor] text",
          ),
        ].find((t) => t.textContent === "W-C01")!;
        // This label sits above a horizontal route: move 0.1 mm away from it.
        t.setAttribute("y", String(Number(t.getAttribute("y")) - 0.1));
        return document.querySelector("svg")!.outerHTML;
      });
      const changed = await wiringOutlineDistances(page, mutated),
        bad = actual.map((row) =>
          row.file === "sheet-001.svg" && row.text === "W-C01"
            ? {
                ...row,
                distance: changed.find((t) => t.text === "W-C01")!.distance,
              }
            : row,
        );
      const target = (rows: Actual[]) =>
        rows.find(
          (row) => row.file === "sheet-001.svg" && row.text === "W-C01",
        )!;
      expect(target(bad).distance - target(actual).distance).toBeCloseTo(
        0.1,
        5,
      );
      expect(() => assertBaseline(baseline.rows, bad)).toThrow();
    } finally {
      await page.close();
      await browser.close();
    }
  },
);
