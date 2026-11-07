import { readFile, readdir } from "node:fs/promises";
import { beforeAll, describe, expect, it } from "vitest";
import { compileProject, type ElectricalIr } from "@thermite/compiler";
import { renderSchematicPacket } from "@thermite/render";
import { buildDocumentation } from "../src/documentation.js";
import { buildCableSchedule } from "../src/cable-schedule.js";
import { measureText } from "../../render/src/text-metrics.js";
import { documentationFixture } from "./documentation-fixture.js";

const papers = [
  { size: "letter", orientation: "landscape" },
  { size: "letter", orientation: "portrait" },
  { size: "a4", orientation: "landscape" },
  { size: "a4", orientation: "portrait" },
] as const;
let dol: ElectricalIr, fixture: ElectricalIr;
beforeAll(async () => {
  const c = await compileProject(
    "packages/core-library/test/fixtures/dol-starter",
  );
  if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
  dol = c.ir;
  fixture = await documentationFixture();
});
function wide(input: ElectricalIr) {
  const ir = structuredClone(input);
  for (let i = 1; i <= 20; i++)
    ir.devices.push({
      ...ir.devices[0]!,
      uid: `description-group-${i}`,
      designation: `CR${100 + i}`,
      location: "SPARES",
      description: undefined,
    });
  return ir;
}
async function prints(input: ElectricalIr, kind: "bom" | "cables") {
  for (const page of papers) {
    const result = await renderSchematicPacket(input, {
      format: "schematic-packet-request/0.1",
      page: { ...page, marginMm: 10 },
      views: [{ format: "documentation-view-request/0.1", kind }],
    });
    expect(
      result.ok,
      `${kind} ${page.size} ${page.orientation}: ${JSON.stringify(result.ok ? null : result.error)}`,
    ).toBe(true);
  }
}
const report = (input: ElectricalIr, kind: "bom" | "cables") =>
  buildDocumentation(input, { format: "documentation-view-request/0.1", kind });

