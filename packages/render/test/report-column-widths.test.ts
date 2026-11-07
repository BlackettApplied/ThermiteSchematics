import { renderSchematicPacket } from "../src/index.js";
import { readdir } from "node:fs/promises";
import { beforeAll, describe, expect, it } from "vitest";
import { parseHTML } from "linkedom";
import { compileProject, type ElectricalIr } from "@thermite/compiler";
import { buildDocumentation, type DocumentationTable } from "@thermite/query";
import { reportCells } from "../src/packet/report-cells.js";
import {
  reportColumns,
  reportTokens,
} from "../src/packet/report-column-widths.js";
import { tableDrafts } from "../src/packet/reports.js";
import { normalizePaperPage } from "../src/packet/page.js";
import { measureText } from "../src/text-metrics.js";
import { createTerminalIr } from "../../query/test/fixtures.js";
import { documentationFixture } from "../../query/test/documentation-fixture.js";

let fixture: ElectricalIr;
beforeAll(async () => {
  fixture = await documentationFixture();
});
const normalize = (s: string) => s.replace(/\s+/gu, " ").trim();
function checked(
  ir: ElectricalIr,
  table: DocumentationTable,
  size: "letter" | "a4" | "tabloid" | "a3",
  orientation: "landscape" | "portrait",
  marginMm = 10,
) {
  const page = normalizePaperPage({ size, orientation, marginMm });
  if (!page.ok) throw Error(page.error.message);
  const rendered = tableDrafts(ir, table, undefined, page.value);
  if (!rendered.ok) throw Error(rendered.error.message);
  for (const draft of rendered.value) {
    const doc = parseHTML(`<svg>${draft.content}</svg>`).document;
    const headers = [...doc.querySelectorAll("[data-report-column]")].slice(
      0,
      table.columns.length,
    );
    expect(headers).toHaveLength(table.columns.length);
    for (const [i, header] of headers.entries()) {
      const lines = [...header.querySelectorAll("text")].map(
        (t) => t.textContent ?? "",
      );
      for (let j = 0; j < lines.length - 1; j++) {
        if (!lines[j]!.endsWith("-")) continue;
        expect(doc.querySelector("[data-report-header-note]")).not.toBeNull();
        const prefix = lines[j]!.split(/\s+/u).at(-1)!.slice(0, -1);
        const suffix = lines[j + 1]!.split(/\s+/u)[0]!;
        expect([...prefix].length).toBeGreaterThanOrEqual(2);
        expect([...suffix].length).toBeGreaterThanOrEqual(3);
        const width = Number(header.getAttribute("data-cell-width"));
        const tx = Number(header.querySelector("text")!.getAttribute("x"));
        const inset = tx - Number(header.getAttribute("data-cell-x"));
        expect(measureText(prefix + suffix, 2.6).width).toBeGreaterThan(
          width - 2 * inset - 0.01,
        );
      }
      expect(
        normalize(
          [...header.querySelectorAll("text")]
            .map((t) => t.textContent)
            .join(" ")
            .replace(/- (?=\S)/gu, ""),
        ),
        `${size}/${orientation}/${table.columns[i]}`,
      ).toBe(normalize(table.columns[i]!));
    }
    for (const t of doc.querySelectorAll("[data-report-column] text"))
      expect(t.textContent).toBe(t.textContent?.trim());
    if (table.kind === "bom")
      for (const row of doc.querySelectorAll("[data-report-row]")) {
        const source = table.rows.find(
          (r) => r.key === row.getAttribute("data-report-row"),
        )!;
        const names = source.cells[1]!.split(/,\s*/u);
        const lines = [
          ...row.querySelectorAll('[data-report-column="2"] text'),
        ].map((t) => t.textContent!);
        for (const name of names)
          for (const part of reportTokens(name, [
            { value: name, kind: "designation" },
          ]))
            expect(
              lines.some((line) => line.includes(part.value)),
              part.value,
            ).toBe(true);
      }
  }
  return rendered.value;
}

