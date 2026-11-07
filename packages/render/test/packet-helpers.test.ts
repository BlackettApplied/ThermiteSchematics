import { beforeAll, describe, expect, it } from "vitest";
import { compileProject, type ElectricalIr } from "@thermite/compiler";
import { buildDocumentation, type DocumentationTable } from "@thermite/query";
import { renderSchematicPacket } from "../src/sheets.js";
import { drawingContinuations } from "../src/packet/continuations.js";
import { appendViewDrafts } from "../src/packet/assembly.js";
import { foldDrawingDrafts } from "../src/packet/folding.js";
import { bounds, normalizePaperPage, zone } from "../src/packet/page.js";
import { cuts } from "../src/packet/rooted.js";
import { referenceTables } from "../src/packet/references.js";
import { tableDrafts } from "../src/packet/reports.js";
import { reportCells } from "../src/packet/report-cells.js";
import type { Draft } from "../src/packet/types.js";
import type { NormalizedSchematicLayout } from "../src/types.js";
import { measureText } from "../src/text-metrics.js";

const title = {
  projectName: "Synthetic packet",
  revision: "A",
  backgroundColor: "#ffffff",
  toolVersion: "test",
  lines: [],
};
function draft(): Draft {
  return {
    title,
    view: { format: "documentation-view/0.1", kind: "wires", title: "Wires" },
    content: "",
    links: [],
    references: [],
    note: "Synthetic invariant fixture",
  };
}
const normalized = normalizePaperPage();
if (!normalized.ok) throw Error(normalized.error.message);
const page = normalized.value;
let ir: ElectricalIr;
beforeAll(async () => {
  const c = await compileProject("examples/motor-starter");
  if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
  ir = c.ir;
});

describe("packet page bounds", () => {
  it("resolves corners, internal boundaries and out-of-bounds points consistently", () => {
    const b = bounds(title, page);
    expect(b).toMatchObject({ x: 28, y: 31, w: 375.8 });
    expect(b.h).toBeCloseTo(196.4);
    expect(zone(b.x, b.y, b)).toBe("A1");
    expect(zone(b.x + b.w, b.y + b.h, b)).toBe("D6");
    expect(zone(b.x + b.w / 2, b.y + b.h / 2, b)).toBe("C4");
    expect(zone(b.x - 20, b.y - 20, b)).toBe("A1");
    expect(zone(b.x + b.w + 20, b.y + b.h + 20, b)).toBe("D6");
  });
  it("cuts only outside merged protected intervals and refuses an impossible cut", () => {
    const intervals = [
      { start: 40, end: 65 },
      { start: 60, end: 80 },
    ];
    expect(cuts(130, 70, intervals)).toEqual([0, 40, 110, 130]);
    expect(cuts(130, 70, [{ start: 0, end: 80 }])).toBeNull();
  });
});

