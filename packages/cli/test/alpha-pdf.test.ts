import { beforeAll, describe, expect, it } from "vitest";
import { inflateSync } from "node:zlib";
import { readFile } from "node:fs/promises";
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
    ).rejects.toThrow(
      "PDF font does not support U+1F680 (symbol) on sheet 1. Use SVG/HTML or a supported label.",
    );
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

// Read the emitted geometry, not the searchable text layer: clipped-away PDF
// text remains searchable. Coordinates include the PDF graphics-state CTM.
type Matrix = [number, number, number, number, number, number];
type Point = [number, number];
function pdfTextClips(bytes: Buffer) {
  const point = ([a, b, c, d, e, f]: Matrix, x: number, y: number): Point => [
    a * x + c * y + e,
    b * x + d * y + f,
  ];
  let matrix: Matrix = [1, 0, 0, 1, 0, 0],
    clips: Point[][] = [],
    path: Point[] = [];
  const stack: { matrix: Matrix; clips: Point[][] }[] = [],
    text: { clip: Point[]; origin: Point }[] = [];
  for (const line of pdfStreams(bytes).split("\n")) {
    const tokens = line.trim().split(/\s+/u),
      op = tokens.pop(),
      values = tokens.map(Number);
    if (op === "q") stack.push({ matrix, clips });
    else if (op === "Q") ({ matrix, clips } = stack.pop()!);
    else if (op === "cm") {
      const [a, b, c, d, e, f] = values as Matrix,
        [ma, mb, mc, md] = matrix,
        [x, y] = point(matrix, e, f);
      matrix = [
        ma * a + mc * b,
        mb * a + md * b,
        ma * c + mc * d,
        mb * c + md * d,
        x,
        y,
      ];
    } else if (op === "m") path = [point(matrix, values[0]!, values[1]!)];
    else if (op === "l") path.push(point(matrix, values[0]!, values[1]!));
    else if (op === "W" || op === "W*" || line === "W n" || line === "W* n")
      clips = [...clips, path];
    else if (op === "BT")
      text.push({ clip: clips.at(-1)!, origin: [NaN, NaN] });
    else if (op === "Tm" && Number.isNaN(text.at(-1)!.origin[0]))
      text.at(-1)!.origin = point(matrix, values[4]!, values[5]!);
  }
  expect(stack).toHaveLength(0);
  return text;
}

// Local label coordinates deliberately cross the numeric MediaBox bounds.
// The folded viewport maps them back to the same visible position on paper.
async function clippedLabel(
  label: string,
  x: number,
  y: number,
  width: number,
) {
  const input = await packet("Clip geometry"),
    svg = [
      '<svg xmlns="http://www.w3.org/2000/svg" width="431.8mm" height="279.4mm" viewBox="0 0 431.8 279.4">',
      '<g transform="translate(10 20)">',
      `<svg x="30" y="40" width="50" height="25" viewBox="${x - 10} ${y - 10} 200 100" overflow="hidden">`,
      '<defs><clipPath id="clip-label" clipPathUnits="userSpaceOnUse">',
      `<rect width="${width}" height="14" x="${x}" y="${y}"/>`,
      "</clipPath></defs>",
      `<text class="label-text label-terminal" clip-path="url(#clip-label)" x="${x + 3}" y="${y + 7}" font-family="monospace" font-size="10" dominant-baseline="middle" textLength="${width - 6}" lengthAdjust="spacingAndGlyphs">${label}</text>`,
      "</svg></g></svg>",
    ].join("\n");
  return { ...input, sheets: [{ ...input.sheets[0]!, svg }] };
}

