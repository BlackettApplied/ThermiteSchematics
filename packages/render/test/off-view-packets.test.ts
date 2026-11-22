import { expect, it } from "vitest";
import { renderSchematicPacket, renderSchematicSheets } from "../src/sheets.js";
import {
  offViewFixture,
  control,
  cards,
  parseSvg,
  flows,
} from "./off-view-fixtures.js";

it("retains local disclosures when another view draws the same conductor; annotations never satisfy W906 or audited coverage", async () => {
  const f = await offViewFixture((objects) => {
    const index = objects.findIndex((o) => o.designation === "W3b");
    if (index < 0) throw Error("Missing parallel fixture wire");
    objects.splice(index, 1);
  });
  try {
    const packet = (views: any[]) => ({
      format: "schematic-packet-request/0.1" as const,
      views,
      index: true,
    });
    const a = await renderSchematicPacket(
      f.ir,
      packet([
        control(),
        { format: "documentation-view-request/0.1", kind: "wires" },
      ]),
    );
    if (!a.ok) throw Error(JSON.stringify(a));
    const warnings = a.value.coverage.diagnostics ?? [];
    expect(warnings.map((d) => d.code)).toEqual(["W906"]);
    expect(
      warnings.flatMap((d: any) => d.devices.map((v: any) => v.designation)),
    ).toEqual(["H1", "TB1"]);
    expect(a.value.coverage.counts.conductors.represented).toBe(0);
    expect(a.value.coverage.counts.functions.represented).toBe(0);
    expect(
      a.value.sheets
        .flatMap((s) => s.references)
        .filter((r) => r.functions.length)
        .map((r) => r.designation),
    ).not.toContain("H1");
    const b = await renderSchematicPacket(
      f.ir,
      packet([
        control(),
        {
          format: "schematic-view-request/0.2",
          root: { by: "designation", value: "PS1" },
          intent: { kind: "loads" },
        },
      ]),
    );
    if (!b.ok) throw Error(JSON.stringify(b));
    const local = b.value.sheets
      .filter((s) => s.view.format === "schematic-view/0.1")
      .flatMap((s) => cards(s.svg));
    expect(local.flatMap((c) => c.rows)).toContain("W3 → H1.X1");
    expect(
      (b.value.coverage.diagnostics ?? []).flatMap((d: any) =>
        d.devices.map((v: any) => v.designation),
      ),
    ).not.toContain("H1");
  } finally {
    await f.dispose();
  }
});

it.each(flows)(
  "keeps every cable core and spare row, discloses other direct terminal connections, and repeats the notice (%s)",
  async (flow) => {
    const f = await offViewFixture();
    try {
      const r = await renderSchematicSheets(f.ir, {
        format: "schematic-view-request/0.2",
        root: { by: "designation", value: "CBL1" },
        intent: { kind: "conductors" },
        flow,
      });
      if (!r.ok) throw Error(JSON.stringify(r));
      const rows = r.value.sheets.flatMap((s) => cards(s.svg));
      expect(
        rows.flatMap((c) => c.rows).some((r) => r.startsWith("CBL1.")),
      ).toBe(false);
      expect(rows.find((c) => c.terminal === "PS1.+")?.rows).toEqual([
        "W1 → K1.A1",
        "W3 → H1.X1",
        "W3b → H1.X1",
      ]);
      for (const sheet of r.value.sheets)
        expect(
          parseSvg(sheet.svg).querySelectorAll("[data-selected-view-notice]"),
        ).toHaveLength(1);
      const svg = r.value.sheets.map((s) => s.svg).join("");
      for (const id of ["1", "2", "3", "4"])
        expect(svg).toContain(`data-conductor-id="${id}"`);
      expect(svg).toContain("partially-terminated");
      expect(svg).toContain("unterminated");
      expect(svg).toContain("unassigned");
    } finally {
      await f.dispose();
    }
  },
);
