import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { compileProject } from "@thermite/compiler";
import { renderSchematicPacket } from "../../render/src/sheets.js";
import { launchBrowser, browserPath } from "./helpers/pdf-raster.js";
import type { Page } from "playwright-core";
import {
  svgOutlineGeometry,
  wiringOutlineDistances,
} from "./helpers/svg-outline-geometry.js";

type Row = { file: string; text: string; dev: number };
type Actual = { file: string; text: string; distance: number; leader: boolean };
const DISTANCE_WITNESS = "W-C01";
async function labelMovedAway(page: Page, svg: string, gap: number) {
  const geometry = await svgOutlineGeometry(page, svg, true),
    label = geometry.texts.find((t) => t.text === DISTANCE_WITNESS);
  if (!label) throw Error("Missing mutation target W-C01");
  const runs = geometry.shapes
    .filter((s) => s.wire === label.wire)
    .flatMap((s) =>
      s.points.slice(1).flatMap((b, i) => {
        const a = s.points[i];
        if (
          !a ||
          a.y !== b.y ||
          Math.min(a.x, b.x) > label.box.left ||
          Math.max(a.x, b.x) < label.box.right
        )
          return [];
        return [{ y: a.y, stroke: s.stroke }];
      }),
    )
    .sort(
      (a, b) =>
        Math.abs(a.y - label.box.bottom) - Math.abs(b.y - label.box.bottom),
    );
  const run = runs[0];
  if (!run) throw Error("Mutation target has no supporting horizontal run");
  // Detach the annotation and translate its plate past the frozen direct
  // distance by 0.1 mm to exercise the original no-leader limit.
  const shift =
    (run.y - run.stroke / 2 - gap - label.box.bottom) / label.matrix[3];
  return page.evaluate(
    ({ shift, witness }) => {
      const text = [
          ...document.querySelectorAll<SVGTextElement>(
            "[data-wiring-conductor] text",
          ),
        ].find((t) => t.textContent === witness),
        plate = text?.previousElementSibling,
        root = document.querySelector("svg");
      if (!text || plate?.tagName.toLowerCase() !== "rect" || !root)
        throw Error("Missing complete mutation target");
      const owner = text
        .closest("[data-wiring-conductor]")
        ?.getAttribute("data-wiring-conductor");
      const leader = [
        ...root.querySelectorAll("[data-label-leader-owner]"),
      ].find(
        (candidate) =>
          candidate.getAttribute("data-label-leader-owner") === owner,
      );
      if (
        leader?.nextElementSibling?.classList.contains(
          "wire-label-leader-arrow",
        )
      )
        leader.nextElementSibling.remove();
      leader?.remove();
      text.setAttribute("transform", `translate(0 ${shift})`);
      plate.setAttribute("transform", `translate(0 ${shift})`);
      return root.outerHTML;
    },
    { shift, witness: DISTANCE_WITNESS },
  );
}
function assertBaseline(rows: Row[], actual: Actual[]) {
  let count = 0,
    led = 0;
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
      if (a?.leader) led++;
      else
        expect(
          Number((a!.distance - row.dev).toFixed(4)),
          key,
        ).toBeLessThanOrEqual(0.0128);
      count++;
    }
  }
  expect(count).toBe(132);
  expect(led).toBe(16); // Four complete two-line leader plates in each flow.
}

async function assertInlineDistanceControl(
  page: Page,
  svg: string,
  baseline: Row[],
  actual: Actual[],
) {
  const frozen: Row = baseline.find(
    (row: Row) =>
      row.file === "operator-console-left-to-right/sheet-001.svg" &&
      row.text === DISTANCE_WITNESS,
  );
  expect(frozen).toBeDefined();
  const mutated = await labelMovedAway(page, svg, frozen.dev + 0.1);
  const changed = await wiringOutlineDistances(page, mutated),
    bad = actual.map((row) =>
      row.file === "sheet-001.svg" && row.text === DISTANCE_WITNESS
        ? {
            ...row,
            ...changed.find((t) => t.text === DISTANCE_WITNESS)!,
          }
        : row,
    );
  const target = (rows: Actual[]) =>
    rows.find(
      (row) => row.file === "sheet-001.svg" && row.text === DISTANCE_WITNESS,
    )!;
  expect(target(bad).distance - frozen.dev).toBeCloseTo(0.1, 5);
  expect(() => assertBaseline(baseline, bad)).toThrow();
}

it.skipIf(!browserPath)(
  "preserves frozen inline distances and measures leader attachments to the owning conductor",
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
      await assertInlineDistanceControl(
        page,
        r.value.sheets[0]!.svg,
        baseline.rows,
        actual,
      );
    } finally {
      await page.close();
      await browser.close();
    }
  },
);
