import { beforeAll, afterAll, expect, it } from "vitest";
import { compileProject } from "../../packages/compiler/dist/index.js";
import { renderSchematicSheets } from "../../packages/render/dist/index.js";
import { embedPrintableFont } from "../../packages/cli/dist/printable-font.js";
import { launch, displaySheet, drawingContextOptions } from "./browser.mjs";
import { nativeStrip } from "./terminal-strip-native.mjs";
import { stripInkScript } from "./terminal-strip-ink.mjs";
import { buildDocumentation } from "../../packages/query/dist/index.js";
import { stripInventoryEquality } from "./terminal-strip-inventory.mjs";
import { checkTerminalStrip } from "./terminal-strip-check.mjs";
let browser, context, page;
beforeAll(async () => {
  browser = await launch();
  context = await browser.newContext(drawingContextOptions);
  page = await context.newPage();
});
afterAll(async () => {
  await context?.close();
  await browser?.close();
});
it.each(["examples/motor-starter", "examples/conveyor-line"])(
  "independently obligates physical CBL1 cores and rejects dropped/wrong-peer ink: %s",
  async (project) => {
    const c = await compileProject(project);
    if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
    const devices = c.ir.devices.filter((d) =>
      ["TB1", "JB1"].includes(d.designation),
    );
    const native = nativeStrip(
      c.ir,
      devices.map((d) => d.uid),
    );
    const cable = c.ir.cables.find((c) => c.designation === "CBL1");
    const coreId = JSON.stringify([cable.uid, "2-"]);
    expect(native.incidences.filter((i) => i.id === coreId)).toHaveLength(2);
    const r = await renderSchematicSheets(c.ir, {
      format: "documentation-view-request/0.1",
      kind: "terminals",
    });
    if (!r.ok) throw Error(JSON.stringify(r.error));
    const ink = {};
    for (const s of r.value.sheets) {
      await displaySheet(page, embedPrintableFont(s.svg));
      const m = await page.evaluate(stripInkScript);
      for (const [key, values] of Object.entries(m))
        (ink[key] ??= []).push(...values);
    }
    const table = buildDocumentation(c.ir, {
      format: "documentation-view-request/0.1",
      kind: "terminals",
    });
    expect(stripInventoryEquality(table, ink).findings).toEqual([]);
    expect(checkTerminalStrip(native, ink).findings).toEqual([]);
    for (const mutate of [
      (x) => {
        x.incidences = x.incidences.filter((i) => i.id !== coreId);
      },
      (x) => {
        x.incidences.find((i) => i.id === coreId).text =
          "CBL1/2- → invented.99";
      },
    ]) {
      const changed = structuredClone(ink);
      mutate(changed);
      expect(
        stripInventoryEquality(table, changed).findings.length,
      ).toBeGreaterThan(0);
      expect(
        checkTerminalStrip(native, changed).findings.some(
          (f) => f.kind === "strip-conductor-incidence" && f.id === coreId,
        ),
      ).toBe(true);
    }
  },
);
it("retains single-ended spare obligations and deduplicates cores in both native representations", async () => {
  const c = await compileProject("examples/motor-starter");
  if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
  const cable = c.ir.cables.find((c) => c.designation === "CBL1");
  const cores = c.ir.cableConductors.filter((k) => k.cableUid === cable.uid);
  const first = cores.find((k) => k.id.conductorId === "1+");
  const spare = cores.find((k) => k.id.conductorId === "2+");
  cable.assignments = [
    { id: "1+", usage: "in-use", endpoints: first.endpoints },
    { id: "2+", usage: "spare", endpoints: [spare.endpoints[0], null] },
  ];
  const native = nativeStrip(
    c.ir,
    c.ir.devices
      .filter((d) => ["TB1", "JB1"].includes(d.designation))
      .map((d) => d.uid),
  );
  expect(
    native.incidences.filter((i) => i.id === JSON.stringify([cable.uid, "1+"])),
  ).toHaveLength(2);
  const drawn = native.incidences.filter(
    (i) => i.id === JSON.stringify([cable.uid, "2+"]),
  );
  expect(drawn).toHaveLength(1);
  expect(drawn[0].peer).toBe("Unterminated");
});
it("keeps bridge-number glyphs clear of fanned conductor leader ink", async () => {
  const c = await compileProject("examples/operator-console");
  if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
  const r = await renderSchematicSheets(
    c.ir,
    {
      format: "documentation-view-request/0.1",
      kind: "terminals",
      device: "XT-HMI",
    },
    undefined,
    { size: "a3", orientation: "portrait" },
  );
  if (!r.ok) throw Error(JSON.stringify(r.error));
  const sheets = r.value.sheets.filter((s) => s.view.kind === "terminal-strip");
  expect(sheets).toHaveLength(1);
  await displaySheet(page, embedPrintableFont(sheets[0].svg));
  const collisions = await page.evaluate(() => {
    const labels = [
      ...document.querySelectorAll(
        "[data-strip-jumper]:not([data-strip-jumper-end]) > text",
      ),
    ];
    const paths = [...document.querySelectorAll("[data-strip-incidence] path")];
    return labels.flatMap((label) => {
      const b = label.getBBox();
      return paths
        .filter((path) => {
          const length = path.getTotalLength();
          for (let d = 0; d <= length; d += 0.1) {
            const p = path.getPointAtLength(d);
            if (
              p.x >= b.x - 0.3 &&
              p.x <= b.x + b.width + 0.3 &&
              p.y >= b.y - 0.3 &&
              p.y <= b.y + b.height + 0.3
            )
              return true;
          }
          return false;
        })
        .map((path) => ({
          label: label.textContent,
          incidence: path.parentElement.getAttribute("data-strip-incidence"),
        }));
    });
  });
  expect(collisions).toEqual([]);
});