describe("packet reference ownership", () => {
  it("recomputes zones when compact packing moves an appearance to another row", () => {
    const a = draft(),
      b = draft();
    a.drawingBounds = b.drawingBounds = { x: 0, y: 0, w: 120, h: 100 };
    a.communicationHeight = 30;
    b.communicationHeight = 20;
    b.references = [
      {
        deviceUid: "D2",
        designation: "D2",
        functions: [],
        xMm: 70,
        yMm: 15,
        zone: "A4",
      },
    ];
    const sheets = [a];
    appendViewDrafts(sheets, [b], 1, "compact", 0);
    expect(sheets).toHaveLength(1);
    expect(a.communicationHeight).toBe(60);
    expect(a.references).toEqual([
      {
        deviceUid: "D2",
        designation: "D2",
        functions: [],
        xMm: 70,
        yMm: 55,
        zone: "C4",
      },
    ]);
    expect(b.references[0]).toMatchObject({ yMm: 15, zone: "A4" });
  });

  it("maps fold destinations to the packed sheet for both merged and separate sections", () => {
    const layout: NormalizedSchematicLayout = {
      format: "schematic-layout/0.1",
      view: {
        format: "schematic-view/0.1",
        root: { deviceUid: "D1", designation: "D1" },
        family: "control",
        flow: "left-to-right",
      },
      width: 300,
      height: 200,
      ports: [],
      labels: [],
      edges: [],
      crossings: [],
      nodes: [10, 110, 210].map((x, i) => ({
        id: `section-${i}`,
        parentId: "root",
        kind: "symbol",
        x,
        y: 0,
        width: 10,
        height: i === 2 ? 70 : 10,
      })),
    };
    const sources = [draft(), draft(), draft()];
    for (const [index, source] of sources.entries())
      source.content = `<svg height="200" viewBox="0 0 100 200"><g id="body-${index}"/></svg>`;
    const link = (id: string, to: number) => ({
      id,
      to,
      conductor: "W1",
      netId: "N1",
      x: 10,
      y: 10,
      side: "right" as const,
    });
    sources[0]!.links = [link("C001", 3), link("C002", 2)];
    sources[1]!.links = [link("C002", 1)];
    sources[2]!.links = [link("C001", 1)];
    const folded = foldDrawingDrafts(
      sources,
      layout,
      [0, 100, 200, 300],
      { x: 0, y: 0, w: 100, h: 100 },
      1,
      200,
    );
    // The first two short sections share sheet 1; the tall third section owns sheet 2.
    expect(folded).toHaveLength(2);
    expect(folded.map((d) => d.links.map((l) => [l.id, l.to]))).toEqual([
      [
        ["C001", 2],
        ["C002", 1],
        ["C002", 1],
      ],
      [["C001", 1]],
    ]);
  });

  it("offsets destinations and numbers reciprocal links once across authored views", () => {
    const sheets = [draft(), draft()],
      a = draft(),
      b = draft();
    a.links.push({
      id: "C001",
      to: 2,
      conductor: "W1",
      netId: "N1",
      x: 0,
      y: 0,
      side: "right",
    });
    b.links.push({
      id: "C001",
      to: 1,
      conductor: "W1",
      netId: "N1",
      x: 0,
      y: 0,
      side: "left",
    });
    a.communicationBlock = {
      view: 0,
      part: 1,
      x: 0,
      y: 0,
      width: 100,
      rows: [
        { deviceUid: "device", label: "D1", targets: [{ part: 2, sheet: 2 }] },
      ],
    };
    b.circuitBlocks = [
      {
        group: "circuit",
        part: 2,
        x: 0,
        y: 0,
        width: 100,
        rows: [
          {
            id: '["device","1"]',
            label: "D1.1",
            targets: [{ part: 1, sheet: 1 }],
          },
        ],
      },
    ];
    expect(appendViewDrafts(sheets, [a, b], 4, "standard", 7)).toBe(8);
    expect(sheets).toHaveLength(4);
    expect(a.links[0]).toMatchObject({
      id: "C008",
      to: 4,
      conductor: "W1",
      netId: "N1",
    });
    expect(b.links[0]).toMatchObject({ id: "C008", to: 3 });
    expect(a.communicationBlock).toMatchObject({
      view: 5,
      rows: [{ targets: [{ part: 2, sheet: 4 }] }],
    });
    expect(b.circuitBlocks[0]!.rows[0]!.targets).toEqual([
      { part: 1, sheet: 3 },
    ]);
  });
  it("keeps reciprocal rooted crossings and refuses adjacent unreadable labels", () => {
    const a = draft(),
      b = draft();
    const area = { x: 0, y: 0, w: 100, h: 100 };
    const graph = { edges: [{ id: "wire1" }, { id: "wire2" }] };
    const first = {
      id: "wire1",
      netId: "N1",
      points: [
        { x: 0, y: 10 },
        { x: 100, y: 10 },
      ],
    };
    expect(
      drawingContinuations(
        [a, b],
        graph,
        { edges: [first] },
        [0, 70, 140],
        [0, 100],
        area,
        1,
      ),
    ).toEqual({ ok: true, value: undefined });
    expect(a.links[0]).toMatchObject({
      id: "C001",
      to: 2,
      netId: "N1",
      side: "right",
    });
    expect(b.links[0]).toMatchObject({
      id: "C001",
      to: 1,
      netId: "N1",
      side: "left",
    });
    const second = {
      id: "wire2",
      netId: "N2",
      points: [
        { x: 0, y: 11 },
        { x: 100, y: 11 },
      ],
    };
    const rejected = drawingContinuations(
      [draft(), draft()],
      graph,
      { edges: [first, second] },
      [0, 70, 140],
      [0, 100],
      area,
      1,
    );
    expect(rejected).toEqual({
      ok: false,
      error: {
        code: "R006",
        root: "packet",
        reason: "unprintable-layout",
        message:
          "Continuation labels are too close to print clearly. Change flow, use a larger sheet, or narrow the view.",
      },
    });
  });
  it("builds indexes from content sheets without mutating their appearances", () => {
    const a = draft(),
      b = draft();
    const uid = ir.devices[0]!.uid;
    a.references = [
      { deviceUid: uid, designation: "D1", functions: ["coil"], zone: "A1" },
    ];
    b.references = [
      { deviceUid: uid, designation: "D1", functions: ["coil"], zone: "D6" },
    ];
    b.documentationTable = true;
    const before = JSON.stringify([a, b]);
    const { tables, referenceSelection } = referenceTables(
      ir,
      [a, b],
      { references: { appearances: "drawings" } },
      undefined,
    );
    expect(tables[0]!.rows.map((r) => r.cells[0])).toEqual(["1", "2"]);
    expect(tables[1]!.rows[0]!.cells).toEqual(["D1", "coil", "1 / A1"]);
    expect(referenceSelection).toMatchObject({
      totalGroups: 1,
      retainedGroups: 1,
    });
    expect(JSON.stringify([a, b])).toBe(before);
  });
});

