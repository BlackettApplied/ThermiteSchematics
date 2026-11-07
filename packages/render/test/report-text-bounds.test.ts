import { beforeAll, describe, expect, it } from "vitest";
import { openSync } from "fontkit";
import { parseHTML } from "linkedom";
import { compileProject, type ElectricalIr } from "@thermite/compiler";
import { buildDocumentation } from "@thermite/query";
import { renderSchematicPacket } from "../src/sheets.js";
import {
  describeCodePoint,
  measureText,
  supportsGlyph,
  wrapText,
} from "../src/text-metrics.js";
import { metricSources } from "../src/text-metrics-data.js";

let ir: ElectricalIr;
const fonts = metricSources.map(({ source }) => {
  const font = openSync(source);
  if (!("unitsPerEm" in font)) throw Error("Expected one font");
  return font;
});
beforeAll(async () => {
  const c = await compileProject("examples/motor-starter");
  if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
  ir = c.ir;
});
const request = {
  format: "schematic-packet-request/0.1" as const,
  views: [
    {
      format: "documentation-view-request/0.1" as const,
      kind: "wires" as const,
    },
  ],
};
function wires(labels: string[]) {
  const input = structuredClone(ir);
  input.jumpers = [];
  input.cables = [];
  input.cableConductors = [];
  input.wires = labels.map((label, i) => ({
    ...input.wires[0]!,
    uid: `00000000-0000-4000-8000-${i.toString(16).padStart(12, "0")}`,
    designation: `ROW-${String(i + 1).padStart(4, "0")}`,
    properties: { label },
  }));
  return input;
}
async function checked(input: ElectricalIr) {
  const before = JSON.stringify(input),
    rendered = await renderSchematicPacket(input, request);
  if (!rendered.ok) throw Error(rendered.error.message);
  expect(JSON.stringify(input)).toBe(before);
  const table = buildDocumentation(input, request.views[0]!),
    expected = new Map(table.rows.map((row) => [row.key, row.cells])),
    seen = new Set<string>();
  for (const sheet of rendered.value.sheets) {
    const doc = parseHTML(sheet.svg).document;
    for (const cell of doc.querySelectorAll("[data-report-column]")) {
      const x = Number(cell.getAttribute("data-cell-x")),
        y = Number(cell.getAttribute("data-cell-y")),
        w = Number(cell.getAttribute("data-cell-width")),
        h = Number(cell.getAttribute("data-cell-height"));
      for (const t of cell.querySelectorAll("text")) {
        const value = t.textContent!;
        expect(value).toBe(value.trim());
        const size = Number(t.getAttribute("font-size")),
          tx = Number(t.getAttribute("x")),
          ty = Number(t.getAttribute("y")),
          metric = measureText(value, size);
        expect(size).toBeGreaterThanOrEqual(2.5);
        expect(tx).toBeGreaterThanOrEqual(x + 1.99);
        expect(tx + metric.width).toBeLessThanOrEqual(x + w - 1.98);
        expect(ty - metric.ascent).toBeGreaterThanOrEqual(y + 0.98);
        expect(ty + metric.descent).toBeLessThanOrEqual(y + h - 0.98);
        expect(t.hasAttribute("clip-path")).toBe(false);
        for (const font of fonts) {
          if (
            ![...value].every((c) =>
              font.hasGlyphForCodePoint(c.codePointAt(0)!),
            )
          )
            continue;
          const run = font.layout(value),
            scale = size / font.unitsPerEm;
          expect(tx + run.bbox.maxX * scale).toBeLessThanOrEqual(x + w - 0.99);
          expect(tx + run.bbox.minX * scale).toBeGreaterThanOrEqual(x + 0.99);
          expect(ty - run.bbox.maxY * scale).toBeGreaterThanOrEqual(y + 0.49);
          expect(ty - run.bbox.minY * scale).toBeLessThanOrEqual(y + h - 0.49);
        }
        // Every other column begins outside this text allocation.
        const siblings = cell.parentElement!.querySelectorAll(
          "[data-report-column]",
        );
        for (const neighbour of siblings) {
          if (
            neighbour === cell ||
            Number(neighbour.getAttribute("data-cell-y")) !== y
          )
            continue;
          const nx = Number(neighbour.getAttribute("data-cell-x")),
            nw = Number(neighbour.getAttribute("data-cell-width"));
          expect(tx + metric.width <= nx + 0.01 || tx >= nx + nw - 0.01).toBe(
            true,
          );
        }
      }
    }
    for (const row of doc.querySelectorAll("[data-report-row]")) {
      const key = row.getAttribute("data-report-row")!;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
      const cells = [...row.querySelectorAll("[data-report-column]")];
      for (const [i, cell] of cells.entries()) {
        const source = expected.get(key)![i]!.normalize("NFC");
        let cursor = 0;
        // Only whitespace at an emitted line boundary may disappear. Interior
        // authored spaces, including doubled spaces, must match byte for byte.
        for (const t of cell.querySelectorAll("text")) {
          while (/\s/u.test(source[cursor] ?? "")) cursor++;
          const line = t.textContent!;
          expect(source.slice(cursor, cursor + line.length)).toBe(line);
          cursor += line.length;
        }
        expect(source.slice(cursor).trim()).toBe("");
      }
      // Flatten paint order, including descendants of cell groups (m2b).
      let paintedText = false;
      for (const element of row.querySelectorAll("*")) {
        if (element.tagName.toLowerCase() === "text") paintedText = true;
        if (element.tagName.toLowerCase() === "rect")
          expect(paintedText).toBe(false);
      }
    }
  }
  expect([...seen].sort()).toEqual([...expected.keys()].sort());
  return rendered.value;
}