describe("report header words and authored designations", () => {
  it.each(["CR-MOTOR-START-101", "CR MOTOR START 101"])(
    "does not break header words or the designation aspects of %s on any paper",
    (designation) => {
      const input = structuredClone(fixture);
      input.devices[0]!.designation = designation;
      for (const size of ["letter", "a4", "tabloid", "a3"] as const)
        for (const orientation of ["landscape", "portrait"] as const)
          checked(
            input,
            buildDocumentation(input, {
              format: "documentation-view-request/0.1",
              kind: "bom",
            }),
            size,
            orientation,
          );
    },
  );
  it("keeps the example BOM headers and designations whole on all eight papers ", async () => {
    for (const name of (await readdir("examples")).sort()) {
      const c = await compileProject(`examples/${name}`);
      if (!c.ok) continue;
      const table = buildDocumentation(c.ir, {
        format: "documentation-view-request/0.1",
        kind: "bom",
      });
      for (const size of ["letter", "a4", "tabloid", "a3"] as const)
        for (const orientation of ["landscape", "portrait"] as const)
          checked(c.ir, table, size, orientation);
    }
  });
  it.each([1, 12, 16, 20, 25, 30, 61, 75])(
    "keeps a %i-member synthetic group whole in ordinary/wide BOM settings",
    (count) => {
      const input = createTerminalIr(
        Array.from({ length: count }, (_, i) => ({
          uid: `col-${i}`,
          designation: `CR${100 + i}`,
          terminalKeys: ["T"],
        })),
      );
      const table = buildDocumentation(input, {
        format: "documentation-view-request/0.1",
        kind: "bom",
      });
      for (const size of ["letter", "a4", "tabloid", "a3"] as const)
        for (const orientation of ["landscape", "portrait"] as const)
          checked(input, table, size, orientation);
    },
  );
  it("refuses a genuine unfittable designation, never the header vocabulary alone", () => {
    const input = structuredClone(fixture);
    input.devices[0]!.designation = "CR" + "W".repeat(200);
    const bom = buildDocumentation(input, {
      format: "documentation-view-request/0.1",
      kind: "bom",
    });
    const page = normalizePaperPage({
      size: "letter",
      orientation: "landscape",
    });
    if (!page.ok) throw Error("page");
    const result = tableDrafts(input, bom, undefined, page.value);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain(
      'column 2 "Designations": designation',
    );
    expect(result.error.message.match(/Report /gu)).toHaveLength(1);
    expect(result.error.message.match(/Use larger paper/gu)).toHaveLength(1);
    expect(result.error.message).not.toContain("row header");
    expect(result.error.message).toContain("shorter authored text");
  });
});

// Round 8 regressions: URLs are prose, terminal suffixes can wrap, names cannot.
describe("authored separators and compact headers", () => {
  it.each([
    "Datasheet https://vendor.example.com/catalog/motors/M1/datasheet-rev-c.pdf",
    "Nameplate photo: docs/M1/nameplate/photo-2026-11-04-site-survey-original.jpg",
  ])("prints %s without reserving the entire token", (description) => {
    const input = structuredClone(fixture);
    input.devices.find((d) => d.designation === "M1")!.description =
      description;
    const table = buildDocumentation(input, {
      format: "documentation-view-request/0.1",
      kind: "bom",
    });
    for (const size of ["letter", "a4"] as const)
      checked(input, table, size, "portrait");
  });
  it("prints header-only narrow schedules with visible hyphens and an exact margin note", () => {
    for (const kind of ["cables", "io", "io-ports"] as const)
      for (const size of ["letter", "a4"] as const) {
        const page = normalizePaperPage({
          size,
          orientation: "portrait",
          marginMm: 25,
        });
        if (!page.ok) throw Error("page");
        const table = {
          ...buildDocumentation(fixture, {
            format: "documentation-view-request/0.1",
            kind,
          }),
          rows: [],
        };
        const result = tableDrafts(fixture, table, undefined, page.value);
        expect(result.ok, JSON.stringify(result)).toBe(true);
        if (!result.ok) continue;
        expect(result.value[0]!.content).toMatch(
          /Hyphenated headers; whole words at margins/u,
        );
        expect(result.value[0]!.content).toMatch(/-<\/text>/u);
      }
  });
});

