import { beforeAll, describe, expect, it } from "vitest";
import { compileProject } from "@thermite/compiler";
import { renderSchematicPacket } from "@thermite/render";
import { parseHTML } from "linkedom";
import type { ElectricalIr } from "@thermite/compiler";
import {
  buildDocumentation,
  documentationCsv,
  type DocumentationTable,
  type ReportKind,
} from "../src/documentation.js";
import {
  buildCableSchedule,
  type EndpointSheetZones,
} from "../src/cable-schedule.js";
import { documentationFixture } from "./documentation-fixture.js";

let ir: ElectricalIr;
beforeAll(async () => {
  ir = await documentationFixture();
});
const report = (kind: ReportKind, input = ir) =>
  buildDocumentation(input, { format: "documentation-view-request/0.1", kind });
const row = (table: DocumentationTable, name: string) =>
  table.rows.find((r) => r.cells[table.kind === "bom" ? 1 : 0] === name)!;
const cell = (table: DocumentationTable, name: string, column: string) =>
  row(table, name).cells[table.columns.indexOf(column)];

describe("documentation preserves authored meaning", () => {
  it("keeps multiline and empty descriptions unambiguous, with procurement marking the whole row", () => {
    const input = structuredClone(ir),
      first = input.devices.find((d) => d.designation === "M1")!,
      second = input.devices.find((d) => d.designation === "M2")!;
    first.description = second.description =
      "5 HP motor\nM3: authored continuation, not another device";
    first.nonProcurement = second.nonProcurement = {
      reason: "Existing motors reused",
    };
    const table = report("bom", input),
      grouped = row(table, "M1, M2");
    expect(grouped.cells[6]).toBe(
      `${first.description}\nNot purchased: Existing motors reused`,
    );
    expect(documentationCsv(table)).toContain(
      '"5 HP motor\nM3: authored continuation, not another device\nNot purchased: Existing motors reused"',
    );
    first.description = second.description = "";
    delete first.nonProcurement;
    delete second.nonProcurement;
    expect(row(report("bom", input), "M1, M2").cells[6]).toBe("");
  });
  it("groups absent, empty and whitespace-only descriptions while preserving raw JSON metadata", () => {
    const input = structuredClone(ir);
    const first = input.devices.find((d) => d.designation === "M1")!;
    const second = input.devices.find((d) => d.designation === "M2")!;
    delete first.description;
    for (const text of ["", " ", "\t\n ", "\u000b"]) {
      second.description = text;
      input.cableTypes[0]!.description = text;
      const before = JSON.stringify(input);
      const grouped = row(report("bom", input), "M1, M2");
      expect(grouped?.cells[0]).toBe("2");
      expect(grouped?.cells[6]).toBe("");
      expect(row(report("cables", input), "CBL1").cells[1]).toBe(
        input.cables[0]!.typeId,
      );
      expect(buildCableSchedule(input, input.cables[0]!.uid).description).toBe(
        text,
      );
      expect(JSON.stringify(input)).toBe(before);
      expect(second.description).toBe(text);
    }
  });
  it("orders peer BOM rows and their members by lowest natural designation, independently of description/reason text", () => {
    const input = structuredClone(ir);
    const template = input.devices.find((d) => d.designation === "M1")!;
    input.cables = [];
    input.wires = [];
    input.jumpers = [];
    input.relations = [];
    input.devices = [
      {
        ...template,
        uid: "natural-10",
        designation: "M10",
        description: "A description",
      },
      {
        ...template,
        uid: "natural-2",
        designation: "M2",
        description: "Z description",
      },
      {
        ...template,
        uid: "natural-1",
        designation: "M1",
        description: "Z description",
      },
      {
        ...template,
        uid: "natural-3",
        designation: "M3",
        description: "B description",
        nonProcurement: { reason: "Z reason" },
      },
      {
        ...template,
        uid: "natural-4",
        designation: "M4",
        description: "B description",
        nonProcurement: { reason: "A reason" },
      },
    ];
    expect(
      report("bom", input)
        .rows.filter((r) => r.deviceUids.length)
        .map((r) => r.cells[1]),
    ).toEqual(["M1, M2", "M3", "M4", "M10"]);
    input.devices.reverse();
    expect(
      report("bom", input)
        .rows.filter((r) => r.deviceUids.length)
        .map((r) => r.cells[1]),
    ).toEqual(["M1, M2", "M3", "M4", "M10"]);
  });
  it("normalizes control characters only in report cells, retaining tabs, newlines, raw IR and cable JSON", async () => {
    const input = structuredClone(ir),
      d = input.devices.find((d) => d.designation === "M1")!;
    d.description = "5 HP\u000bmotor\tline\nsecond\u0085line";
    input.cableTypes[0]!.description = "Shielded\u000bcable";
    const before = JSON.stringify(input),
      table = report("bom", input);
    expect(row(table, "M1").cells[6]).toBe("5 HP motor\tline\nsecond line");
    expect(row(table, "CBL1").cells[5]).toBe("Shielded cable");
    expect(buildCableSchedule(input, input.cables[0]!.uid).description).toBe(
      "Shielded\u000bcable",
    );
    const packet = await renderSchematicPacket(input, {
      format: "schematic-packet-request/0.1",
      views: [{ format: "documentation-view-request/0.1", kind: "bom" }],
    });
    expect(packet.ok, JSON.stringify(packet)).toBe(true);
    expect(documentationCsv(table)).not.toMatch(/[\u000b\u0085]/u);
    expect(JSON.stringify(input)).toBe(before);
  });
  it("keeps cable JSON description authored-only, including explicit empty text", () => {
    const input = structuredClone(ir),
      cable = input.cables[0]!;
    delete input.cableTypes[0]!.description;
    expect(buildCableSchedule(input, cable.uid)).not.toHaveProperty(
      "description",
    );
    input.cableTypes[0]!.description = "";
    expect(buildCableSchedule(input, cable.uid)).toHaveProperty(
      "description",
      "",
    );
  });
  it("splits distinct requirements and aggregates only identical authored descriptions", () => {
    const table = report("bom"),
      csv = documentationCsv(table);
    expect(row(table, "M1").cells[6]).toBe(
      ir.devices.find((d) => d.designation === "M1")!.description,
    );
    expect(row(table, "M2").cells[6]).toContain("Conveyor drive motor, 2 HP");
    expect(row(table, "M1").cells.join("\n")).toContain(
      "Three-phase induction motor load",
    );
    const same = structuredClone(ir);
    same.devices.find((d) => d.designation === "M2")!.description =
      same.devices.find((d) => d.designation === "M1")!.description!;
    const grouped = row(report("bom", same), "M1, M2");
    expect(grouped.cells[0]).toBe("2");
    expect(grouped.cells[6]).toBe(row(table, "M1").cells[6]);
    expect(csv).toContain(
      "Level switch proposed NO dry contact; limit-switch symbol substitution",
    );
  });
  it("conserves every device and cable once, including endpoint-free cables and partial selections", () => {
    for (const filter of [undefined, { devices: ["M1", "LS1"] }]) {
      const table = buildDocumentation(ir, {
        format: "documentation-view-request/0.1",
        kind: "bom",
        ...(filter ? { filter } : {}),
      });
      const deviceUids = table.rows
        .filter((r) => !ir.cables.some((c) => c.uid === r.key))
        .flatMap((r) => r.deviceUids);
      const expected = ir.devices
        .filter((d) => !filter || filter.devices.includes(d.designation))
        .map((d) => d.uid);
      expect(deviceUids.sort()).toEqual(expected.sort());
      expect(new Set(deviceUids).size).toBe(expected.length);
      const cables = table.rows.filter((r) =>
        ir.cables.some((c) => c.uid === r.key),
      );
      expect(new Set(cables.map((r) => r.key)).size).toBe(2);
      expect(table.rows.reduce((sum, r) => sum + Number(r.cells[0]), 0)).toBe(
        expected.length + 2,
      );
    }
  });
  it("marks only explicitly flagged devices, with their reason, without claiming a purchasable total", async () => {
    const input = await documentationFixture(true),
      table = report("bom", input);
    expect(input.devices.find((d) => d.designation === "SUP1")).toHaveProperty(
      "nonProcurement.reason",
      "Existing site utility; outside purchasing scope",
    );
    expect(row(table, "SUP1").cells.join("\n")).toContain(
      "Not purchased: Existing site utility; outside purchasing scope",
    );
    expect(row(table, "GEN1").cells.join("\n")).not.toContain("Not purchased");
    expect(table.notes.join(" ")).toContain("not purchasable totals");
    expect(table.rows.reduce((sum, r) => sum + Number(r.cells[0]), 0)).toBe(
      input.devices.length + input.cables.length,
    );
    expect(input.nets.map((n) => n.id)).toEqual(ir.nets.map((n) => n.id));
    expect(input.devices.map((d) => d.uid)).toEqual(
      ir.devices.map((d) => d.uid),
    );
  });
  it("separates explicit procurement reasons without changing instance counts or inferring a source flag", () => {
    const flagged = {
      ...ir,
      devices: ir.devices.map((d) => ({
        ...d,
        ...(["SUP1", "GEN1"].includes(d.designation)
          ? { nonProcurement: { reason: `${d.designation} outside scope` } }
          : {}),
      })),
    };
    let table = report("bom", flagged);
    for (const name of ["SUP1", "GEN1"]) {
      expect(row(table, name).cells[0]).toBe("1");
      expect(row(table, name).cells.at(-1)).toContain(
        `Not purchased: ${name} outside scope`,
      );
    }
    for (const d of flagged.devices)
      if (d.nonProcurement) {
        d.nonProcurement.reason = "Existing equipment";
        d.description = "Existing source";
      }
    table = report("bom", flagged);
    expect(row(table, "GEN1, SUP1").cells[0]).toBe("2");
    expect(row(table, "GEN1, SUP1").cells.at(-1)).toContain(
      "Not purchased: Existing equipment",
    );
    expect(table.rows.reduce((sum, r) => sum + Number(r.cells[0]), 0)).toBe(
      ir.devices.length + ir.cables.length,
    );
  });
  it("shows cable descriptions in BOM and schedule and falls back only when absent", () => {
    for (const kind of ["bom", "cables"] as const) {
      expect(row(report(kind), "CBL1").cells).toContain(
        "Shielded two-pair instrumentation cable",
      );
      const absent = structuredClone(ir);
      delete absent.cableTypes[0]!.description;
      expect(row(report(kind, absent), "CBL1").cells).toContain(
        "report-fixture:cable",
      );
      absent.cableTypes[0]!.description = "";
      expect(
        row(report(kind, absent), "CBL1").cells[kind === "bom" ? 5 : 1],
      ).toBe("report-fixture:cable");
    }
    expect(documentationCsv(report("bom"))).toContain(
      "Field cable; spare core retained",
    );
  });
  it("prints missing data as blanks and preserves explicit text and state words", () => {
    const bom = report("bom");
    expect(cell(bom, "LS1", "Mfr.")).toBe("");
    expect(cell(bom, "LS1", "Order number")).toBe("");
    expect(cell(bom, "LS1", "Location")).toBe("");
    expect(bom.notes.join(" ")).toContain("Blank order numbers");
    expect(row(report("wires"), "W1").cells[3]).toBe("");
    expect(row(report("cables"), "CBL1").cells.slice(2, 4)).toEqual(["", ""]);
    expect(row(report("cables"), "CBL1").cells.at(-1)).toBe("");
    const io = report("io");
    expect(row(io, "B1").cells.slice(3, 6)).toEqual(["", "", ""]);
    expect(row(io, "PLC1").cells.at(-1)).toContain("spare;");
    expect(row(io, "B1").cells.at(-1)).toContain("Unspecified;");
    const explicit = structuredClone(ir);
    explicit.devices[0]!.location = "Unspecified";
    explicit.deviceTypes[0]!.catalog = {
      manufacturer: "Unspecified",
      orderNumber: "Unspecified",
      document: {
        url: "https://example.invalid/synthetic",
        title: "Synthetic catalog",
        revision: "A",
        pages: "1",
      },
    };
    expect(documentationCsv(report("bom", explicit))).toContain(
      '"Unspecified"',
    );
    expect(report("terminals").rows).toEqual([]);
    const terminals = buildDocumentation(ir, {
      format: "documentation-view-request/0.1",
      kind: "terminals",
      device: "M1",
    });
    expect(terminals.rows[0]!.cells[1]).toBe("");
  });
  it("blanks locations in occupied and empty network/assembly rows while retaining status and mapping", async () => {
    const compiled = await compileProject("examples/report-filtering");
    if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
    const input = structuredClone(compiled.ir);
    for (const d of input.devices) delete d.location;
    for (const kind of ["network", "assemblies"] as const) {
      const table = report(kind, input);
      for (const r of table.rows) {
        expect(r.cells[2]).not.toContain("Unspecified");
        expect(r.cells[3]).not.toContain("Unspecified");
        expect(r.cells[2]).not.toMatch(/\n$/u);
        expect(r.cells[3]).not.toMatch(/\n$/u);
      }
      expect(table.rows.length).toBeGreaterThan(0);
      expect(table.rows.map((r) => r.cells[4])).toEqual(
        report(kind, compiled.ir).rows.map((r) => r.cells[4]),
      );
    }
    for (const explicit of input.devices) explicit.location = "Unspecified";
    expect(
      documentationCsv(report("network", input)) +
        documentationCsv(report("assemblies", input)),
    ).toContain("Unspecified");
  });
  it("labels sensor channel owners as devices without dropping their output row", () => {
    const table = report("io");
    expect(table.columns[0]).toBe("Device");
    expect(row(table, "B1").cells.slice(0, 3)).toEqual([
      "B1",
      "output",
      "output",
    ]);
    expect(table.title).toBe("I/O schedule");
  });
  it("reserves endpoint sheet.zone columns until injected values exist, including cable cores", () => {
    const request = {
      format: "documentation-view-request/0.1" as const,
      kind: "wires" as const,
    };
    const empty = buildDocumentation(ir, request);
    expect(empty.columns).not.toContain("From sheet.zone");
    const cable = ir.cables.find((c) => c.designation === "CBL1")!;
    const context = {
      conductors: new Map<string, EndpointSheetZones>([
        [ir.wires[0]!.uid, ["2.B3", null]],
      ]),
      cableCores: new Map([
        [cable.uid, new Map([["1", ["3.C2", "4.A1"] as const]])],
      ]),
    };
    context.conductors.set(ir.jumpers[0]!.uid, ["5.A1", null]);
    const table = buildDocumentation(ir, request, context);
    expect(table.columns.slice(-2)).toEqual([
      "From sheet.zone",
      "To sheet.zone",
    ]);
    expect(row(table, "W1").cells.slice(-2)).toEqual(["2.B3", ""]);
    expect(row(table, "CBL1/1").cells.slice(-2)).toEqual(["3.C2", "4.A1"]);
    expect(row(table, "CBL1/2").cells.slice(-2)).toEqual(["", ""]);
    expect(row(table, "J1").cells.slice(-2)).toEqual(["5.A1", ""]);
    const schedule = buildCableSchedule(
      ir,
      cable.uid,
      context.cableCores.get(cable.uid),
    );
    expect(schedule.cores[0]!.endpoints.map((e) => e?.sheetZone)).toEqual([
      "3.C2",
      "4.A1",
    ]);
    expect(
      buildCableSchedule(ir, cable.uid).cores[0]!.endpoints[0],
    ).not.toHaveProperty("sheetZone");
    expect(
      buildDocumentation(ir, request, {
        conductors: new Map([[ir.wires[0]!.uid, [null, ""]]]),
      }),
    ).toEqual(empty);
    expect(
      buildDocumentation(
        ir,
        { ...request, filter: { devices: ["B1"] } },
        { conductors: context.conductors },
      ).columns,
    ).not.toContain("From sheet.zone");
    expect(
      buildDocumentation(ir, request, {
        cableCores: new Map([[cable.uid, new Map([["2", ["9.D6", "9.D6"]]])]]),
      }),
    ).toEqual(empty);
    for (const t of [empty, table]) {
      expect(t.rows.every((r) => r.cells.length === t.columns.length)).toBe(
        true,
      );
      expect(t.widths.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
    }
  });
  it("renders the added BOM column with all authored text and every row intact at print size", async () => {
    const table = report("bom"),
      before = JSON.stringify(ir);
    const rendered = await renderSchematicPacket(ir, {
      format: "schematic-packet-request/0.1",
      views: [{ format: "documentation-view-request/0.1", kind: "bom" }],
    });
    if (!rendered.ok) throw Error(rendered.error.message);
    const seen: string[] = [];
    for (const sheet of rendered.value.sheets) {
      const document = parseHTML(sheet.svg).document;
      for (const r of document.querySelectorAll("[data-report-row]")) {
        const key = r.getAttribute("data-report-row")!;
        seen.push(key);
        const expected = table.rows.find((r) => r.key === key)!;
        const cells = [...r.querySelectorAll("[data-report-column]")].map(
          (cell) =>
            [...cell.querySelectorAll("text")]
              .map((t) => {
                expect(
                  Number(t.getAttribute("font-size")),
                ).toBeGreaterThanOrEqual(2.5);
                expect(t.textContent).toBe(t.textContent?.trim());
                return t.textContent?.replace(/\s/gu, "");
              })
              .join(""),
        );
        expect(cells).toEqual(expected.cells.map((c) => c.replace(/\s/gu, "")));
      }
    }
    expect(seen.sort()).toEqual(table.rows.map((r) => r.key).sort());
    expect(JSON.stringify(ir)).toBe(before);
  });
});