describe("packet report composition", () => {
  const narrowTable: DocumentationTable = {
    kind: "wires",
    title: "Padding and row fit",
    columns: ["Label"],
    widths: [1],
    notes: [],
    rows: [],
  };

  it("reserves report cell padding before wrapping printable text", () => {
    const cells = reportCells(ir, narrowTable, 20);
    // Six W glyphs fit in 18 mm but exceed the padded 16 mm text allocation.
    const wrapped = cells.split(["WWWWWW"], "1")[0]!;
    expect(wrapped).toHaveLength(2);
    expect(wrapped.join("")).toBe("WWWWWW");
    for (const line of wrapped)
      expect(measureText(line, cells.cellSize).width).toBeLessThanOrEqual(16);
  });

  it("preserves printed row heights for single lines, multiple lines and headers", () => {
    const cells = reportCells(ir, narrowTable, 20);
    const single = cells.geometry([["g"]]),
      multiline = cells.geometry([["g", "g", "g"]]),
      header = cells.geometry([["g", "g", "g"]], true);
    expect(single.height).toBeCloseTo(7.6);
    expect(multiline.height).toBeCloseTo(14.8);
    expect(header.height).toBeCloseTo(15.8);
    const lastInkBottom =
      multiline.baseline +
      2 * multiline.lineHeight +
      measureText("g", cells.cellSize).descent;
    expect(multiline.height).toBeGreaterThan(lastInkBottom + 1);
  });

  it("measures glyph widths at a fixed size and preserves every cell character", () => {
    const table: DocumentationTable = {
      kind: "wires",
      title: "Synthetic widths",
      columns: ["Wide", "Narrow"],
      widths: [1, 1],
      notes: [],
      rows: [
        {
          key: "row",
          deviceUids: [],
          cells: ["W".repeat(120), "i".repeat(120)],
        },
      ],
    };
    const cells = reportCells(ir, table, 100);
    const wrapped = cells.split(table.rows[0]!.cells, "1");
    expect(wrapped.map((lines) => lines.join(""))).toEqual(
      table.rows[0]!.cells,
    );
    expect(wrapped[0]!.length).toBeGreaterThan(wrapped[1]!.length);
    expect(cells.cellSize).toBe(2.6);
    const geometry = cells.geometry(wrapped);
    expect(geometry.height).toBeGreaterThan(
      geometry.baseline + (wrapped[0]!.length - 1) * geometry.lineHeight,
    );
  });
  it("retains row identity and the same refusal through the direct and packet boundaries", async () => {
    const input = structuredClone(ir);
    input.wires[0]!.properties = { label: "W".repeat(10000) };
    const view = {
      format: "documentation-view-request/0.1",
      kind: "wires",
    } as const;
    const table = buildDocumentation(input, view);
    const direct = tableDrafts(input, table, undefined, page);
    const packet = await renderSchematicPacket(input, {
      format: "schematic-packet-request/0.1",
      views: [view],
    });
    expect(direct.ok).toBe(false);
    expect(packet).toMatchObject({
      ok: false,
      error: {
        code: "R006",
        details: { viewIndex: 0, viewTitle: table.title },
        message: expect.stringContaining(
          !direct.ok ? direct.error.message : "",
        ),
      },
    });
    if (direct.ok) throw Error("Expected an impossible row");
    expect(direct.error).toMatchObject({
      code: "R006",
      root: "packet",
      reason: "unprintable-layout",
    });
    expect(direct.error.message).toContain(input.wires[0]!.designation);
    expect(direct.error.message).toContain('column 1 "Conductor / label"');
  });
});