describe("report line-break contract", () => {
  it.each([
    "+24V-PS1-PLC1",
    "PX1-PNP-OUT-PLC1-DI0",
    "LS1-RETURN-PLC1-DI0",
    "FIELD-JB1",
  ])("uses separators without cutting known names in %s", (value) => {
    const input = structuredClone(fixture);
    for (const [i, name] of [
      "+24V",
      "PS1",
      "PLC1",
      "PX1",
      "LS1",
      "FIELD",
      "JB1",
    ].entries())
      input.devices.push({
        ...input.devices[0]!,
        uid: `protect-${i}`,
        designation: name,
      });
    const table: DocumentationTable = {
      kind: "wires",
      title: "Breaks",
      columns: ["Text"],
      widths: [1],
      notes: [],
      rows: [{ key: "test", cells: [value], deviceUids: [] }],
    };
    const cell = reportCells(input, table, 24),
      lines = cell.split([value], "1")[0]!;
    expect(lines.join("")).toBe(value);
    for (const name of [
      "+24V",
      "PS1",
      "PLC1",
      "PX1",
      "LS1",
      "FIELD",
      "JB1",
    ].filter((name) => value.includes(name)))
      expect(
        lines.some((line) => line.includes(name)),
        JSON.stringify(lines),
      ).toBe(true);
  });
  it("reserves a standalone name's edge punctuation without reserving a containing path", () => {
    const table: DocumentationTable = {
      kind: "bom",
      title: "Punctuation",
      columns: ["X"],
      widths: [1],
      notes: [],
      rows: [{ key: "x", cells: ["(M1),"], deviceUids: [] }],
    };
    const bare = reportColumns(
      { ...table, rows: [{ ...table.rows[0]!, cells: ["M1"] }] },
      30,
      2.6,
      ["M1"],
    );
    const decorated = reportColumns(table, 30, 2.6, ["M1"]);
    expect(decorated.minimumWidth).toBeGreaterThan(bare.minimumWidth);
    const path = reportColumns(
      {
        ...table,
        rows: [
          {
            ...table.rows[0]!,
            cells: ["https://vendor.example/M1/datasheet.pdf"],
          },
        ],
      },
      30,
      2.6,
      ["M1"],
    );
    expect(path.minimumWidth).toBe(bare.minimumWidth);
  });
  it("computes the width boundary but does not promise row-height fit at that margin", () => {
    const input = structuredClone(fixture),
      name = "CR" + "W".repeat(48);
    input.devices[0]!.designation = name;
    const table: DocumentationTable = {
      kind: "bom",
      title: "Margin test",
      columns: ["Qty", "Designations"],
      widths: [0.1, 0.9],
      notes: [],
      rows: [
        { key: input.devices[0]!.uid, cells: ["1", name], deviceUids: [] },
      ],
    };
    const page = normalizePaperPage({
      size: "letter",
      orientation: "portrait",
      marginMm: 25,
    });
    if (!page.ok) throw Error("page");
    const a = reportColumns(table, 129.9, 2.6, [name]);
    expect(a.error).toBe(true);
    const margin =
      Math.floor((page.value.widthMm - 36 - a.minimumWidth) * 500) / 1000;
    expect(margin).toBeGreaterThanOrEqual(5);
    expect(margin).toBeLessThan(25);
    const cells = reportCells(input, table, 129.9, page.value);
    expect(() => cells.split(table.columns, "header")).toThrow(
      `column 2 "Designations": designation ${JSON.stringify(name)}`,
    );
    expect(() => cells.split(table.columns, "header")).toThrow(
      "Use larger paper, landscape, or a shorter designation.",
    );
    expect(
      reportColumns(table, page.value.widthMm - 36 - 2 * margin, 2.6, [name])
        .error,
    ).toBe(false);
    expect(
      reportColumns(
        table,
        page.value.widthMm - 36 - 2 * (margin + 0.001),
        2.6,
        [name],
      ).error,
    ).toBe(true);
  });
  it("guards every report kind at 5, 10 and 25 mm on all eight paper settings", () => {
    for (const kind of [
      "bom",
      "wires",
      "cables",
      "terminals",
      "io",
      "io-ports",
      "network",
      "assemblies",
    ] as const)
      for (const size of ["letter", "a4", "tabloid", "a3"] as const)
        for (const orientation of ["landscape", "portrait"] as const)
          for (const margin of [5, 10, 25])
            checked(
              fixture,
              buildDocumentation(fixture, {
                format: "documentation-view-request/0.1",
                kind,
              }),
              size,
              orientation,
              margin,
            );
  });
});

