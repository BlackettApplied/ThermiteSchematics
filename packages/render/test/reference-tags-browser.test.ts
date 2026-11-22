import { afterAll, beforeAll, expect, it } from "vitest";
import { compileProject } from "@thermite/compiler";
import { buildCableSchedule } from "@thermite/query";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initializeAlphaProject } from "../../cli/src/alpha-init.js";
import { renderSchematicPacket } from "../src/sheets.js";
import { cableEndpointCards } from "../src/packet/cable-annotations.js";
import {
  cableCorePages,
  cableReferenceHeight,
} from "../src/packet/cable-reference-tags.js";
import { flows, offViewFixture } from "./off-view-fixtures.js";
import {
  launch,
  openSheet,
  drawingContextOptions,
} from "../../../evals/draw/browser.mjs";
import { deviceTags } from "../../../evals/draw/checks.mjs";
let browser: Awaited<ReturnType<typeof launch>>, page: any;
beforeAll(async () => {
  browser = await launch();
  page = await (await browser.newContext(drawingContextOptions)).newPage();
});
afterAll(async () => {
  await browser?.close();
});
async function reversedCabinets() {
  const parent = await realpath(
      await mkdtemp(join(tmpdir(), "thermite-c4-cable-")),
    ),
    root = join(parent, "project");
  try {
    await initializeAlphaProject(root, {
      template: "cabinets",
    });
    const file = join(root, "devices/equipment.json"),
      source = JSON.parse(await readFile(file, "utf8")),
      cable = source.objects.find((o: any) => o.kind === "cable");
    cable.conductors[2] = {
      id: "2+",
      usage: "in-use",
      endpoints: [
        { device: "TB2", terminal: "3" },
        { device: "TB1", terminal: "3" },
      ],
    };
    await writeFile(file, JSON.stringify(source));
    const compiled = await compileProject(root);
    if (!compiled.ok) throw compiled;
    return {
      ...compiled,
      dispose: () => rm(parent, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(parent, { recursive: true, force: true });
    throw error;
  }
}
it.each(flows)(
  "lists each cable UID in the first referencing end block when core 3 is reversed in %s",
  async (flow) => {
    const c = await reversedCabinets();
    try {
      const before = JSON.stringify(c.ir),
        result = await renderSchematicPacket(
          c.ir,
          {
            format: "schematic-packet-request/0.1",
            views: [
              {
                format: "schematic-view-request/0.2",
                root: { by: "designation", value: "CBL1" },
                intent: { kind: "conductors" },
                flow,
              },
            ],
          },
          c.presentation,
        );
      if (!result.ok) throw result;
      const sheet = result.value.sheets[0]!,
        g = await openSheet(page, sheet.svg);
      expect(deviceTags(g, c.ir, sheet.references, true)).toEqual([]);
      expect(g.deviceLegendEntries).toHaveLength(2);
      expect(g.deviceLegendEntries.every((e) => e.kind === "reference")).toBe(
        true,
      );
      expect(g.deviceReferenceEntries).toHaveLength(2);
      expect(
        new Set(g.deviceReferenceEntries.map((e) => e.deviceUid)).size,
      ).toBe(2);
      expect(g.deviceReferenceEntries.map((e) => e.key)).toEqual([
        "TB1.1",
        "TB2.3",
      ]);
      expect(await page.locator("[data-device-legend]").count()).toBe(1);
      expect(g.texts.some((t) => t.text === "TB2.1")).toBe(true);
      expect(g.devices).toEqual([]);
      expect(g.terminals).toEqual([]);
      expect(
        await page
          .locator("[data-device-legend-entry][data-device-uid]")
          .count(),
      ).toBe(0);
      expect(JSON.stringify(c.ir)).toBe(before);
    } finally {
      await c.dispose();
    }
  },
);
it.each(flows)(
  "keys rail-only devices once in the existing frame without adding appearances in %s",
  async (flow) => {
    const c = await compileProject("examples/machine-demo");
    if (!c.ok) throw c;
    const before = JSON.stringify(c.ir),
      result = await renderSchematicPacket(
        c.ir,
        {
          format: "schematic-packet-request/0.1",
          layout: "compact",
          views: [
            {
              format: "schematic-view-request/0.1",
              root: { by: "designation", value: "K1" },
              family: "control",
              flow,
            },
          ],
        },
        c.presentation,
      );
    if (!result.ok) throw result;
    let references = 0;
    for (const sheet of result.value.sheets) {
      const g = await openSheet(page, sheet.svg);
      expect(deviceTags(g, c.ir, sheet.references, true)).toEqual([]);
      const entries = g.deviceReferenceEntries;
      references += entries.length;
      expect(new Set(entries.map((e) => e.deviceUid)).size).toBe(
        entries.length,
      );
      for (const entry of entries) {
        expect(g.devices.some((d) => d.deviceUid === entry.deviceUid)).toBe(
          false,
        );
        expect(entry.key).toBe("PS1.-");
      }
      expect(await page.locator("[data-device-legend]").count()).toBe(1);
      expect(
        await page
          .locator("[data-device-reference-entry][data-device-uid]")
          .count(),
      ).toBe(0);
    }
    expect(references).toBeGreaterThan(0);
    expect(JSON.stringify(c.ir)).toBe(before);
  },
  60000,
);
it.each(flows)(
  "repeats complete cable endpoint blocks with exact endpoint text on every core page in %s",
  async (flow) => {
    const c = await offViewFixture();
    try {
      const before = JSON.stringify(c.ir),
        r = await renderSchematicPacket(c.ir, {
          format: "schematic-packet-request/0.1",
          page: { size: "letter", orientation: "portrait" },
          views: [
            {
              format: "schematic-view-request/0.2",
              root: { by: "designation", value: "CBL1" },
              intent: { kind: "conductors" },
              flow,
            },
          ],
        });
      if (!r.ok) throw r;
      for (const sheet of r.value.sheets) {
        const g = await openSheet(page, sheet.svg);
        expect(deviceTags(g, c.ir, sheet.references, true)).toEqual([]);
        expect(g.devices).toEqual([]);
        expect(g.terminals).toEqual([]);
        if (sheet.references.length)
          expect(g.deviceReferenceEntries.length).toBeGreaterThan(0);
        for (const entry of g.deviceReferenceEntries) {
          expect(
            g.texts.some(
              (t) =>
                t.tagTerminal &&
                t.tagOwnerUid === entry.deviceUid &&
                (t.text === entry.key || t.text === `Off-view at ${entry.key}`),
            ),
          ).toBe(true);
          expect(
            g.texts.some(
              (t) =>
                t.tagContainer === entry.container &&
                t.tagField === "description",
            ),
          ).toBe(true);
        }
        expect(sheet.continuations).toEqual([]);
      }
      expect(JSON.stringify(c.ir)).toBe(before);
    } finally {
      await c.dispose();
    }
  },
);
it("reserves prospective endpoint sets before accepting rows and never emits a block-only page", async () => {
  const c = await offViewFixture();
  try {
    const schedule = buildCableSchedule(c.ir, c.ir.cables[0]!.uid),
      core = schedule.cores[0]!;
    const many = {
        ...schedule,
        cores: Array.from({ length: 16 }, (_, i) => ({
          ...core,
          id: String(i + 1),
        })),
      },
      view = {
        format: "schematic-view/0.2",
        intent: "conductors",
        family: "control",
        flow: "left-to-right",
        root: { cableUid: schedule.cableUid },
      } as any,
      cards = many.cores.map(() => [undefined, undefined] as const),
      geometry = {
        left: 0,
        right: 180,
        jacketL: 63,
        jacketR: 117,
        height: 130,
      };
    const result = cableCorePages(c.ir, many, cards, view, geometry);
    if (!result.ok) throw result;
    expect(result.value.length).toBeGreaterThan(1);
    expect(result.value.flatMap((p) => p.rows.map((r) => r.core.id))).toEqual(
      many.cores.map((c) => c.id),
    );
    for (const p of result.value) {
      expect(p.rows.length).toBeGreaterThan(0);
      expect(p.blocks.filter(Boolean)).toHaveLength(2);
      expect(
        33 +
          cableReferenceHeight(p.blocks) +
          3 +
          p.rows.reduce((n, r) => n + r.height, 0) +
          24,
      ).toBeLessThanOrEqual(geometry.height);
    }
    const h = c.ir.devices.find((d) => d.designation === "H1")!,
      late = {
        ...core,
        id: "3",
        endpoints: [
          {
            ...core.endpoints[0]!,
            display: "H1.X1",
            terminal: { deviceUid: h.uid, terminalKey: "X1" },
          },
          core.endpoints[1],
        ] as typeof core.endpoints,
      },
      prospective = {
        ...schedule,
        cores: [{ ...core, id: "1" }, { ...core, id: "2" }, late],
      },
      baseHeader = cableReferenceHeight(result.value[0]!.blocks),
      rowHeight = result.value[0]!.rows[0]!.height;
    const introduced = cableCorePages(
      c.ir,
      prospective,
      cards.slice(0, 3),
      view,
      { ...geometry, height: 33 + baseHeader + 3 + 3 * rowHeight + 24 + 0.5 },
    );
    if (!introduced.ok) throw introduced;
    expect(introduced.value.map((p) => p.rows.map((r) => r.core.id))).toEqual([
      ["1", "2"],
      ["3"],
    ]);
    expect(
      introduced.value[1]!.blocks.flatMap(
        (b) => b?.entries.map((e) => e.tag.referenceKey) ?? [],
      ),
    ).toContain("H1.X1");
    const refused = cableCorePages(c.ir, many, cards, view, {
      ...geometry,
      height: 50,
    });
    expect(refused).toMatchObject({ ok: false, error: { code: "R006" } });
    if (!refused.ok)
      expect(refused.error.message).toContain(
        "row plus referenced-device blocks cannot fit",
      );
    const endpointCards = cableEndpointCards(c.ir, schedule, view, 55);
    if (!endpointCards.ok) throw endpointCards;
    const withContext = cableCorePages(
      c.ir,
      schedule,
      endpointCards.value,
      view,
      { ...geometry, height: 50 },
    );
    if (withContext.ok) throw Error("Expected row-fit refusal");
    expect(withContext.error.message).toContain("Endpoint cards: PS1.+:");
    expect(withContext.error.message).toContain("W1");
  } finally {
    await c.dispose();
  }
});