describe("report text bounds and information conservation", () => {
  it.each([
    ["120 W glyphs", "W".repeat(120)],
    ["narrow glyphs", "il".repeat(120)],
    [
      "combining marks and supported Unicode",
      "café e\u0301 Ω Ж µ → − ∑ ½ ".repeat(4),
    ],
    ["stacked combining marks", "e\u0301\u0302\u0323 ".repeat(8)],
    ["long single token", "CONTROL_CONNECTION_".repeat(30)],
    ["word boundaries and whitespace", "  alpha beta  gamma delta ".repeat(8)],
  ])("bounds every cell without losing %s", async (_name, label) => {
    await checked(wires([label]));
  });
  it("uses fewer lines for narrow glyphs and keeps whole words and graphemes", () => {
    expect(wrapText("i".repeat(120), 50, 2.6).length).toBeLessThan(
      wrapText("W".repeat(120), 50, 2.6).length,
    );
    const value = "alpha beta gamma delta";
    expect(wrapText(value, 22, 2.6).join("")).toBe(value);
    for (const line of wrapText(value, 22, 2.6))
      expect(
        line
          .trim()
          .split(/\s+/u)
          .every((word) => value.split(" ").includes(word)),
      ).toBe(true);
    const clusters = wrapText("e\u0301".repeat(40), 15, 2.6);
    expect(clusters.join("")).toBe("é".repeat(40));
    expect(clusters.every((s) => !s.startsWith("\u0301"))).toBe(true);
    expect(wrapText("unused", 12, 2.7)).toEqual(["unused"]);
  });
  it("paginates multi-line rows intact and preserves each of 1,500 rows exactly once", async () => {
    const labels = Array.from(
      { length: 1500 },
      (_, i) => `IDENTITY-${String(i).padStart(4, "0")}`,
    );
    const packet = await checked(wires(labels));
    expect(packet.sheets.length).toBeGreaterThan(1);
    const multi = await checked(
      wires(
        Array.from({ length: 45 }, (_, i) => `MULTI-${i} ${"W".repeat(120)}`),
      ),
    );
    expect(multi.sheets.length).toBeGreaterThan(1);
  });
  it("explains impossible rows with report, row identity and column", async () => {
    const input = wires(["W".repeat(10000)]),
      r = await renderSchematicPacket(input, request);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("R006");
    expect(r.error.message).toContain(
      'Report "Wire and core schedule" (wires), row 1',
    );
    expect(r.error.message).toContain(input.wires[0]!.designation);
    expect(r.error.message).not.toContain(input.wires[0]!.uid);
    expect(r.error.message).toContain('column 1 "Conductor / label"');
    expect(r.error.message).toContain("lines need");
    expect(r.error.message).toContain("minimum 2.5 mm");
    expect(r.error.message).toContain(
      "Use larger paper or shorter authored text.",
    );
    expect(r.error.message).not.toContain("wider report column");
  });
  it("measures unknown glyphs conservatively and refuses an unfit grapheme explicitly", () => {
    const measured = measureText("🚀", 2.6);
    expect(measured.unknownGlyphs).toEqual(["🚀"]);
    expect(measured.width).toBeGreaterThan(measureText("W", 2.6).width);
    expect(supportsGlyph("sans", 0x1f680)).toBe(false);
    expect(measureText("\uffff", 2.6).unknownGlyphs).toEqual(["\uffff"]);
    expect(measureText("\uffff", 2.6).width).toBeGreaterThan(
      measureText("W", 2.6).width,
    );
    expect(() => wrapText("W", 0.1, 2.6)).toThrow(
      "Text grapheme U+0057 (letter) cannot fit within 0.100 units at size 2.6.",
    );
  });
  it("bounds every normalized visible glyph in each declared input face", () => {
    for (const font of fonts)
      for (const code of font.characterSet) {
        if (!font.hasGlyphForCodePoint(code)) continue;
        const value = String.fromCodePoint(code).normalize("NFC");
        if (/\s|\p{Default_Ignorable_Code_Point}/u.test(value)) continue;
        const run = font.layout(value);
        expect(
          measureText(value, 1).width,
          `${font.postscriptName} U+${code.toString(16)}`,
        ).toBeGreaterThanOrEqual(run.advanceWidth / font.unitsPerEm - 0.000001);
        if (Number.isFinite(run.bbox.minX))
          expect(measureText(value, 1).width).toBeGreaterThanOrEqual(
            (run.bbox.maxX - run.bbox.minX) / font.unitsPerEm - 0.000001,
          );
      }
  });
  it("hangs break spaces on preceding lines without inventing indentation or losing characters", () => {
    const value = "Dž fi café 16 / C4 ".repeat(20),
      lines = wrapText(value, 24, 2.6);
    expect(lines.join("")).toBe(value.normalize("NFC"));
    expect(lines.every((line) => !/^\s+\S/u.test(line))).toBe(true);
  });
  it("names unknown glyphs and the row designation when fallback bounds cannot fit", async () => {
    const input = wires(["控".repeat(4000)]),
      result = await renderSchematicPacket(input, request);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('row 1 ("ROW-0001")');
    expect(result.error.message).toContain(
      "Unknown glyphs use bounded fallback metrics: U+63A7 (letter)",
    );
    expect(result.error.message).not.toContain(input.wires[0]!.uid);
    expect(result.error.message).toContain('column 1 "Conductor / label"');
    expect(result.error.message).not.toContain("控");
    const terminalInput = structuredClone(ir),
      device = terminalInput.devices[0]!,
      type = terminalInput.deviceTypes.find((t) => t.id === device.typeId)!;
    type.terminals[0]!.description = "控".repeat(4000);
    const terminalResult = await renderSchematicPacket(terminalInput, {
      ...request,
      views: [
        {
          format: "documentation-view-request/0.1",
          kind: "terminals",
          device: device.designation,
        },
      ],
    });
    expect(terminalResult.ok).toBe(false);
    if (terminalResult.ok) return;
    expect(terminalResult.error.message).toContain(device.designation);
    expect(terminalResult.error.message).not.toContain(device.uid);
  });
  it("reserves unknown metrics once per cluster and no extra mark advance", () => {
    expect(measureText("控", 1).width).toBe(1.5);
    const cluster = measureText("ปั๊", 1);
    expect(cluster.width).toBe(1.5);
    expect(cluster.ascent).toBe(1.2);
    expect(cluster.descent).toBe(0.4);
  });
});

