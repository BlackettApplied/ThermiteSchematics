import { beforeAll, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { parseHTML } from "linkedom";
import { compileProject, type ElectricalIr } from "@thermite/compiler";
import { buildDocumentation, REPORT_KINDS } from "@thermite/query";
import {
  renderSchematicPacket,
  type SchematicPacketRequest,
} from "../src/sheets.js";
import { referenceTables } from "../src/packet/references.js";
import { tableDrafts } from "../src/packet/reports.js";
import { viewDrafts } from "../src/packet/dispatch.js";
import { normalizePaperPage } from "../src/packet/page.js";
import {
  documentationTableKinds,
  identifierTable,
} from "../../../evals/draw/identifier-tables.mjs";

let ir: ElectricalIr, request: SchematicPacketRequest;
beforeAll(async () => {
  const c = await compileProject("examples/report-filtering");
  if (!c.ok) throw Error("compile");
  ir = c.ir;
  request = JSON.parse(
    await readFile("examples/report-filtering/packet.json", "utf8"),
  );
});

it("pins the checker's explicit table kinds to every actual renderer table kind", async () => {
  const paper = normalizePaperPage(request.page);
  if (!paper.ok) throw Error("paper");
  const tables = [
    ...REPORT_KINDS.map((kind) =>
      buildDocumentation(ir, {
        format: "documentation-view-request/0.1",
        kind,
      }),
    ),
    ...referenceTables(ir, [], {}, undefined).tables,
  ];
  const actual = new Set<string>();
  for (const table of tables) {
    const drafts = tableDrafts(ir, table, undefined, paper.value);
    if (!drafts.ok) throw Error(drafts.error.message);
    expect(drafts.value.length).toBeGreaterThan(0);
    for (const draft of drafts.value) {
      expect(draft.documentationTable).toBe(true);
      expect(documentationTableKinds).toContain(draft.view.kind);
      actual.add(draft.view.kind);
    }
  }
  expect([...actual].sort()).toEqual([...documentationTableKinds].sort());
  // Communication shares the normalized documentation format, but is a drawing.
  const diagrams = await viewDrafts(
    ir,
    request.views[0],
    undefined,
    paper.value,
    "standard",
    new Map(),
  );
  if (!diagrams.ok) throw Error(diagrams.error.message);
  for (const draft of diagrams.value) {
    expect(draft.view.format).toBe("documentation-view/0.1");
    expect(draft.documentationTable).toBeUndefined();
    expect(documentationTableKinds).not.toContain(draft.view.kind);
  }
});

it.each([
  ["standard", "left-to-right"],
  ["standard", "top-to-bottom"],
  ["compact", "left-to-right"],
  ["compact", "top-to-bottom"],
] as const)(
  "matches the full filtered packet's reference cells in %s / %s",
  async (layout) => {
    // These corpus flow labels share a request: communication has no flow field.
    const result = await renderSchematicPacket(ir, {
      ...request,
      layout,
    });
    if (!result.ok) throw Error(result.error.message);
    const packet = result.value;
    for (const sheet of packet.sheets.filter(
      (s) => s.view.kind === "references" || s.view.kind === "index",
    )) {
      const rows = [
        ...parseHTML(sheet.svg).document.querySelectorAll("[data-report-row]"),
      ];
      const model = identifierTable(
        sheet,
        packet,
        { reportRows: rows.map((r) => r.getAttribute("data-report-row")) },
        ir,
        [],
      );
      for (const row of rows) {
        const expected = model.rows.find(
          (r: { key: string }) => r.key === row.getAttribute("data-report-row"),
        )!;
        // 5.17's identifier adapter predates final index closure. Check new
        // administrative rows independently against the actual issued sheets.
        const target = packet.sheets.find(
          (s) => String(s.number) === row.getAttribute("data-report-row"),
        );
        if (!expected) {
          expect(["index", "references"]).toContain(target?.view.kind);
        }
        for (const column of [0, 2]) {
          const actual = row
            .querySelector(`[data-report-column="${column + 1}"]`)!
            .textContent!.replace(/\s+/gu, " ")
            .trim();
          expect(actual).toBe(
            (
              expected?.cells[column] ??
              (column === 0 ? String(target?.number) : "")
            )
              .replace(/\s+/gu, " ")
              .trim(),
          );
        }
      }
      if (sheet.view.kind === "references") {
        const plc = ir.devices.find((d) => d.designation === "PLC1")!;
        expect(
          model.rows.find(
            (r: { key: string }) => r.key === JSON.stringify([plc.uid, []]),
          ).cells[2],
        ).toBe("1 / A1");
      } else expect(model.rows).toHaveLength(7);
    }
  },
);

it.each([undefined, { appearances: "all" as const }])(
  "matches unfiltered references for %j",
  async (references) => {
    const result = await renderSchematicPacket(ir, { ...request, references });
    if (!result.ok) throw Error(result.error.message);
    const sheet = result.value.sheets.find(
      (s) => s.view.kind === "references",
    )!;
    const rows = [
      ...parseHTML(sheet.svg).document.querySelectorAll("[data-report-row]"),
    ];
    const model = identifierTable(
      sheet,
      result.value,
      { reportRows: rows.map((r) => r.getAttribute("data-report-row")) },
      ir,
      [],
    );
    const plc = ir.devices.find((d) => d.designation === "PLC1")!;
    const expected = model.rows.find(
      (r: { key: string }) => r.key === JSON.stringify([plc.uid, []]),
    );
    expect(expected.cells[2]).toBe("1 / A1; 3 / A4; 4 / A4; 5 / A4; 5 / B4");
    const printed = rows.find(
      (row) => row.getAttribute("data-report-row") === expected.key,
    )!;
    expect(
      printed
        .querySelector('[data-report-column="3"]')!
        .textContent!.replace(/\s+/gu, " ")
        .trim(),
    ).toBe(expected.cells[2]);
  },
);

it.each([
  false,
  { filter: { devices: ["PLC1"], excludeDevices: ["PLC1"] } },
] as const)(
  "keeps the index complete with reference selection %j",
  async (references) => {
    const result = await renderSchematicPacket(ir, { ...request, references });
    if (!result.ok) throw Error(result.error.message);
    const index = result.value.sheets.find((s) => s.view.kind === "index")!;
    expect(
      identifierTable(index, result.value, { reportRows: [] }, ir, []).rows,
    ).toHaveLength(7);
    const refs = result.value.sheets.filter(
      (s) => s.view.kind === "references",
    );
    expect(refs).toHaveLength(references === false ? 0 : 1);
    if (refs.length)
      expect(
        identifierTable(refs[0], result.value, { reportRows: [] }, ir, []).rows,
      ).toEqual([]);
  },
);
