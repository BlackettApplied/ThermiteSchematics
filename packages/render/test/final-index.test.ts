import { beforeAll, expect, it } from "vitest";
import { compileProject, type ElectricalIr } from "@thermite/compiler";
import { reserveFinalIndex } from "../src/packet/references-final.js";
import { tableDrafts } from "../src/packet/reports.js";
import { normalizePaperPage } from "../src/packet/page.js";
import { buildDocumentation } from "@thermite/query";
import { required } from "./off-view-fixtures.js";
import { parseHTML } from "linkedom";
import {
  renderSchematicPacket,
  sheetLabel,
  type SchematicPacketRequest,
} from "../src/sheets.js";
let ir: ElectricalIr;
beforeAll(async () => {
  const c = await compileProject("examples/report-filtering");
  if (!c.ok) throw Error("fixture compile");
  ir = c.ir;
});
const request: SchematicPacketRequest = {
  format: "schematic-packet-request/0.1",
  index: true,
  views: [
    { format: "documentation-view-request/0.1", kind: "bom" },
    { format: "documentation-view-request/0.1", kind: "bom" },
  ],
};
const rows = (sheets: readonly { svg: string; view: { kind: string } }[]) =>
  sheets
    .filter((s) => s.view.kind === "index")
    .flatMap((s) => [
      ...parseHTML(s.svg).document.querySelectorAll("[data-report-row]"),
    ]);
it("indexes every final sheet, including all index and reference pages", async () => {
  const before = JSON.stringify(ir),
    result = await renderSchematicPacket(ir, request);
  if (!result.ok) throw Error(result.error.message);
  expect(
    rows(result.value.sheets).map((r) => r.getAttribute("data-report-row")),
  ).toEqual(result.value.sheets.map((s) => String(s.number)));
  expect(JSON.stringify(ir)).toBe(before);
});
it("disambiguates repeated titles with sheet destinations, not title identities", async () => {
  const result = await renderSchematicPacket(ir, request);
  if (!result.ok) throw Error(result.error.message);
  const names = rows(result.value.sheets)
    .slice(0, 2)
    .map((r) => r.querySelector('[data-report-column="2"]')?.textContent);
  expect(new Set(names).size).toBe(2);
  expect(names[0]).toContain("sheet 01");
  expect(names[1]).toContain("sheet 02");
  for (const row of rows(result.value.sheets).slice(2)) {
    const target = required(
      result.value.sheets.find(
        (s) => String(s.number) === row.getAttribute("data-report-row"),
      ),
    );
    expect(
      row.querySelector('[data-report-column="2"]')?.textContent?.trim(),
    ).toBe(sheetLabel(target.view));
  }
});
it.each([2, 30])(
  "matches every final row's title and kind to its issued sheet (%s content views)",
  async (count) => {
    const kinds = new Map([
      ["Bill of materials", "bom"],
      ["Drawing index", "index"],
      ["Device and function references", "references"],
    ]);
    for (const references of [undefined, false]) {
      const result = await renderSchematicPacket(ir, {
        ...request,
        references,
        views: Array.from({ length: count }, () => request.views[0]),
      });
      if (!result.ok) throw Error(result.error.message);
      const sheets = result.value.sheets;
      expect(
        rows(sheets).map((r) => Number(r.getAttribute("data-report-row"))),
      ).toEqual(sheets.map((s) => s.number));
      for (const row of rows(sheets)) {
        const number = Number(row.getAttribute("data-report-row"));
        const target = required(sheets.find((s) => s.number === number));
        const label = required(
          row.querySelector('[data-report-column="2"]')?.textContent,
        )
          .replace(/\s+/gu, " ")
          .trim();
        const title = label.replace(/ \(sheet \d+\)$/u, "");
        expect({ number, kind: kinds.get(title), title }).toEqual({
          number: target.number,
          kind: target.view.kind,
          title: sheetLabel(target.view),
        });
        const repeated =
          sheets.filter((s) => sheetLabel(s.view) === title).length > 1;
        expect(label).toBe(
          repeated
            ? `${title} (sheet ${String(number).padStart(2, "0")})`
            : title,
        );
      }
    }
  },
);
it("keeps references:false intentional while indexing its own final page", async () => {
  const result = await renderSchematicPacket(ir, {
    ...request,
    references: false,
  });
  if (!result.ok) throw Error(result.error.message);
  expect(result.value.sheets.some((s) => s.view.kind === "references")).toBe(
    false,
  );
  expect(rows(result.value.sheets)).toHaveLength(result.value.sheets.length);
});

it("bounds an index self-pagination cycle by the reserved sheet capacity", () => {
  const page = normalizePaperPage();
  if (!page.ok) throw Error("paper");
  const prepared = tableDrafts(
    ir,
    buildDocumentation(ir, {
      format: "documentation-view-request/0.1",
      kind: "bom",
    }),
    undefined,
    page.value,
  );
  if (!prepared.ok) throw Error(prepared.error.message);
  const template = required(prepared.value[0]);
  let calls = 0;
  const result = reserveFinalIndex([template], [], template, (all) => {
    calls++;
    expect(calls).toBeLessThanOrEqual(100);
    return {
      ok: true,
      value: Array.from({ length: all.length === 2 ? 2 : 1 }, () => template),
    };
  });
  expect(result.ok).toBe(false);
  if (!result.ok)
    expect(result.error).toMatchObject({
      code: "R006",
      root: "packet",
      reason: "unprintable-layout",
      message:
        "A bounded final index cannot fit within the 100-sheet packet limit.",
    });
  expect(calls).toBe(99);
});
