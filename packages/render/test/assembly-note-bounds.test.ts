import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { openSync } from "fontkit";
import { parseHTML } from "linkedom";
import BundledElk from "elkjs/lib/elk.bundled.js";
import type { ELK, ElkNode } from "elkjs/lib/elk-api.js";
import { compileProject, type ElectricalIr } from "@thermite/compiler";
import {
  prepareConnectorAssemblyDrawing,
  type ConnectorAssemblyViewRequest,
} from "../src/connector-assembly.js";
import { renderSchematicPacket } from "../src/sheets.js";
let ir: ElectricalIr, view: ConnectorAssemblyViewRequest;
const font = openSync(
  resolve("packages/cli/assets/fonts/NotoSans-Regular.ttf"),
);
if (!("unitsPerEm" in font)) throw new Error("Expected a single font.");
const width = (value: string, size: number) =>
  (font.layout(value).glyphs.reduce((total, g) => total + g.advanceWidth, 0) *
    size) /
  font.unitsPerEm;
beforeAll(async () => {
  const dir = resolve("examples/assembly-note-bounds");
  const c = await compileProject(dir);
  if (!c.ok) throw new Error(JSON.stringify(c.diagnostics));
  expect(c.diagnostics.map((d) => d.code)).toEqual(["W904", "W904"]);
  ir = c.ir;
  view = JSON.parse(await readFile(resolve(dir, "packet.json"), "utf8"))
    .views[0];
});
const noteRows = (svg: string) =>
  [...parseHTML(svg).document.querySelectorAll('text[font-size="2.5"]')].filter(
    (e) =>
      !e.parentElement?.closest("[data-device-uid], [data-assembly-label]"),
  );

describe("assembly note bounds", () => {
  it("reserves note space without losing the selected connector inventory", async () => {
    const before = JSON.stringify(ir),
      original = await prepareConnectorAssemblyDrawing(ir, view);
    const request = {
      format: "schematic-packet-request/0.1" as const,
      page: { size: "tabloid" as const, orientation: "landscape" as const },
      index: true,
      views: [view],
    };
    const r = await renderSchematicPacket(ir, request);
    if (!r.ok) throw new Error(r.error.message);
    const sheet = r.value.sheets[0]!,
      doc = parseHTML(sheet.svg).document;
    const group = [...doc.querySelectorAll("g[transform]")].find((g) =>
      g.getAttribute("transform")?.includes("scale("),
    )!;
    const scale = Number(
      group.getAttribute("transform")!.match(/scale\(([^)]+)\)/)![1],
    );
    expect(scale).toBeLessThan(1);
    expect(scale * 2.7).toBeGreaterThanOrEqual(2.5);
    expect(sheet.svg).toContain(original.content);
    expect(r.value.coverage.topology.counts.assemblies.represented).toBe(1);
    expect(r.value.coverage.topology.counts.connectorPorts.represented).toBe(
      10,
    );
    const mapping = r.value.coverage.topology.assemblies[0]!;
    const assembly = doc.querySelector("[data-connector-assembly]")!;
    expect(
      JSON.parse(assembly.getAttribute("data-assembly-endpoints")!),
    ).toEqual(mapping.endpoints);
    expect(assembly.getAttribute("data-pin-mapping")).toBe("unresolved");
    const rows = noteRows(sheet.svg);
    expect(rows.map((e) => e.textContent).join(" ")).toContain(view.notes![0]);
    expect(rows.map((e) => e.textContent).join(" ")).toContain(
      "cable pin mapping is unresolved",
    );
    const last = Number(rows.at(-1)!.getAttribute("y"));
    const y = Number(
      group.getAttribute("transform")!.match(/translate\([^ ]+ ([^)]+)\)/)![1],
    );
    expect(y + original.height * scale + 4).toBeLessThanOrEqual(
      Number(rows[0]!.getAttribute("y")),
    );
    expect(last).toBeLessThan(
      r.value.page.heightMm - r.value.page.marginMm - 35,
    );
    expect(await renderSchematicPacket(ir, request)).toEqual(r);
    expect(JSON.stringify(ir)).toBe(before);
    expect(ir.nets).toHaveLength(0);
  });

  for (const size of ["tabloid", "a3", "a4", "letter"] as const)
    it(`wraps wide glyphs and preserves complete note text on ${size}`, async () => {
      const notes = [
        "W".repeat(400),
        "m".repeat(400),
        "1".repeat(400),
        "MMwwii 1122: " + "wide words ".repeat(25),
      ];
      for (const note of notes) {
        const request = { ...view, devices: undefined, notes: [note] };
        const r = await renderSchematicPacket(ir, {
          format: "schematic-packet-request/0.1",
          page: { size, orientation: "landscape" },
          views: [request],
        });
        if (!r.ok) throw new Error(r.error.message);
        const rows = noteRows(r.value.sheets[0]!.svg);
        const content = rows.map((e) => e.textContent).join(" ");
        for (const char of ["W", "m", "1"])
          if (note === char.repeat(400))
            expect(
              rows
                .filter((e) => new RegExp(`^${char}+$`).test(e.textContent!))
                .map((e) => e.textContent)
                .join("").length,
            ).toBe(400);
        for (const e of rows) {
          const right =
            Number(e.getAttribute("x")) + width(e.textContent!, 2.5);
          expect(right).toBeLessThanOrEqual(
            r.value.page.widthMm - r.value.page.marginMm - 18,
          );
        }
        const typed = content.replace(/\s/gu, "");
        expect(typed).toContain(note.replace(/\s/gu, ""));
        expect(r.value.sheets[0]!.svg).toContain("Pin mapping: unresolved");
      }
    });

  it("keeps an already fitting view at its original scale and retains source whitespace", async () => {
    const request = {
      ...view,
      devices: undefined,
      notes: ["Original  double spaces remain."],
    };
    const original = await prepareConnectorAssemblyDrawing(ir, request);
    const r = await renderSchematicPacket(ir, {
      format: "schematic-packet-request/0.1",
      views: [request],
    });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.sheets[0]!.svg).toContain("scale(1)");
    expect(r.value.sheets[0]!.svg).toContain(original.content);
    expect(
      noteRows(r.value.sheets[0]!.svg).some(
        (e) => e.textContent === request.notes[0],
      ),
    ).toBe(true);
  });

  it("rejects notes that would force diagram text below the readable minimum", async () => {
    const r = await renderSchematicPacket(ir, {
      format: "schematic-packet-request/0.1",
      views: [
        {
          ...view,
          notes: Array.from(
            { length: 12 },
            (_, i) => `${i}: ${"W".repeat(390)}`,
          ),
        },
      ],
    });
    expect(r).toMatchObject({ ok: false, error: { code: "R006" } });
    expect(r).not.toHaveProperty("value");
  });

  it("does not retry invalid ELK output through note fitting", async () => {
    const prototype = (BundledElk as unknown as { prototype: ELK }).prototype,
      layout = prototype.layout;
    const spy = vi
      .spyOn(prototype, "layout")
      .mockImplementationOnce(async function (this: ELK, graph: ElkNode) {
        const result = await layout.call(this, graph);
        result.edges!.pop();
        return result;
      });
    try {
      const r = await renderSchematicPacket(ir, {
        format: "schematic-packet-request/0.1",
        views: [view],
      });
      expect(r).toMatchObject({ ok: false, error: { code: "R006" } });
      expect(spy).toHaveBeenCalledOnce();
    } finally {
      spy.mockRestore();
    }
  });
});