describe("PDF label clipping geometry", () => {
  it.each([
    ["OL1", 1500, 100, 24.6],
    ["2/T1", 1210, 100, 30.8],
    ["W-PWR", 100, 1800, 37],
    ["FIELD", -300, -300, 37],
  ] as const)(
    "keeps %s visible beyond the untransformed page bounds",
    async (label, x, y, width) => {
      const input = await clippedLabel(label, x, y, width),
        before = JSON.stringify(input),
        pdf = await packetPdf(input, "Clip geometry"),
        texts = pdfTextClips(pdf),
        scale = 72 / 25.4,
        left = 42.5 * scale,
        top = 792 - 62.5 * scale;
      expect(texts).toHaveLength(1);
      // Check the actual PDF clip and text origin after every enclosing transform.
      // Merely checking extracted text would pass for the broken PDFs as well.
      expect(texts[0]!.clip).toHaveLength(4);
      const expected = [
        [left, top],
        [left + (width * scale) / 4, top],
        [left + (width * scale) / 4, top - (14 * scale) / 4],
        [left, top - (14 * scale) / 4],
      ];
      for (const [i, corner] of expected.entries())
        for (const axis of [0, 1] as const)
          expect(texts[0]!.clip[i]![axis]).toBeCloseTo(corner[axis]!, 4);
      expect(texts[0]!.origin[0]).toBeCloseTo(left + (3 * scale) / 4, 4);
      expect(texts[0]!.origin[1]).toBeLessThan(top);
      expect(texts[0]!.origin[1]).toBeGreaterThan(top - (14 * scale) / 4);
      expect(pdf.toString("latin1")).not.toContain("/SMask");
      expect(JSON.stringify(input)).toBe(before);
    },
  );

  it("preserves an intentionally narrow clip instead of dropping clipping", async () => {
    const input = await clippedLabel("2/T1", 1500, 100, 30.8);
    input.sheets[0]!.svg = input.sheets[0]!.svg.replace(
      '<rect width="30.8"',
      '<rect width="2"',
    );
    const pdf = await packetPdf(input, "Narrow clip"),
      [text] = pdfTextClips(pdf);
    expect(text!.clip[1]![0] - text!.clip[0]![0]).toBeCloseTo(
      (2 * 72) / 25.4 / 4,
      4,
    );
    // Text starts outside this deliberately undersized clip and must stay hidden.
    expect(text!.origin[0]).toBeGreaterThan(text!.clip[1]![0]);
    expect(pdf.toString("latin1")).not.toContain("/SMask");
  });

  it("refuses an unrecognized label clip instead of silently losing it", async () => {
    const input = await clippedLabel("OL1", 1500, 100, 24.6);
    input.sheets[0]!.svg = input.sheets[0]!.svg.replace(
      "url(#clip-label)",
      "url(#missing)",
    );
    await expect(packetPdf(input, "Missing clip")).rejects.toThrow(
      "Unsupported PDF label clip on sheet 1. Use SVG/HTML or a supported rectangular label clip.",
    );
  });

  it("accepts reordered rectangle attributes and XML whitespace/quotes without changing geometry", async () => {
    const input = await clippedLabel("OL1", 1500, 100, 24.6),
      expected = await packetPdf(input, "Attribute order");
    for (const rect of [
      '<rect x="1500" y="100" width="24.6" height="14"/>',
      "<rect\n height = '14' x = '1500'\n width = '24.6' y = '100' ></rect>",
    ]) {
      const changed = {
        ...input,
        sheets: [
          {
            ...input.sheets[0]!,
            svg: input.sheets[0]!.svg.replace(/<rect[^>]*\/>/u, rect)
              .replace(
                '<clipPath id="clip-label" clipPathUnits="userSpaceOnUse">',
                "<clipPath\n clipPathUnits = 'userSpaceOnUse' id = 'clip-label' >",
              )
              .replace(
                'clip-path="url(#clip-label)"',
                "clip-path = 'url(#clip-label)'",
              ),
          },
        ],
      };
      expect(await packetPdf(changed, "Attribute order")).toEqual(expected);
    }
  });

  it.each([
    '<rect width="0" height="14" x="1500" y="100"/>',
    '<rect width="24.6" height="0" x="1500" y="100"/>',
    '<rect width="0" height="0" x="1500" y="100"/>',
  ])("drops text behind a zero-area clip: %s", async (rect) => {
    const input = await clippedLabel("OL1", 1500, 100, 24.6);
    input.sheets[0]!.svg = input.sheets[0]!.svg.replace(/<rect[^>]*\/>/u, rect);
    const before = JSON.stringify(input),
      pdf = await packetPdf(input, "Empty clip");
    expect(pdfTextClips(pdf)).toHaveLength(0);
    expect(pdf.toString("latin1")).not.toContain("/SMask");
    expect(pdfStreams(pdf)).not.toContain("NaN");
    expect(JSON.stringify(input)).toBe(before);
  });

  it("does not validate font coverage for text hidden by an empty clip", async () => {
    const input = await clippedLabel("Hidden 🚀", 1500, 100, 24.6);
    input.sheets[0]!.svg = input.sheets[0]!.svg.replace(
      '<rect width="24.6"',
      '<rect width="0"',
    );
    const pdf = await packetPdf(input, "Invisible glyphs");
    expect(pdfTextClips(pdf)).toHaveLength(0);
  });

  it.each([
    '<circle cx="1500" cy="100" r="14"/>',
    '<rect width="24.6" height="14" x="1500" y="100" rx="2"/>',
    '<rect width="-1" height="14" x="1500" y="100"/>',
    '<rect width="NaN" height="14" x="1500" y="100"/>',
    '<rect width="24.6" height="14" x="1500" y="100" transform="translate(1 0)"/>',
  ])(
    "refuses an existing unsupported clip with sheet context and advice: %s",
    async (shape) => {
      const input = await clippedLabel("OL1", 1500, 100, 24.6);
      input.sheets[0]!.number = 7;
      input.sheets[0]!.svg = input.sheets[0]!.svg.replace(
        /<rect[^>]*\/>/u,
        shape,
      );
      await expect(packetPdf(input, "Unsupported clip")).rejects.toThrow(
        "Unsupported PDF label clip on sheet 7. Use SVG/HTML or a supported rectangular label clip.",
      );
    },
  );

  it.each([
    ["clip-path", 'clip-path="url(#clip-label)"'],
    ["clip-path", "clip-path = 'url(#clip-label)'"],
    ["mask", 'mask="url(#clip-label)"'],
    ["mask", "mask = 'url(#clip-label)'"],
  ])(
    "refuses remaining %s attributes on groups",
    async (attribute, authored) => {
      const input = await clippedLabel("OL1", 1500, 100, 24.6);
      input.sheets[0]!.number = 9;
      input.sheets[0]!.svg = input.sheets[0]!.svg.replace(
        "<g ",
        `<g ${authored} `,
      );
      await expect(packetPdf(input, "Group mask")).rejects.toThrow(
        `Unsupported PDF ${attribute} attribute on sheet 9. Use SVG/HTML or a supported rectangular label clip.`,
      );
    },
  );

  it("does not treat escaped text or other attribute values as clip/mask attributes", async () => {
    const input = await clippedLabel(
      "literal clip-path=&quot;url(#text)&quot; mask=&quot;none&quot;",
      1500,
      100,
      300,
    );
    input.sheets[0]!.svg = input.sheets[0]!.svg.replace(
      "<g ",
      '<g aria-label="literal clip-path=none mask=none" ',
    ).replace(
      "<text ",
      "<text aria-label=\"literal clip-path='url(#text)' mask='none'\" ",
    );
    const pdf = await packetPdf(input, "Literal attributes");
    expect(pdfTextClips(pdf)).toHaveLength(1);
    expect(pdf.toString("latin1")).not.toContain("/SMask");
  });

  it("keeps fallback font spans inside the same label clip", async () => {
    const input = await clippedLabel("A∑B", 1500, 100, 24.6),
      pdf = await packetPdf(input, "Clipped fallback"),
      texts = pdfTextClips(pdf);
    expect(texts).toHaveLength(3);
    expect(pdf.toString("latin1")).toContain("NotoSansMath-Regular");
    for (const text of texts) {
      expect(text.clip).toEqual(texts[0]!.clip);
      expect(text.origin[0]).toBeGreaterThan(text.clip[0]![0]);
      expect(text.origin[0]).toBeLessThan(text.clip[1]![0]);
      expect(text.origin[1]).toBeLessThan(text.clip[0]![1]);
      expect(text.origin[1]).toBeGreaterThan(text.clip[2]![1]);
    }
    expect(pdf.toString("latin1")).not.toContain("/SMask");
  });

  it.each([
    ["machine-demo", "left-to-right"],
    ["machine-demo", "top-to-bottom"],
    ["conveyor-line", "left-to-right"],
    ["conveyor-line", "top-to-bottom"],
  ] as const)(
    "converts every label clip in %s / %s without mutating SVG",
    async (example, flow) => {
      const compiled = await compileProject(`examples/${example}`);
      if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
      const rendered = await renderSchematicPacket(
        compiled.ir,
        {
          format: "schematic-packet-request/0.1",
          layout: "compact",
          views: [
            {
              format: "schematic-view-request/0.1",
              root: { by: "designation", value: "M1" },
              family: "power",
              flow,
            },
          ],
        },
        compiled.presentation,
      );
      if (!rendered.ok) throw new Error(rendered.error.message);
      const input = rendered.value,
        before = JSON.stringify(input),
        pdf = await packetPdf(input, "Motor power"),
        labels = input.sheets.reduce(
          (count, sheet) =>
            count + [...sheet.svg.matchAll(/ clip-path=/gu)].length,
          0,
        );
      expect(labels).toBeGreaterThan(0);
      expect(pdf.toString("latin1")).not.toContain("/SMask");
      expect(JSON.stringify(input)).toBe(before);
    },
  );
});