// Round 9: release only necessary header minima; authored names protect segments.
describe("minimal header hyphenation and segmented names", () => {
  const one = (value: string): DocumentationTable => ({
    kind: "wires",
    title: "Segments",
    columns: ["Text"],
    widths: [1],
    notes: [],
    rows: [{ key: "segment", cells: [value], deviceUids: [] }],
  });
  it("releases only the largest-saving column needed to fit", () => {
    const table = {
      ...one(""),
      columns: ["Designations", "Connected", "Qty", "Mfr."],
      widths: [1, 1, 1, 1],
      rows: [],
    };
    const full = reportColumns(table, 150, 2.6, []);
    const a = reportColumns(table, full.wholeWidth - 0.9, 2.6, []);
    expect(a.hyphenatedColumns.filter(Boolean)).toHaveLength(1);
    expect(a.hyphenatedColumns.slice(2)).toEqual([false, false]);
    expect(a.error).toBe(false);
    for (const [i, released] of a.hyphenatedColumns.entries())
      if (released)
        expect(
          a.minimumWidth + a.wholeMinimum[i]! - a.minimums[i]!,
        ).toBeGreaterThan(full.wholeWidth - 0.9);
  });
  it.each([
    ["CONTROL CABINET", "location", ["CONTROL", "CABINET"]],
    ["CABINET-DOOR", "location", ["CABINET-", "DOOR"]],
    [
      "=PLANT01+CABINET02-PUMPMOTOR",
      "designation",
      ["=PLANT01", "+CABINET02", "-PUMPMOTOR"],
    ],
  ] as const)("protects each segment of %s", (value, kind, parts) => {
    const input = structuredClone(fixture);
    if (kind === "location") input.devices[0]!.location = value;
    else input.devices[0]!.designation = value;
    const cells = reportCells(input, one(value), 35);
    const lines = cells.split([value], "1")[0]!;
    expect(lines.join("").replace(/ /gu, "")).toBe(value.replace(/ /gu, ""));
    for (const part of parts)
      expect(
        lines.some((line) => line.includes(part)),
        JSON.stringify(lines),
      ).toBe(true);
  });
  it("never starts an ordinary part-number line with its separator", () => {
    const value = "6ES7131-6BF01-0BA0";
    const cells = reportCells(fixture, one(value), 17);
    const lines = cells.split([value], "1")[0]!;
    expect(lines.join("")).toBe(value);
    expect(lines.every((line) => !line.startsWith("-"))).toBe(true);
  });
  it("wraps 40,000 name-dense characters without rescanning the remaining run", () => {
    const input = structuredClone(fixture);
    input.devices[0]!.designation = "PLC1";
    const value = "PLC1-".repeat(8000);
    const start = performance.now();
    const cells = reportCells(input, one(value), 30);
    expect(cells.split([value], "1")[0]!.join("")).toBe(value);
    expect(performance.now() - start).toBeLessThan(2000);
  });
});

it("never names an unsupported whole-header margin", () => {
  const input = structuredClone(fixture);
  input.devices[0]!.location = "CABINET";
  const table: DocumentationTable = {
    kind: "cables",
    title: "Header margin",
    columns: Array(8).fill("Designations"),
    widths: Array(8).fill(1),
    rows: [],
    notes: [],
  };
  const page = normalizePaperPage({
    size: "a4",
    orientation: "portrait",
    marginMm: 5,
  });
  if (!page.ok) throw Error("page");
  const cells = reportCells(input, table, page.value.widthMm - 46, page.value);
  const header = cells.split(table.columns, "header");
  expect(cells.geometry(header, true).headerNote).toBe(
    "Hyphenated headers; use larger paper or landscape for whole words.",
  );
});