it.each([
  ["CJK", "控制电源 制御電源 제어전원 " + "電".repeat(40)],
  ["Thai", "ปั๊มน้ำ ควบคุม ".repeat(4)],
  ["Devanagari", "नियंत्रण पंप ".repeat(4)],
])(
  "does not reject the previously printable %s label",
  async (_name, label) => {
    await checked(wires([label]));
  },
);

it.each([
  ["PUMP\u00adSTART W\u2060J A\u200eB", "PUMPSTART WJ AB"],
  ["\ufeffPUMP START", "PUMP START"],
  ["PUMP\u200bSTART", "PUMPSTART"],
  ["A\u200dB\u200cC\u200fD\u061cE\u2066F\u2069G\ufe0f", "ABCDEFG"],
])(
  "allocates no width or ink for default-ignorable characters: %s",
  (source, visible) => {
    expect(measureText(source!, 2.6)).toEqual(measureText(visible!, 2.6));
    expect(wrapText(source!, 15, 2.6).join("")).toBe(source!.normalize("NFC"));
  },
);

it.each([
  ["\u0301", "U+0301 (combining mark)"],
  ["\u200b", "U+200B (format character)"],
  ["控", "U+63A7 (letter)"],
  ["7", "U+0037 (number)"],
  ["🚀", "U+1F680 (symbol)"],
  [".", "U+002E (punctuation)"],
  [" ", "U+0020 (separator)"],
  ["\u0378", "U+0378 (other character)"],
])(
  "describes glyph categories without a name database: %s",
  (char, expected) => {
    expect(describeCodePoint(char!)).toBe(expected);
  },
);
