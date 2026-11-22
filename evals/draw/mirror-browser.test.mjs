import { beforeAll, afterAll, it, expect } from "vitest";
import { launchBrowser } from "../../packages/cli/test/helpers/pdf-raster.ts";
import {
  drawingContextOptions,
  openSheet,
  displaySheet,
  sheetMeasurementSource,
} from "./browser.mjs";
import { embedPrintableFont } from "../../packages/cli/dist/printable-font.js";
import { mirrorReturns } from "./mirror-returns.mjs";
import { mirrorFixture } from "./mirror-fixture.mjs";
let browser, context, page;
beforeAll(async () => {
  browser = await launchBrowser();
  context = await browser.newContext(drawingContextOptions);
  page = await context.newPage();
});
afterAll(async () => {
  await context?.close();
  await browser?.close();
});
const grid =
  [1, 2, 3, 4, 5, 6]
    .map((n) => `<text x="${30 * n}" y="20" font-size="2.5">${n}</text>`)
    .join("") +
  ["A", "B", "C", "D"]
    .map(
      (n, i) => `<text x="10" y="${40 + 40 * i}" font-size="2.5">${n}</text>`,
    )
    .join("");
const body = (i) =>
  `<g data-navigation-view="v${i}"><g data-device-uid="k"><g><g><rect class="circuit-device-frame" x="20" y="30" width="30" height="25" fill="none" stroke="black"/></g></g><g class="symbol" data-function-key="${i ? "no" : "coil"}"><path d="M30 36 H40 V44 H30 Z" fill="none" stroke="black"/>${(i ? ["13", "14"] : ["A1", "A2"]).map((t, j) => `<circle class="terminal-marker" data-terminal-key="${t}" cx="${30 + j * 10}" cy="40" r=".4" fill="white" stroke="black"/>`).join("")}</g></g></g>`;
const mirror = `<g data-navigation-role="mirror" data-navigation-annotation="a0"><text x="30" y="70" font-size="3.782">K1</text><g data-navigation-mirror-row="{&quot;deviceUid&quot;:&quot;k&quot;,&quot;functionKey&quot;:&quot;no&quot;}"><text x="30" y="76" font-size="3.502">NO</text><text x="40" y="76" font-size="3.502">13–14</text><text x="65" y="76" font-size="3.502">02.A1</text></g><g data-navigation-mirror-row="{&quot;deviceUid&quot;:&quot;k&quot;,&quot;functionKey&quot;:&quot;nc&quot;}"><text x="30" y="82" font-size="3.502">NC</text><text x="40" y="82" font-size="3.502">21–22</text><text x="65" y="82" font-size="3.502">not drawn</text></g></g>`;
const ret = `<g data-navigation-role="return" data-navigation-annotation="a1"><text x="30" y="70" font-size="3.502">K1 /01.A1</text></g>`;
const svg = (ink) =>
  embedPrintableFont(
    `<svg xmlns="http://www.w3.org/2000/svg" width="200mm" height="200mm" viewBox="0 0 200 200" font-family="Thermite Sans, Thermite Math, sans-serif">${grid}${ink}</svg>`,
  );