it("prints every machine-demo cable header whole at the default portrait margin", async () => {
  const c = await compileProject("examples/machine-demo");
  if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
  const table = buildDocumentation(c.ir, {
    format: "documentation-view-request/0.1",
    kind: "cables",
  });
  for (const size of ["letter", "a4"] as const) {
    const sheets = checked(c.ir, table, size, "portrait");
    expect(
      sheets.every((s) => !s.content.includes("data-report-header-note")),
    ).toBe(true);
  }
});
it("does not hyphenate short header words when even their minimum cannot fit", () => {
  const table: DocumentationTable = {
    kind: "bom",
    title: "Short words",
    columns: ["Qty", "Mfr."],
    widths: [1, 1],
    rows: [],
    notes: [],
  };
  const columns = reportColumns(table, 5, 2.6, []);
  expect(columns.error).toBe(true);
  expect(columns.hyphenatedColumns).toEqual([false, false]);
  const cells = reportCells(fixture, table, 5);
  expect(() => cells.split(table.columns, "header")).toThrow(
    /header .*Use larger paper, landscape\./u,
  );
});
it("gives row-height advice without a width-only margin promise for a long48 instance", () => {
  const input = structuredClone(fixture);
  input.devices[0]!.designation = (
    "=PLANT01+CABINET02-PUMPMOTOR-" + "M".repeat(48)
  ).slice(0, 48);
  input.devices[0]!.description = "W".repeat(2000);
  const table = buildDocumentation(input, {
    format: "documentation-view-request/0.1",
    kind: "bom",
  });
  const page = normalizePaperPage({
    size: "letter",
    orientation: "portrait",
    marginMm: 10,
  });
  if (!page.ok) throw Error("page");
  const r = tableDrafts(input, table, undefined, page.value);
  expect(r.ok).toBe(false);
  if (r.ok) return;
  expect(r.error.message).toContain("lines need");
  expect(r.error.message).toContain(
    "Use larger paper, landscape, or shorter authored text.",
  );
  expect(r.error.message).not.toMatch(/wider report column|margin of/u);
});

it.each(["fromLocation", "toLocation"] as const)(
  "protects words in a loose cable's authored %s without a device at that location",
  (field) => {
    const input = structuredClone(fixture);
    input.cables[0]![field] = "REMOTE LONGLOCATION";
    const table: DocumentationTable = {
      kind: "cables",
      title: "Loose cable locations",
      columns: ["Text", "Other"],
      widths: [0.1, 0.9],
      notes: [],
      rows: [
        {
          key: input.cables[0]!.uid,
          cells: [input.cables[0]![field]!, ""],
          deviceUids: [],
        },
      ],
    };
    const cells = reportCells(input, table, 60);
    const lines = cells.split(table.rows[0]!.cells, "1")[0]!;
    expect(lines.some((line) => line.includes("REMOTE"))).toBe(true);
    expect(
      lines.some((line) => line.includes("LONGLOCATION")),
      JSON.stringify(lines),
    ).toBe(true);
  },
);