describe("bounded printed type descriptions", () => {
  it("prints both DOL power-cable repros on letter/A4 in both orientations", async () => {
    await prints(dol, "cables");
    const input = wide(dol);
    expect(report(input, "bom").widths[1]).toBe(0.23);
    await prints(input, "bom");
  });
  it.each(["W", "電"])(
    "prints a custom 2,000-character %s type in both BOM column sets and the cable schedule without changing IR or JSON",
    async (glyph) => {
      const input = structuredClone(fixture),
        description = glyph.repeat(2000);
      if (glyph === "電")
        expect(measureText(glyph, 2.6).unknownGlyphs).toContain(glyph);
      for (const t of input.deviceTypes) t.description = description;
      for (const t of input.cableTypes) t.description = description;
      const before = JSON.stringify(input),
        jsonBefore = JSON.stringify(
          buildCableSchedule(input, input.cables[0]!.uid),
        );
      for (const [index, ir] of [input, wide(input)].entries()) {
        const bom = report(ir, "bom");
        expect(bom.widths[1]).toBe(index === 1 ? 0.23 : 0.1);
        expect(
          bom.rows.every(
            (r) => [...r.cells[5]!].length <= 160 && r.cells[5]!.endsWith("…"),
          ),
        ).toBe(true);
        await prints(ir, "bom");
      }
      expect(report(input, "cables").rows[0]!.cells[1]).toBe(
        glyph.repeat(159) + "…",
      );
      await prints(input, "cables");
      expect(buildCableSchedule(input, input.cables[0]!.uid).description).toBe(
        description,
      );
      expect(
        JSON.stringify(buildCableSchedule(input, input.cables[0]!.uid)),
      ).toBe(jsonBefore);
      expect(JSON.stringify(input)).toBe(before);
    },
  );
  it("uses the first sentence or line, marks omissions and never abbreviates instance text", () => {
    const input = structuredClone(fixture),
      motor = input.devices.find((d) => d.designation === "M1")!;
    motor.description = "Instance requirement.\n" + "W".repeat(2000);
    const type = input.deviceTypes.find((t) => t.id === motor.typeId)!;
    for (const [authored, printed] of [
      ["First sentence. More detail.", "First sentence. More detail."],
      ["First line\nMore detail", "First line…"],
      ["\nLeading newline then text", "Leading newline then text"],
      ["   \nBlank first line then text", "Blank first line then text"],
      ["\u2028\u2029Next visible line", "Next visible line"],
      ["2.5 mm cable", "2.5 mm cable"],
      ["Text\n", "Text"],
      ["Text\n   ", "Text"],
      ["\nText\n", "Text"],
      ["Short description.", "Short description."],
      [" ", type.id],
    ]) {
      type.description = authored;
      const row = report(input, "bom").rows.find((r) =>
        r.deviceUids.includes(motor.uid),
      )!;
      expect(row.cells[5]).toBe(printed);
      expect(row.cells[6]).toBe(motor.description);
    }
    type.description = "A".repeat(158) + "😀" + "B".repeat(2000);
    const text = report(input, "bom").rows.find((r) =>
      r.deviceUids.includes(motor.uid),
    )!.cells[5]!;
    expect([...text].length).toBeLessThanOrEqual(160);
    expect(text).toBe("A".repeat(158) + "…");
    expect(report(input, "bom").notes.join(" ")).toMatch(
      /Type description shortened; full text: thermite inspect <designation> --type-description/u,
    );
  });
  it.each(["\nText", "Text\n", "  \nText\n  ", "\u2028Text\u2029"])(
    "does not mark blank surrounding lines as shortened: %j",
    (authored) => {
      const input = structuredClone(fixture);
      for (const type of [...input.deviceTypes, ...input.cableTypes])
        type.description = authored;
      const exact = JSON.stringify(input);
      for (const kind of ["bom", "cables"] as const) {
        const table = report(input, kind);
        expect(table.notes.join(" ")).not.toContain(
          "Type description shortened",
        );
        expect(
          table.rows.every(
            (row) => row.cells[kind === "bom" ? 5 : 1] === "Text",
          ),
        ).toBe(true);
        const csv = buildDocumentation(
          input,
          { format: "documentation-view-request/0.1", kind },
          undefined,
          { output: "csv" },
        );
        expect(
          csv.rows.every(
            (row) => row.cells[kind === "bom" ? 5 : 1] === authored,
          ),
        ).toBe(true);
      }
      expect(JSON.stringify(input)).toBe(exact);
    },
  );
  it("preserves fitting qualifiers in the shipped e-stop, pilot caps and contact block", async () => {
    const descriptions = [
      dol.deviceTypes.find((t) => t.id === "core:estop-nc")!.description!,
      "Max. 10 A. Not rated for DC.",
    ];
    for (const path of [
      "libraries/stahl-pilot/types/8570002140.json",
      "libraries/stahl-pilot/types/8571001140.json",
      "libraries/schneider-pilot/types/gvae20.json",
    ]) {
      const data = JSON.parse(await readFile(path, "utf8")) as {
        types: { description: string }[];
      };
      descriptions.push(data.types[0]!.description);
    }
    for (const description of descriptions) {
      expect([...description].length).toBeLessThanOrEqual(160);
      const input = structuredClone(fixture);
      for (const type of input.deviceTypes) type.description = description;
      for (const type of input.cableTypes) type.description = description;
      expect(
        report(input, "bom").rows.every((r) => r.cells[5] === description),
      ).toBe(true);
      expect(
        report(input, "cables").rows.every((r) => r.cells[1] === description),
      ).toBe(true);
    }
  });
  it("prefers complete sentences and words and never splits a grapheme cluster", () => {
    const input = structuredClone(fixture),
      type = input.deviceTypes[0]!;
    const preview = (description: string) => {
      type.description = description;
      return report(input, "bom").rows.find((r) =>
        r.deviceUids.includes(
          input.devices.find((d) => d.typeId === type.id)!.uid,
        ),
      )!.cells[5]!;
    };
    expect(
      preview(
        "First safe sentence. Second safe sentence. " + "word ".repeat(100),
      ),
    ).toBe("First safe sentence. Second safe sentence…");
    expect(preview("word ".repeat(100))).toMatch(/word…$/u);
    for (const cluster of ["e\u0301", "👩‍👩‍👧‍👧", "👍🏽"]) {
      const text = cluster.repeat(2000),
        out = preview(text),
        prefix = out.slice(0, -1);
      expect(out.endsWith("…")).toBe(true);
      expect([...out].length).toBeLessThanOrEqual(160);
      expect(text.startsWith(prefix)).toBe(true);
      expect(prefix.length % cluster.length).toBe(0);
    }
    expect(preview("Short text...")).toBe("Short text...");
  });
  it.each(["\n", "\u2028", "\u2029"])(
    "bounds 80 line segments separated by %s on tabloid, letter and A4",
    async (separator) => {
      const input = structuredClone(fixture);
      for (const type of input.deviceTypes)
        type.description = Array(80).fill("X").join(separator);
      for (const type of input.cableTypes)
        type.description = Array(80).fill("X").join(separator);
      for (const [ir, kind] of [
        [input, "bom"],
        [wide(input), "bom"],
        [input, "cables"],
      ] as const) {
        const table = report(ir, kind);
        expect(
          table.rows.every((r) => r.cells[kind === "bom" ? 5 : 1] === "X…"),
        ).toBe(true);
        await prints(ir, kind);
        const result = await renderSchematicPacket(ir, {
          format: "schematic-packet-request/0.1",
          page: { size: "tabloid", orientation: "landscape", marginMm: 10 },
          views: [{ format: "documentation-view-request/0.1", kind }],
        });
        expect(result.ok).toBe(true);
      }
    },
  );
  it("keeps CSV type text and header names full, with identical rows and unabridged instances", () => {
    const input = structuredClone(fixture),
      description = "First sentence. " + "word ".repeat(400);
    for (const t of input.deviceTypes) t.description = description;
    for (const t of input.cableTypes) t.description = description;
    for (const kind of ["bom", "cables"] as const) {
      const printed = report(input, kind),
        csv = buildDocumentation(
          input,
          { format: "documentation-view-request/0.1", kind },
          undefined,
          { output: "csv" },
        );
      expect(csv.rows.map((r) => r.key)).toEqual(
        printed.rows.map((r) => r.key),
      );
      expect(
        csv.rows.every((r) => r.cells[kind === "bom" ? 5 : 1] === description),
      ).toBe(true);
      if (kind === "bom") {
        expect(csv.columns[3]).toBe("Manufacturer");
        expect(printed.columns[3]).toBe("Mfr.");
        expect(csv.rows.map((r) => r.cells[6])).toEqual(
          printed.rows.map((r) => r.cells[6]),
        );
      }
    }
  });
  it("prints shortening and missing-type notes only for retained affected types, never for blank instance text", () => {
    const input = structuredClone(fixture);
    expect(report(input, "bom").notes.join(" ")).not.toMatch(
      /Type description shortened|No .*type description/u,
    );
    input.devices[0]!.description = " ";
    expect(report(input, "bom").notes.join(" ")).not.toMatch(
      /No .*type description/u,
    );
    input.deviceTypes[0]!.description = " ";
    expect(report(input, "bom").notes.join(" ")).toContain(
      "No type description: type ID shown.",
    );
    input.deviceTypes[0]!.description = "W".repeat(2000);
    expect(report(input, "bom").notes.join(" ")).toContain(
      "Type description shortened;",
    );
    const selected = buildDocumentation(input, {
      format: "documentation-view-request/0.1",
      kind: "bom",
      filter: { devices: ["LS1"] },
    });
    expect(selected.notes.join(" ")).not.toContain(
      "Type description shortened;",
    );
  });
  it("fits every shipped type description in both BOM sets and the cable schedule on letter/A4", async () => {
    let checked = 0;
    const directories = [
      "packages/core-library/library/types",
      ...(
        await readdir("packages/core-library/versions", { withFileTypes: true })
      )
        .filter((e) => e.isDirectory())
        .map((e) => `packages/core-library/versions/${e.name}/types`),
    ];
    for (const dir of directories) {
      for (const file of (await readdir(dir, { recursive: true }))
        .filter((f) => f.endsWith(".json"))
        .sort()) {
        const document = JSON.parse(
          await readFile(`${dir}/${file}`, "utf8"),
        ) as { types: { id: string; description?: string }[] };
        for (const t of document.types) {
          const ir = structuredClone(fixture);
          for (const d of ir.deviceTypes) d.description = t.description;
          for (const c of ir.cableTypes) c.description = t.description;
          await prints(ir, "bom");
          const wideIr = wide(ir);
          expect(report(wideIr, "bom").widths[1]).toBe(0.23);
          await prints(wideIr, "bom");
          await prints(ir, "cables");
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThanOrEqual(39);
  });
});