it("DQ-07 browser ink oracle catches hidden, occluded, forged row and stripped locators with nested native frames", async () => {
  const f = mirrorFixture(),
    second = await openSheet(page, svg(body(1) + ret));
  const audit = async (ink) =>
    mirrorReturns(
      f.packet,
      [await openSheet(page, svg(ink)), second],
      f.ir,
      f.request,
    );
  expect((await audit(body(0) + mirror)).findings).toEqual([]);
  for (const ink of [
    mirror.replace(">NO<", ">NC<"),
    mirror.replace("02.A1", "02.D6"),
    mirror.replace(
      'y="76" font-size="3.502">NO',
      'y="76" opacity="0" font-size="3.502">NO',
    ),
    mirror.replace('data-navigation-annotation="a0"', ""),
    mirror + '<rect x="28" y="71" width="60" height="8" fill="white"/>',
  ])
    expect((await audit(body(0) + ink)).findings.length).toBeGreaterThan(0);
  const g = await openSheet(page, svg(body(0) + mirror));
  const frame = g.shapes.find((s) => s.outline).bbox;
  for (const [key, value] of Object.entries({ x: 20, y: 30, w: 30, h: 25 }))
    expect(frame[key]).toBeCloseTo(value, 6);
});
it("DQ-07 stripped body and terminal ownership and a dropped seed retain a native selected obligation", async () => {
  const f = mirrorFixture();
  f.request.views[0].groups = [
    { functions: [{ device: { by: "uid", value: "k" }, key: "coil" }] },
  ];
  const stripped = body(0)
    .replace('data-device-uid="k"', "")
    .replace('data-function-key="coil"', "")
    .replaceAll(/data-terminal-key="[^"]*"/g, "");
  const gs = [
    await openSheet(page, svg(stripped + mirror)),
    await openSheet(page, svg(body(1) + ret)),
  ];
  expect(
    mirrorReturns(f.packet, gs, f.ir, f.request).findings.map((f) => f.kind),
  ).toContain("navigation-selected-appearance-missing");
  f.packet.navigation.occurrences = [];
  expect(
    mirrorReturns(f.packet, gs, f.ir, f.request).findings.map((f) => f.kind),
  ).toContain("navigation-selected-appearance-missing");
});
it("Q5 route-only browser capture keeps actual transforms and clips", async () => {
  await displaySheet(
    page,
    svg(
      '<svg x="20" y="30" width="50" height="50" viewBox="0 0 100 100"><path data-wire-uid="w" d="M-20 20 H120 V40" fill="none" stroke="black"/></svg>',
    ),
  );
  const g = await page.evaluate(
    (source) => (0, eval)(`(${source})`)({ routesOnly: true }),
    sheetMeasurementSource(),
  );
  expect(g.shapes).toHaveLength(1);
  for (const [key, value] of Object.entries({ x: 20, y: 30, w: 50, h: 50 }))
    expect(g.shapes[0].viewport[key]).toBeCloseTo(value, 6);
  expect(g.shapes[0].routeMatrix[0]).toBeCloseTo(0.5);
});
it("DQ-07 circuit terminal interfaces outside the glyph scope share their native circuit appearance", async () => {
  const f = mirrorFixture();
  const coil =
    '<g data-navigation-view="v0"><g data-device-uid="k" data-circuit-functions="[{&quot;deviceUid&quot;:&quot;k&quot;,&quot;functionKey&quot;:&quot;coil&quot;}]"><g data-function-key="coil"><rect data-circuit-role="body" x="30" y="36" width="10" height="8" fill="none" stroke="black"/></g><circle class="terminal-marker" data-terminal-key="A1" cx="25" cy="40" r=".4" fill="white" stroke="black"/><circle class="terminal-marker" data-terminal-key="A2" cx="45" cy="40" r=".4" fill="white" stroke="black"/></g></g>';
  const gs = [
    await openSheet(page, svg(coil + mirror)),
    await openSheet(page, svg(body(1) + ret)),
  ];
  expect(mirrorReturns(f.packet, gs, f.ir, f.request).findings).toEqual([]);
});
it("DQ-07 frames are visible native frame ink; unclassed decorations and clipped-out frames do not win ownership", async () => {
  const f = mirrorFixture(),
    second = await openSheet(page, svg(body(1) + ret));
  const check = async (extra) =>
    mirrorReturns(
      f.packet,
      [await openSheet(page, svg(body(0) + mirror + extra)), second],
      f.ir,
      f.request,
    );
  const decorative =
    '<g data-device-uid="foreign"><rect x="28" y="64" width="60" height="25" fill="none" stroke="black"/></g>';
  expect((await check(decorative)).findings).toEqual([]);
  const clipped =
    '<svg x="0" y="0" width="100" height="60" viewBox="0 0 100 60"><g data-device-uid="foreign"><g><rect class="device-frame" x="28" y="64" width="60" height="25" fill="none" stroke="black"/></g></g></svg>';
  expect((await check(clipped)).findings).toEqual([]);
  const visible = clipped.replace(
    'height="60" viewBox="0 0 100 60"',
    'height="71" viewBox="0 0 100 71"',
  );
  expect((await check(visible)).findings.map((f) => f.kind)).toContain(
    "mirror-locality",
  );
});
it("S1c actual role-stripped table ink remains discoverable on both needed and unneeded coils", async () => {
  const f = mirrorFixture();
  delete f.packet.navigation.annotations[0].role;
  const ink = mirror.replace('data-navigation-role="mirror"', "");
  const first = await openSheet(page, svg(body(0) + ink));
  const second = await openSheet(page, svg(body(1) + ret));
  const rows = first.texts.filter((t) => t.navigationAnnotation === "a0");
  expect(rows.length).toBeGreaterThan(0);
  expect(rows.every((t) => t.navigationRole === undefined)).toBe(true);
  expect(rows.some((t) => t.mirrorRow)).toBe(true);
  expect(
    mirrorReturns(f.packet, [first, second], f.ir, f.request).findings,
  ).toEqual([]);
  f.ir.functions = f.ir.functions.filter((fn) => fn.kind !== "contact");
  f.ir.internalRelations = [];
  f.packet.navigation.occurrences = f.packet.navigation.occurrences.filter(
    (o) => o.id === "o0",
  );
  f.packet.navigation.seeds = f.packet.navigation.seeds.filter(
    (s) => s.source.functionKey === "coil",
  );
  f.packet.navigation.annotations = f.packet.navigation.annotations.filter(
    (a) => a.id === "a0",
  );
  const empty = await openSheet(page, svg(""));
  const clean = await openSheet(page, svg(body(0)));
  expect(
    mirrorReturns(f.packet, [clean, empty], f.ir, f.request).findings,
  ).toEqual([]);
  expect(
    mirrorReturns(f.packet, [first, empty], f.ir, f.request).findings,
  ).toContainEqual(
    expect.objectContaining({
      kind: "mirror-block-count",
      expected: 0,
      actual: 1,
    }),
  );
});