// These tests inspect the painted 300-dpi crops. Searchable text alone cannot
// detect an overpainted column or a proportional substitution for monospace.
const rasterBrowser = await import("./helpers/pdf-raster.js");
describe("PDF painted typography parity", () => {
  async function reportSpecimen() {
    const input = structuredClone(ir);
    input.wires[0]!.properties = {
      ...input.wires[0]!.properties,
      label: "W".repeat(120),
    };
    const result = await renderSchematicPacket(input, {
      format: "schematic-packet-request/0.1",
      views: [{ format: "documentation-view-request/0.1", kind: "wires" }],
    });
    if (!result.ok) throw Error(result.error.message);
    const source = result.value,
      sheet = source.sheets.find((s) => s.svg.includes("WWWW"))!,
      kept = [...sheet.svg.matchAll(/<text\b[^>]*>[\s\S]*?<\/text>/gu)]
        .map((m) => m[0])
        .filter((t) => />W{2,}<\/text>/u.test(t));
    expect(kept.map((t) => />\s*(W+)\s*</u.exec(t)![1]).join("")).toBe(
      "W".repeat(120),
    );
    const full = sheet.svg.replace(/<text\b[^>]*>[\s\S]*?<\/text>/gu, (t) =>
        kept.includes(t) ? t : "",
      ),
      reference =
        sheet.svg.match(/<svg\b[^>]*>/u)![0] + kept.join("") + "</svg>",
      x = Math.min(...kept.map((t) => Number(/ x="([^"]+)"/u.exec(t)![1]))),
      ys = kept.map((t) => Number(/ y="([^"]+)"/u.exec(t)![1])),
      // Generous enough for the complete line, including a pre-fix overflow.
      longest = Math.max(
        ...kept.map((t) => />\s*(W+)\s*</u.exec(t)![1]!.length),
      ),
      crop = {
        x: x - 0.5,
        y: Math.min(...ys) - 3,
        width: longest * 2.6 + 1,
        height: Math.max(...ys) - Math.min(...ys) + 4,
      };
    const asPacket = (svg: string) => ({
      ...source,
      sheets: [{ ...sheet, number: 1, svg }],
    });
    return { asPacket, full, reference, crop };
  }
  async function monoSpecimen() {
    const source = await packet("Monospace specimen"),
      sheet = source.sheets[0]!,
      svg =
        sheet.svg.match(/<svg\b[^>]*>/u)![0] +
        [
          '<text x="30" y="30" font-family="monospace" font-size="4">iiiiiiii</text>',
          '<g font-family="monospace"><text x="30" y="40" font-size="4">WWWWWWWW</text></g>',
        ].join("") +
        "</svg>";
    return { ...source, sheets: [{ ...sheet, svg }] };
  }
  it("paints all 120 W glyphs as completely as an unobstructed PDF reference", async () => {
    const { pdfCrop, pixelDifference, inkBounds } =
        await import("./helpers/pdf-raster.js"),
      { asPacket, full, reference, crop } = await reportSpecimen(),
      actual = await pdfCrop(
        await packetPdf(asPacket(full), "Wide report"),
        crop,
      ),
      expected = await pdfCrop(
        await packetPdf(asPacket(reference), "Wide report"),
        crop,
      );
    expect(inkBounds(actual).count).toBeGreaterThan(3000);
    expect(pixelDifference(actual, expected)).toBe(0);
    const obscured = full.replace(
        "</svg>",
        `<rect x="60" y="${crop.y}" width="24" height="${crop.height}" fill="white"/></svg>`,
      ),
      broken = await pdfCrop(
        await packetPdf(asPacket(obscured), "Negative control"),
        crop,
      );
    expect(pixelDifference(broken, expected)).toBeGreaterThan(1000);
  });
  it("paints equal advances for narrow and wide monospace glyphs, including inherited family", async () => {
    const { pdfCrop, inkBounds } = await import("./helpers/pdf-raster.js"),
      input = await monoSpecimen(),
      pdf = await packetPdf(input, "Monospace"),
      narrow = inkBounds(
        await pdfCrop(pdf, { x: 29, y: 25, width: 35, height: 7 }),
      ),
      wide = inkBounds(
        await pdfCrop(pdf, { x: 29, y: 35, width: 35, height: 7 }),
      );
    expect(pdf.toString("latin1")).toContain("NotoSansMono-Regular");
    expect(narrow.width).toBeGreaterThan(210);
    expect(Math.abs(narrow.width - wide.width)).toBeLessThanOrEqual(6);
    const proportional = {
        ...input,
        sheets: input.sheets.map((sheet) => ({
          ...sheet,
          svg: sheet.svg.replaceAll(
            'font-family="monospace"',
            'font-family="sans-serif"',
          ),
        })),
      },
      broken = await packetPdf(proportional, "Negative control"),
      brokenNarrow = inkBounds(
        await pdfCrop(broken, { x: 29, y: 25, width: 35, height: 7 }),
      ),
      brokenWide = inkBounds(
        await pdfCrop(broken, { x: 29, y: 35, width: 35, height: 7 }),
      );
    expect(brokenWide.width - brokenNarrow.width).toBeGreaterThan(150);
  });
  it("conserves every one of 1,500 row identities once in the direct PDF", async () => {
    const input = structuredClone(ir),
      wire = input.wires[0]!;
    input.jumpers = [];
    input.cables = [];
    input.cableConductors = [];
    input.wires = Array.from({ length: 1500 }, (_, i) => ({
      ...wire,
      uid: `00000000-0000-4000-8000-${i.toString(16).padStart(12, "0")}`,
      designation: `W${i.toString().padStart(4, "0")}`,
      properties: { label: `IDENTITY-${i.toString().padStart(4, "0")}` },
    }));
    const rendered = await renderSchematicPacket(input, {
      format: "schematic-packet-request/0.1",
      views: [{ format: "documentation-view-request/0.1", kind: "wires" }],
    });
    if (!rendered.ok) throw Error(rendered.error.message);
    expect(rendered.value.sheets.length).toBeGreaterThan(1);
    const { pdfText } = await import("./helpers/pdf-raster.js"),
      text = await pdfText(
        await packetPdf(rendered.value, "Identity conservation"),
      ),
      identities = text.match(/IDENTITY-\d{4}/gu) ?? [];
    expect(identities).toHaveLength(1500);
    expect(new Set(identities).size).toBe(1500);
    expect(identities.sort()).toEqual(
      Array.from(
        { length: 1500 },
        (_, i) => `IDENTITY-${i.toString().padStart(4, "0")}`,
      ),
    );
  });
  it("keeps unsupported Unicode explicit for monospace, including inherited spans", async () => {
    const input = await monoSpecimen();
    input.sheets[0]!.svg = input.sheets[0]!.svg.replace(
      "WWWWWWWW",
      "<tspan>🚀</tspan>",
    );
    await expect(packetPdf(input, "Unknown mono glyph")).rejects.toThrow(
      "PDF font does not support U+1F680 (symbol) on sheet 1. Use SVG/HTML or a supported label.",
    );
  });
  it.skipIf(!rasterBrowser.browserPath)(
    "paints the complete report and monospace specimens in a real browser",
    async () => {
      const {
        launchBrowser,
        browserCrop,
        browserFonts,
        pixelDifference,
        inkBounds,
      } = await import("./helpers/pdf-raster.js");
      const browser = await launchBrowser();
      try {
        const { full, reference, crop } = await reportSpecimen(),
          actual = await browserCrop(browser, full, crop),
          expected = await browserCrop(browser, reference, crop);
        expect(inkBounds(actual).count).toBeGreaterThan(3000);
        expect(pixelDifference(actual, expected)).toBe(0);
        // This synthetic specimen declares a generic family; without a test
        // font matrix 42038869517 painted Courier (macOS), Consolas (Windows)
        // and DejaVu Sans Mono (Linux). Use the same shipped face as the direct PDF and wait
        // for its load in browserCrop. Keep both width assertions unchanged.
        const input = await monoSpecimen(),
          font = await readFile(
            new URL(
              "../assets/fonts/NotoSansMono-Regular.ttf",
              import.meta.url,
            ),
          ),
          svg = input.sheets[0]!.svg.replaceAll(
            'font-family="monospace"',
            'font-family="ThermiteTestMono"',
          ).replace(
            /(<svg\b[^>]*>)/u,
            `$1<style>@font-face{font-family:ThermiteTestMono;src:url(data:font/ttf;base64,${font.toString("base64")})}</style>`,
          ),
          narrow = inkBounds(
            await browserCrop(browser, svg, {
              x: 29,
              y: 25,
              width: 35,
              height: 7,
            }),
          ),
          wide = inkBounds(
            await browserCrop(browser, svg, {
              x: 29,
              y: 35,
              width: 35,
              height: 7,
            }),
          );
        const loadedFonts = await browserFonts(browser, svg);
        expect(loadedFonts).toHaveLength(2);
        for (const faces of loadedFonts)
          expect(faces).toEqual([
            expect.objectContaining({
              familyName: "Noto Sans Mono",
              isCustomFont: true,
            }),
          ]);
        process.stdout.write(
          "Browser monospace evidence " +
            JSON.stringify({
              system: await browserFonts(browser, input.sheets[0]!.svg),
              shipped: loadedFonts,
              narrow: narrow.width,
              wide: wide.width,
            }) +
            "\n",
        );
        expect(narrow.width).toBeGreaterThan(210);
        expect(Math.abs(narrow.width - wide.width)).toBeLessThanOrEqual(6);
      } finally {
        await browser.close();
      }
    },
  );
});

describe("PDF glyph conservation for combining marks", () => {
  it.each([
    "MARKS e\u0301\u0302\u0323 q\u0301 a\u0308 n\u0303 Z\u030c END",
    "q\u0301",
    "A\u00adq\u0301B",
  ])("refuses glyphs the PDF converter cannot paint: %s", async (label) => {
    await expect(packetPdf(await packet(label), "Marks")).rejects.toThrow(
      "PDF font does not support U+0301 (combining mark) on sheet 1. Use SVG/HTML or a supported label.",
    );
  });
  it("checks monospace coverage against the mono face for the fi ligature", async () => {
    const input = await packet("Mono coverage");
    input.sheets[0]!.svg =
      input.sheets[0]!.svg.match(/<svg\b[^>]*>/u)![0] +
      '<text x="30" y="30" font-family="monospace" font-size="4">ﬁ</text></svg>';
    await expect(packetPdf(input, "Mono ligature")).rejects.toThrow(
      "PDF font does not support U+FB01 (letter) on sheet 1. Use SVG/HTML or a supported label.",
    );
  });
});

it("paints NFC accents against an independently authored precomposed reference", async () => {
  const source = await packet("NFC raster"),
    sheet = source.sheets[0]!,
    opening = sheet.svg.match(/<svg\b[^>]*>/u)![0],
    svg = (label: string) =>
      opening +
      `<text x="30" y="30" font-family="sans-serif" font-size="4">${label}</text></svg>`,
    input = (label: string) => ({
      ...source,
      sheets: [{ ...sheet, svg: svg(label) }],
    }),
    crop = { x: 29, y: 24, width: 58, height: 8 },
    { pdfCrop, pixelDifference } = await import("./helpers/pdf-raster.js"),
    actual = await pdfCrop(
      await packetPdf(
        input("MARKS e\u0301 a\u0308 n\u0303 Z\u030c END"),
        "Decomposed",
      ),
      crop,
    ),
    reference = await pdfCrop(
      await packetPdf(
        input("MARKS é ä ñ Ž END"),
        "Authored precomposed reference",
      ),
      crop,
    ),
    stripped = await pdfCrop(
      await packetPdf(input("MARKS e a n Z END"), "Missing marks control"),
      crop,
    );
  expect(pixelDifference(actual, reference)).toBe(0);
  expect(pixelDifference(stripped, reference)).toBeGreaterThan(200);
});

function reportTextBoundsIssues() {
  return [
    ...document.querySelectorAll<SVGTextElement>("[data-report-column] text"),
  ].flatMap((text) => {
    // Blank cells paint no glyphs; their SVG text can have a zero box at the origin.
    if (!(text.textContent ?? "").trim()) return [];
    const cell = text.closest("[data-report-column]")!,
      b = text.getBBox(),
      x = Number(cell.getAttribute("data-cell-x")),
      w = Number(cell.getAttribute("data-cell-width"));
    return b.x < x || b.x + b.width > x + w ? [text.textContent] : [];
  });
}

it.skipIf(!rasterBrowser.browserPath)(
  "excludes only blank report text and rejects a non-empty zero box at the origin",
  async () => {
    const browser = await rasterBrowser.launchBrowser(),
      page = await browser.newPage();
    try {
      await page.setContent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40">
        <g data-report-column="0" data-cell-x="10" data-cell-width="40">
          <text></text><text> &#9;&#10; </text>
          <text id="origin">X</text><text x="12" y="15" font-size="3">inside</text>
        </g></svg>`);
      await page.evaluate(() => {
        document.querySelector<SVGTextElement>("#origin")!.getBBox = () =>
          new DOMRect(0, 0, 0, 0);
      });
      expect(await page.evaluate(reportTextBoundsIssues)).toEqual(["X"]);
    } finally {
      await page.close();
      await browser.close();
    }
  },
);

it.skipIf(!rasterBrowser.browserPath)(
  "bounds 60 plus signs under pinned DejaVu Sans in the browser",
  async () => {
    const { readFile } = await import("node:fs/promises"),
      { parseHTML } = await import("linkedom"),
      input = structuredClone(ir);
    input.wires[0]!.properties = {
      ...input.wires[0]!.properties,
      label: "+".repeat(60),
    };
    const result = await renderSchematicPacket(input, {
      format: "schematic-packet-request/0.1",
      views: [{ format: "documentation-view-request/0.1", kind: "wires" }],
    });
    if (!result.ok) throw Error(result.error.message);
    const font = (
        await readFile("node_modules/dejavu-fonts-ttf/ttf/DejaVuSans.ttf")
      ).toString("base64"),
      browser = await rasterBrowser.launchBrowser(),
      page = await browser.newPage();
    try {
      await page.setContent(
        `<style>@font-face{font-family:Arial;src:url(data:font/ttf;base64,${font})}</style>${result.value.sheets[0]!.svg}`,
      );
      await page.evaluate(() => document.fonts.ready);
      const issues = await page.evaluate(reportTextBoundsIssues);
      expect(issues).toEqual([]);
      const text = [
        ...parseHTML(result.value.sheets[0]!.svg).document.querySelectorAll(
          "text",
        ),
      ]
        .map((t) => t.textContent)
        .join("");
      expect((text.match(/\+/gu) ?? []).length).toBeGreaterThanOrEqual(60);
    } finally {
      await page.close();
      await browser.close();
    }
  },
);

describe("PDF diagnostics for unsupported characters", () => {
  it("names the report row and Unicode code point instead of an invisible raw mark", async () => {
    const input = structuredClone(ir);
    input.wires[0]!.properties = {
      ...input.wires[0]!.properties,
      label: "A\u00adq\u0301B",
    };
    const result = await renderSchematicPacket(input, {
      format: "schematic-packet-request/0.1",
      views: [{ format: "documentation-view-request/0.1", kind: "wires" }],
    });
    if (!result.ok) throw Error(result.error.message);
    await expect(packetPdf(result.value, "Row diagnostic")).rejects.toThrow(
      `PDF font does not support U+0301 (combining mark) on sheet 1, row ${JSON.stringify(input.wires[0]!.designation)}, column 1 "Conductor / label". Use SVG/HTML or a supported label.`,
    );
  });
  it("preserves the CLI T001 class and readable code-point message", async () => {
    const { execFileSync } = await import("node:child_process"),
      { mkdtemp, writeFile, rm } = await import("node:fs/promises"),
      { tmpdir } = await import("node:os"),
      { join } = await import("node:path"),
      root = await mkdtemp(join(tmpdir(), "thermite-pdf-unicode-"));
    try {
      const request = join(root, "packet.json");
      await writeFile(
        request,
        JSON.stringify({
          format: "schematic-packet-request/0.1",
          views: [
            {
              format: "circuit-view-request/0.1",
              title: "A\u00adq\u0301B",
              groups: [
                {
                  id: "coil",
                  functions: [
                    { device: { by: "designation", value: "K1" }, key: "coil" },
                  ],
                  conductors: [],
                },
              ],
            },
          ],
        }),
      );
      let failure: any;
      try {
        execFileSync(
          process.execPath,
          [
            "packages/cli/dist/thermite-bin.js",
            "packet",
            "--project",
            "examples/motor-starter",
            "--input",
            request,
            "-o",
            join(root, "packet.pdf"),
          ],
          { stdio: ["ignore", "pipe", "pipe"] },
        );
      } catch (error) {
        failure = error;
      }
      expect(failure?.status, failure?.stderr?.toString()).toBe(2);
      expect(JSON.parse(failure.stderr.toString()).error).toEqual({
        code: "T001",
        message:
          "PDF font does not support U+0301 (combining mark) on sheet 1. Use SVG/HTML or a supported label.",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it.each([
    ["控", "U+63A7 (letter)"],
    ["ป", "U+0E1B (letter)"],
    ["न", "U+0928 (letter)"],
    ["🚀", "U+1F680 (symbol)"],
    ["\u0378", "U+0378 (other character)"],
  ])("gives readable Unicode categories for %s", async (char, description) => {
    await expect(
      packetPdf(await packet(char), "Readable diagnostic"),
    ).rejects.toThrow(
      `PDF font does not support ${description} on sheet 1. Use SVG/HTML or a supported label.`,
    );
  });
});

const formatCases = [
  ["PUMP\u00adSTART W\u2060J A\u200eB", "PUMPSTART WJ AB"],
  ["\ufeffPUMP START", "PUMP START"],
  ["PUMP\u200bSTART", "PUMPSTART"],
  ["A\u00adB", "AB"],
  ["A\u200dB\u200cC\u200fD\u061cE\u2066F\u2069G\ufe0f", "ABCDEFG"],
];
it.each(formatCases)(
  "exports default-ignorable text without painting it: %s",
  async (label, visible) => {
    const source = await packet("Format specimen"),
      sheet = source.sheets[0]!;
    const input = (value: string) => ({
      ...source,
      sheets: [
        {
          ...sheet,
          svg:
            sheet.svg.match(/<svg\b[^>]*>/u)![0] +
            `<text x="30" y="30" font-family="sans-serif" font-size="4">${value}</text></svg>`,
        },
      ],
    });
    const { pdfCrop, pixelDifference, inkBounds } = rasterBrowser;
    const crop = { x: 29, y: 24, width: 80, height: 8 };
    const actual = await pdfCrop(
      await packetPdf(input(label!), "Format specimen"),
      crop,
    );
    const reference = await pdfCrop(
      await packetPdf(input(visible!), "Visible reference"),
      crop,
    );
    expect(inkBounds(actual).count).toBeGreaterThan(100);
    expect(pixelDifference(actual, reference)).toBe(0);
  },
);
it.skipIf(!rasterBrowser.browserPath).each(formatCases.slice(0, 3))(
  "matches browser visibility for default-ignorable text: %s",
  async (label, visible) => {
    const { readFile } = await import("node:fs/promises");
    const font = (
      await readFile("packages/cli/assets/fonts/NotoSans-Regular.ttf")
    ).toString("base64");
    const source = await packet("Browser formats"),
      sheet = source.sheets[0]!;
    const svg = (value: string) =>
      sheet.svg.match(/<svg\b[^>]*>/u)![0] +
      `<style>@font-face{font-family:ParityNoto;src:url(data:font/ttf;base64,${font})}</style>` +
      `<text x="30" y="30" font-family="ParityNoto" font-size="4">${value}</text></svg>`;
    const input = { ...source, sheets: [{ ...sheet, svg: svg(label!) }] };
    const browser = await rasterBrowser.launchBrowser();
    try {
      const crop = { x: 29, y: 24, width: 80, height: 8 };
      const actual = await rasterBrowser.browserCrop(
        browser,
        svg(label!),
        crop,
      );
      const reference = await rasterBrowser.browserCrop(
        browser,
        svg(visible!),
        crop,
      );
      expect(rasterBrowser.pixelDifference(actual, reference)).toBe(0);
      const pdf = await rasterBrowser.pdfCrop(
        await packetPdf(input, "Browser formats"),
        crop,
      );
      const a = rasterBrowser.inkBounds(actual),
        b = rasterBrowser.inkBounds(pdf);
      expect(a.count).toBeGreaterThan(100);
      expect(Math.abs(a.left - b.left)).toBeLessThanOrEqual(2);
      expect(Math.abs(a.width - b.width)).toBeLessThanOrEqual(2);
      expect(Math.abs(a.height - b.height)).toBeLessThanOrEqual(2);
      // Same embedded face and baseline; browser/PDF antialiasing may differ.
      expect(rasterBrowser.unmatchedInk(actual, pdf)).toBeLessThan(0.02);
      expect(rasterBrowser.unmatchedInk(pdf, actual)).toBeLessThan(0.02);
    } finally {
      await browser.close();
    }
  },
);