// Round 10: punctuation alone does not make a designation aspect-structured.
it.each(["W-CTL-005-M2", "PE-HMI", "W-RIO1-L+"])(
  "keeps the entire flat designation %s, including overlapping names",
  (designation) => {
    const input = structuredClone(fixture);
    input.devices[0]!.designation = designation;
    input.devices.push({
      ...input.devices[0]!,
      uid: "shorter-name",
      designation: "W-CTL-005",
    });
    const table: DocumentationTable = {
      kind: "wires",
      title: "Flat names",
      columns: ["Text", "Other"],
      widths: [0.1, 0.9],
      notes: [],
      rows: [{ key: "flat", cells: [designation, ""], deviceUids: [] }],
    };
    const cells = reportCells(input, table, 70);
    expect(cells.split([designation, ""], "1")[0]).toEqual([designation]);
  },
);
it("names the whole structured designation in a width refusal", () => {
  const input = structuredClone(fixture),
    designation = "=PLANT01+CABINET02-PUMPMOTOR-" + "M".repeat(19);
  input.devices[0]!.designation = designation;
  const table: DocumentationTable = {
    kind: "bom",
    title: "Whole name",
    columns: ["Qty", "Designations"],
    widths: [0.1, 0.9],
    notes: [],
    rows: [{ key: "width", cells: ["1", designation], deviceUids: [] }],
  };
  const cells = reportCells(input, table, 40);
  expect(() => cells.split(table.columns, "header")).toThrow(
    `column 2 "Designations": designation ${JSON.stringify(designation)}`,
  );
});
it.each(["portrait", "landscape"] as const)(
  "gives actionable row and header advice on %s paper",
  (orientation) => {
    const input = structuredClone(fixture);
    input.devices[0]!.description = "W".repeat(2000);
    const table = buildDocumentation(input, {
      format: "documentation-view-request/0.1",
      kind: "bom",
    });
    const p = normalizePaperPage({ size: "letter", orientation, marginMm: 10 });
    if (!p.ok) throw Error("page");
    const expected =
      orientation === "landscape"
        ? "Use larger paper or shorter authored text."
        : "Use larger paper, landscape, or shorter authored text.";
    for (const report of [
      table,
      { ...table, rows: [], notes: Array(100).fill("Authored report note") },
    ]) {
      const result = tableDrafts(input, report, undefined, p.value);
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.error.message.endsWith(expected)).toBe(true);
    }
  },
);
it("prints the unsupported-margin header note through the packet path", async () => {
  const input = createTerminalIr([
    { uid: "note-device", designation: "M1", terminalKeys: ["T"] },
  ]);
  const page = {
    size: "a4" as const,
    orientation: "portrait" as const,
    marginMm: 5,
  };
  let found = false;
  for (let length = 20; length <= 80; length++) {
    input.devices[0]!.location = "W".repeat(length);
    const table = buildDocumentation(input, {
      format: "documentation-view-request/0.1",
      kind: "bom",
    });
    const columns = reportColumns(table, 164, 2.6, [
      { value: input.devices[0]!.location!, kind: "location" },
    ]);
    if (columns.error || columns.wholeWidth <= 164) continue;
    found = true;
    const packet = await renderSchematicPacket(input, {
      format: "schematic-packet-request/0.1",
      page,
      views: [{ format: "documentation-view-request/0.1", kind: "bom" }],
    });
    expect(packet.ok, JSON.stringify(packet)).toBe(true);
    if (!packet.ok) return;
    const doc = parseHTML(packet.value.sheets[0]!.svg).document;
    expect(doc.querySelector("[data-report-header-note]")?.textContent).toBe(
      "Hyphenated headers; use larger paper or landscape for whole words.",
    );
    expect(
      [...doc.querySelectorAll("[data-report-column] text")].some((t) =>
        t.textContent?.endsWith("-"),
      ),
    ).toBe(true);
    break;
  }
  expect(found).toBe(true);
});
it("prints the landscape unsupported-margin header note through the packet path", async () => {
  const input = createTerminalIr([
    { uid: "note-device", designation: "M1", terminalKeys: ["T"] },
  ]);
  const page = {
    size: "a3" as const,
    orientation: "landscape" as const,
    marginMm: 5,
  };
  let found = false;
  for (let length = 80; length <= 200; length++) {
    input.devices[0]!.location = "W".repeat(length);
    const table = buildDocumentation(input, {
      format: "documentation-view-request/0.1",
      kind: "bom",
    });
    const columns = reportColumns(table, 374, 2.6, [
      { value: input.devices[0]!.location!, kind: "location" },
    ]);
    if (columns.error || columns.wholeWidth <= 374) continue;
    found = true;
    const packet = await renderSchematicPacket(input, {
      format: "schematic-packet-request/0.1",
      page,
      views: [{ format: "documentation-view-request/0.1", kind: "bom" }],
    });
    expect(packet.ok, JSON.stringify(packet)).toBe(true);
    if (!packet.ok) return;
    const doc = parseHTML(packet.value.sheets[0]!.svg).document;
    expect(doc.querySelector("[data-report-header-note]")?.textContent).toBe(
      "Hyphenated headers; use larger paper for whole words.",
    );
    expect(
      [...doc.querySelectorAll("[data-report-column] text")].some((t) =>
        t.textContent?.endsWith("-"),
      ),
    ).toBe(true);
    break;
  }
  expect(found).toBe(true);
});
