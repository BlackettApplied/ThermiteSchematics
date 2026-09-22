import { beforeAll, describe, expect, it } from "vitest";
import { inflateSync } from "node:zlib";
import { compileProject, type ElectricalIr } from "@thermite/compiler";
import { renderSchematicPacket } from "@thermite/render";
import { packetPdf } from "../src/alpha-pdf.js";

let ir: ElectricalIr;
beforeAll(async () => {
  const compiled = await compileProject("examples/motor-starter");
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
  ir = compiled.ir;
});
async function packet(title: string) {
  const result = await renderSchematicPacket(ir, {
    format: "schematic-packet-request/0.1",
    views: [
      {
        format: "circuit-view-request/0.1",
        title,
        notes: ["Voltage A1−A2; signal A → B; literal & <text> stays text."],
        groups: [
          {
            id: "unconnected-coil",
            functions: [
              { device: { by: "designation", value: "K1" }, key: "coil" },
            ],
            conductors: [],
          },
        ],
      },
    ],
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}
function pdfStreams(bytes: Buffer): string {
  return [
    ...bytes
      .toString("latin1")
      .matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/gu),
  ]
    .flatMap((match) => {
      try {
        return [
          inflateSync(Buffer.from(match[1]!, "latin1")).toString("latin1"),
        ];
      } catch {
        return [];
      }
    })
    .join("\n");
}

describe("offline PDF glyph fallback", () => {
  it("embeds a math fallback for exact minus/arrow glyphs while preserving primary fonts and packet data", async () => {
    const input = await packet("A1−A2 → signal & return"),
      before = JSON.stringify(input);
    const pdf = await packetPdf(input, "Glyph coverage");
    expect(pdf.toString("latin1")).toContain("NotoSansMath-Regular");
    expect(pdf.toString("latin1")).toContain("NotoSans-Bold");
    expect(pdf.toString("latin1")).toContain("NotoSans-Regular");
    const cmap = pdfStreams(pdf);
    expect(cmap).toMatch(/<2212>/iu);
    expect(cmap).toMatch(/<2192>/iu);
    expect(JSON.stringify(input)).toBe(before);
    expect(await packetPdf(input, "Glyph coverage")).toEqual(pdf);
  });
  it("supports escaped numeric glyphs and inherited nested text without changing their Unicode values", async () => {
    const input = await packet("A1−A2 → signal & return");
    const changed = {
      ...input,
      sheets: input.sheets.map((sheet) => ({
        ...sheet,
        svg: sheet.svg
          .replaceAll("−", "&#x2212;")
          .replaceAll("→", "<tspan>&#8594;</tspan>"),
      })),
    };
    const streams = pdfStreams(await packetPdf(changed, "Escaped glyphs"));
    expect(streams).toMatch(/<2212>/iu);
    expect(streams).toMatch(/<2192>/iu);
  });
  it("still refuses a character outside both bundled font families", async () => {
    await expect(
      packetPdf(await packet("Unsupported 🚀"), "Unsupported"),
    ).rejects.toThrow('does not support "🚀" on sheet 1');
  });
  it("does not embed or select the fallback font when primary fonts cover all text", async () => {
    const input = await packet("Ordinary coil");
    const ordinary = {
      ...input,
      sheets: input.sheets.map((sheet) => ({
        ...sheet,
        svg: sheet.svg.replaceAll("−", "-").replaceAll("→", "to"),
      })),
    };
    const pdf = await packetPdf(ordinary, "Primary fonts");
    expect(pdf.toString("latin1")).not.toContain("NotoSansMath-Regular");
    expect(pdf.toString("latin1")).toContain("NotoSans-Bold");
  });
});
