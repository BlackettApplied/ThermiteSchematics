import { beforeAll, afterAll, expect, it } from "vitest";
import { compileProject } from "../../packages/compiler/dist/index.js";
import { renderSchematicPacket } from "../../packages/render/dist/index.js";
import { embedPrintableFont } from "../../packages/cli/dist/printable-font.js";
import { launch, displaySheet, drawingContextOptions } from "./browser.mjs";
import { nativeStrip } from "./terminal-strip-native.mjs";
import { stripInkScript } from "./terminal-strip-ink.mjs";
import { checkTerminalStrip } from "./terminal-strip-check.mjs";
let browser, context, page, native, ink, svg;
const empty = () => ({
  terminals: [],
  bridges: [],
  incidences: [],
  unclaimed: [],
  rows: [],
  references: [],
  headings: [],
  notes: [],
  texts: [],
  continuations: [],
  bridgeLabels: [],
});
beforeAll(async () => {
  const c = await compileProject("examples/motor-starter");
  if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
  const d = c.ir.devices.find((d) => d.designation === "TB1");
  native = nativeStrip(c.ir, [d.uid]);
  const r = await renderSchematicPacket(c.ir, {
    format: "schematic-packet-request/0.1",
    index: false,
    views: [
      {
        format: "documentation-view-request/0.1",
        kind: "terminals",
        device: "TB1",
      },
    ],
  });
  if (!r.ok) throw Error(r.error.message);
  browser = await launch();
  context = await browser.newContext(drawingContextOptions);
  page = await context.newPage();
  ink = empty();
  for (const s of r.value.sheets) {
    await displaySheet(page, embedPrintableFont(s.svg));
    const measured = await page.evaluate(stripInkScript);
    for (const k of Object.keys(ink)) ink[k].push(...measured[k]);
    if (measured.terminals.length) svg = embedPrintableFont(s.svg);
  }
}, 30000);
afterAll(async () => {
  await context?.close();
  await browser?.close();
});
it("measures native order and coverage with separate TB1.2 approaches", () => {
  expect(checkTerminalStrip(native, ink).findings).toEqual([]);
});
it.each([
  ["missing bridge", (x) => x.bridges.pop(), "strip-bridge-geometry"],
  [
    "extra bridge",
    (x) => x.bridges.push({ ...x.bridges[0], uid: "invented" }),
    "strip-extra-bridge",
  ],
  [
    "wrong order",
    (x) => {
      [x.terminals[0].rect, x.terminals[1].rect] = [
        x.terminals[1].rect,
        x.terminals[0].rect,
      ];
    },
    "strip-wrong-order",
  ],
  [
    "invented accessory",
    (x) => x.unclaimed.push({ tag: "rect", bbox: { x: 0, y: 0, w: 4, h: 4 } }),
    "strip-invented-hardware-or-bridge",
  ],
  [
    "false native identity over wrong geometry",
    (x) => (x.bridges[0].points[0] = { x: -100, y: -100 }),
    "strip-bridge-geometry",
  ],
  [
    "wrong peer",
    (x) => (x.incidences[0].text = "W1 → invented.99"),
    "strip-conductor-incidence",
  ],
])("rejects %s", (name, mutate, kind) => {
  const changed = structuredClone(ink);
  mutate(changed);
  const result = checkTerminalStrip(native, changed);
  expect(result.assessment).toBe("fail");
  expect(result.findings.some((f) => f.kind === kind)).toBe(true);
});
it("rejects missing bridge ink while the native UID attribute remains", async () => {
  await displaySheet(
    page,
    svg.replace(
      /(<g data-strip-jumper="[^"]+"><path[^>]+)\/>/u,
      '$1 style="display:none"/>',
    ),
  );
  const changed = await page.evaluate(stripInkScript);
  changed.rows = ink.rows;
  changed.references = ink.references;
  expect(
    checkTerminalStrip(native, changed).findings.some(
      (f) => f.kind === "strip-bridge-geometry",
    ),
  ).toBe(true);
});

it("measures reciprocal native continuations and split jumper ends across actual strip sheets", async () => {
  const { longStrip } =
    await import("../../packages/render/test/terminal-strip-pagination-fixture.ts");
  const { ir } = longStrip(),
    r = await renderSchematicPacket(ir, {
      format: "schematic-packet-request/0.1",
      page: { size: "letter", orientation: "landscape" },
      index: true,
      references: false,
      views: [
        { format: "documentation-view-request/0.1", kind: "bom" },
        {
          format: "documentation-view-request/0.1",
          kind: "terminals",
          device: "XT-LONG",
        },
      ],
    });
  if (!r.ok) throw Error(JSON.stringify(r.error));
  const collected = empty();
  for (const s of r.value.sheets.filter((s) =>
    ["terminals", "terminal-strip"].includes(s.view.kind),
  )) {
    await displaySheet(page, embedPrintableFont(s.svg));
    const m = await page.evaluate(stripInkScript);
    for (const key of Object.keys(collected)) collected[key].push(...m[key]);
  }
  const n = nativeStrip(ir, ["native-strip"]);
  expect(collected.continuations.length).toBeGreaterThan(0);
  expect(checkTerminalStrip(n, collected).findings).toEqual([]);
  for (const mutate of [
    (x) => x.continuations.pop(),
    (x) =>
      (x.continuations[0].text =
        "XT-LONG continued on sheet 99.D6 at terminal invented"),
    (x) => x.bridges.pop(),
  ]) {
    const changed = structuredClone(collected);
    mutate(changed);
    expect(checkTerminalStrip(n, changed).assessment).toBe("fail");
  }
});
