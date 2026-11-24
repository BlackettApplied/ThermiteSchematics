import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { compileProject, lockProject } from "@thermite/compiler";
import { afterAll, beforeAll, expect, it } from "vitest";
import { OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { packetPdf } from "../../cli/src/alpha-pdf.js";
import { embedPrintableFont } from "../../cli/src/printable-font.js";
import { renderSchematicPacket } from "../src/index.js";
import { visibleDrawingAreaUtilisation } from "../src/packet/rooted-utilisation.js";
import { OUTER_SVG_PADDING } from "../src/symbols/catalog.js";
import { orthogonalPathData } from "../src/svg/edge-path.js";
import {
  drawingContextOptions,
  launch,
  openSheet,
} from "../../../evals/draw/browser.mjs";
import {
  conductorInterference,
  fontMetrics,
  legibility,
  netLabelRepetition,
  pdfGeometryTexts,
  plateOcclusion,
  terminalText,
  textBounds,
  utilisation,
  wirePlacement,
} from "../../../evals/draw/checks.mjs";
import {
  loadPdfBytes,
  pdfText,
  pdfTextMeasurements,
} from "../../../evals/draw/pdf.mjs";

let browser: Awaited<ReturnType<typeof launch>>;
let page: Awaited<ReturnType<Awaited<ReturnType<typeof launch>>["newPage"]>>;

beforeAll(async () => {
  browser = await launch();
  page = await (await browser.newContext(drawingContextOptions)).newPage();
  await page.emulateMedia({ media: "print" });
});

afterAll(async () => {
  await browser?.close();
});

function compactPumpChain(objects: unknown[]): unknown[] {
  const kept = objects.filter((obj) => {
    if (typeof obj !== "object" || obj === null || !("kind" in obj))
      return true;
    if (
      obj.kind === "device" &&
      "designation" in obj &&
      (obj.designation === "K1" || obj.designation === "OL1")
    )
      return false;
    if (
      obj.kind === "wire" &&
      "endpoints" in obj &&
      Array.isArray(obj.endpoints)
    )
      return !obj.endpoints.some(
        (ep: unknown) =>
          typeof ep === "object" &&
          ep !== null &&
          "device" in ep &&
          (ep.device === "K1" || ep.device === "OL1"),
      );
    return true;
  });
  for (const [q, m, id] of [
    ["2/T1", "U", "102"],
    ["4/T2", "V", "106"],
    ["6/T3", "W", "110"],
  ] as const) {
    kept.push({
      uid: `00000000-0000-4000-8000-000000000${id}`,
      kind: "wire",
      designation: `W${id}`,
      endpoints: [
        { device: "Q1", terminal: q },
        { device: "M1", terminal: m },
      ],
      properties: { label: id },
    });
  }
  return kept;
}

async function compilePump(
  tag: string,
  phaseNames: readonly [string, string, string],
  compactChain = false,
) {
  const raw: unknown = JSON.parse(
    await readFile(
      resolve(import.meta.dirname, "fixtures/agent-refusals/pump.json"),
      "utf8",
    ),
  );
  assert.ok(
    typeof raw === "object" &&
      raw !== null &&
      "objects" in raw &&
      Array.isArray(raw.objects),
  );
  const byTerm = new Map([
    ["L1", phaseNames[0]],
    ["L2", phaseNames[1]],
    ["L3", phaseNames[2]],
  ]);
  for (const obj of raw.objects) {
    if (
      typeof obj !== "object" ||
      obj === null ||
      !("kind" in obj) ||
      obj.kind !== "potential" ||
      !("at" in obj) ||
      typeof obj.at !== "object" ||
      obj.at === null ||
      !("device" in obj.at) ||
      obj.at.device !== "SUP1" ||
      !("terminal" in obj.at) ||
      typeof obj.at.terminal !== "string"
    ) {
      continue;
    }
    const next = byTerm.get(obj.at.terminal);
    if (next !== undefined && "name" in obj) obj.name = next;
  }
  const root = await mkdtemp(join(tmpdir(), `thermite-ttblong-pdf-${tag}-`));
  await writeFile(
    join(root, "system.json"),
    JSON.stringify({
      format: "electrical-system/0.1",
      project: { name: `Synthetic ${tag}` },
      sources: ["source.json"],
      libraries: [{ name: "core", version: "0.2.0" }],
    }),
  );
  await writeFile(
    join(root, "source.json"),
    JSON.stringify({
      objects: compactChain ? compactPumpChain(raw.objects) : raw.objects,
    }),
  );
  const locked = await lockProject(root);
  assert.ok(locked.ok, JSON.stringify(locked));
  const compiled = await compileProject(root);
  assert.ok(compiled.ok, JSON.stringify(compiled));
  return {
    ir: compiled.ir,
    dispose: () => rm(root, { recursive: true, force: true }),
  };
}

function phaseTriple(sample: string): readonly [string, string, string] {
  return [
    sample,
    sample.replace(/L1$/u, "L2"),
    sample.replace(/L1$/u, "L3"),
  ] as const;
}

async function pdfTextRunBlocks(
  pdfPage: Awaited<
    ReturnType<Awaited<ReturnType<typeof loadPdfBytes>>["getPage"]>
  >,
): Promise<readonly string[]> {
  const ops = await pdfPage.getOperatorList();
  const blocks: string[] = [];
  let current = "";
  let inText = false;
  for (let i = 0; i < ops.fnArray.length; i++) {
    const op = ops.fnArray[i];
    if (op === OPS.beginText) {
      inText = true;
      current = "";
    } else if (op === OPS.endText) {
      if (inText && current.length > 0) blocks.push(current);
      inText = false;
      current = "";
    } else if (op === OPS.showText && inText) {
      const glyphs = ops.argsArray[i]?.[0];
      if (!Array.isArray(glyphs)) continue;
      for (const glyph of glyphs) {
        if (typeof glyph === "object" && glyph !== null && "unicode" in glyph) {
          current += String(glyph.unicode);
        }
      }
    }
  }
  return blocks;
}

async function assertSheetStrictChecks(
  svg: string,
  ir: Parameters<typeof terminalText>[1],
  doc: Awaited<ReturnType<typeof loadPdfBytes>>,
  sheetNumber: number,
) {
  const g = await openSheet(page, embedPrintableFont(svg));
  const pdfPage = await doc.getPage(sheetNumber);
  const pdf = await pdfText(pdfPage, doc.fontFamilies, doc.fontCaps);
  const metrics = await pdfTextMeasurements(
    pdfPage,
    doc.fontFamilies,
    doc.fontCaps,
  );
  const pdfGeometry = pdfGeometryTexts(g.texts, pdf);
  expect(textBounds(g)).toEqual([]);
  expect(legibility(g)).toEqual([]);
  expect(legibility({ texts: pdfGeometry })).toEqual([]);
  expect(terminalText(g, ir)).toEqual([]);
  expect(netLabelRepetition(g, ir)).toEqual([]);
  expect(fontMetrics(g.texts, metrics.metrics)).toEqual([]);
  expect(plateOcclusion(g)).toEqual([]);
  expect(conductorInterference(g)).toEqual([]);
  expect(wirePlacement(g)).toEqual([]);
  return { pdfPage, fraction: utilisation(g)?.fraction };
}

function medianFraction(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  return n
    ? ((sorted[Math.floor((n - 1) / 2)] ?? 0) +
        (sorted[Math.floor(n / 2)] ?? 0)) /
        2
    : 0;
}

async function visibleSheetNetRows() {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll("text.label-net"), (el) => {
      const b = el.getBBox();
      const vb = el.closest("svg")?.viewBox.baseVal;
      const visible =
        vb !== undefined &&
        b.x + b.width > vb.x &&
        b.x < vb.x + vb.width &&
        b.y + b.height > vb.y &&
        b.y < vb.y + vb.height;
      return {
        text: el.textContent ?? "",
        chars: el.getNumberOfChars(),
        whiteSpace: getComputedStyle(el).whiteSpace,
        visible,
      };
    }).filter((row) => row.visible && row.text.length > 0),
  );
}

async function verifyPacketStrict(
  tag: string,
  names: readonly [string, string, string],
  expectedRow1: string,
) {
  const fixture = await compilePump(tag, names, true);
  try {
    const packet = await renderSchematicPacket(fixture.ir, {
      format: "schematic-packet-request/0.1",
      page: { size: "tabloid", orientation: "landscape" },
      views: [
        {
          format: "schematic-view-request/0.1",
          root: { by: "designation", value: "M1" },
          family: "power",
          flow: "top-to-bottom",
        },
      ],
    });
    assert.ok(packet.ok, JSON.stringify(packet));
    const pdfBytes = await packetPdf(packet.value, `Test ${tag}`);
    const doc = await loadPdfBytes(pdfBytes);
    try {
      const joinedPdfNames: string[] = [];
      const fractions: number[] = [];
      for (const sheet of packet.value.sheets) {
        const { pdfPage, fraction } = await assertSheetStrictChecks(
          sheet.svg,
          fixture.ir,
          doc,
          sheet.number,
        );
        if (fraction !== undefined) fractions.push(fraction);
        if (sheet.number !== 1) continue;
        const domRows = await visibleSheetNetRows();
        const row1Dom = domRows.filter((row) => row.text === expectedRow1);
        expect(row1Dom).toHaveLength(3);
        for (const row of row1Dom) {
          expect(row.chars).toBe([...expectedRow1].length);
          expect(row.whiteSpace).toBe("pre");
        }
        const blocks = await pdfTextRunBlocks(pdfPage);
        for (let i = 0; i < blocks.length - 1; i++) {
          if (blocks[i] === expectedRow1) {
            joinedPdfNames.push(blocks[i]! + blocks[i + 1]!);
          }
        }
      }
      expect(medianFraction(fractions)).toBeGreaterThanOrEqual(0.4);
      expect([...new Set(joinedPdfNames)].sort()).toEqual([...names].sort());
      doc.assertNoExternalResources();
    } finally {
      await doc.loadingTask.destroy();
    }
  } finally {
    await fixture.dispose();
  }
}

it("preserves single and consecutive boundary spaces verbatim in Chromium and PDF runs (#576)", async () => {
  const singleSpace = phaseTriple(
    "MCC1 MAIN MOTOR POWER 480VAC BUS FEEDER PANEL MOD ALPHA 1 L1",
  );
  await verifyPacketStrict(
    "spaces",
    singleSpace,
    "MCC1 MAIN MOTOR POWER 480VAC ",
  );

  const fourSpaces = phaseTriple(
    "MCC1 MAIN MOTOR POWER 480VAC    BUS FEEDER PANEL MOD ALPHA 1 L1",
  );
  await verifyPacketStrict(
    "four-spaces",
    fourSpaces,
    "MCC1 MAIN MOTOR POWER 480VAC    ",
  );
});

it("passes strict checker predicates and verbatim PDF joins on 55- and 60-char hyphen cases (#576)", async () => {
  await verifyPacketStrict(
    "hyphen-55",
    phaseTriple("MCC1-MAIN-MOTOR-POWER-480VAC-BUS-FEEDER-PANEL-MOD-01-L1"),
    "MCC1-MAIN-MOTOR-POWER-480VAC-",
  );
  await verifyPacketStrict(
    "hyphen-60",
    phaseTriple("MCC1-MAIN-MOTOR-POWER-480VAC-BUS-FEEDER-PANEL-MOD-ALPHA-1-L1"),
    "MCC1-MAIN-MOTOR-POWER-480VAC-",
  );
});

it.each([
  [
    "consec-space-std",
    `${"W".repeat(28)}   ${"W".repeat(27)}L1`,
    "standard" as const,
  ],
  [
    "consec-space-cmp",
    `${"W".repeat(28)}   ${"W".repeat(27)}L1`,
    "compact" as const,
  ],
  ["longW-0-std", `${"W".repeat(22)}-${"W".repeat(23)}L1`, "standard" as const],
] as const)(
  "never issues a DQ-17 route-source violation on %s (#576)",
  async (tag, sample, layout) => {
    const fixture = await compilePump(tag, phaseTriple(sample));
    try {
      const packet = await renderSchematicPacket(fixture.ir, {
        format: "schematic-packet-request/0.1",
        layout,
        page: { size: "tabloid", orientation: "landscape" },
        views: [
          {
            format: "schematic-view-request/0.1",
            root: { by: "designation", value: "M1" },
            family: "power",
            flow: "top-to-bottom",
          },
        ],
      });
      if (!packet.ok) {
        expect(packet.error.code).toBe("R006");
        expect(packet.error.message).not.toMatch(
          /potential name|source net label/iu,
        );
        return;
      }
      const pdfBytes = await packetPdf(packet.value, `Test ${tag}`);
      const doc = await loadPdfBytes(pdfBytes);
      try {
        for (const sheet of packet.value.sheets) {
          await assertSheetStrictChecks(
            sheet.svg,
            fixture.ir,
            doc,
            sheet.number,
          );
        }
      } finally {
        await doc.loadingTask.destroy();
      }
    } finally {
      await fixture.dispose();
    }
  },
);

const GEOMETRY_FLOOR_CONTROL = [
  [50, 50],
  [50, 199.8],
  [250, 199.8],
] as const;

const GEOMETRY_FLOOR_FIXTURES = [
  [
    "outside-region",
    [
      [50, 70],
      [250.18, 70],
      [250.18, 245],
    ],
    360,
    225,
    360,
    225,
  ],
  [
    "viewport-clips-to-region",
    [
      [50, 70],
      [250.18, 70],
      [250.18, 245],
    ],
    360,
    212,
    360,
    212,
  ],
  [
    "inside-region",
    [
      [50, 70],
      [250.18, 70],
      [250.18, 240],
    ],
    360,
    225,
    360,
    225,
  ],
  [
    "letterboxed",
    [
      [50, 70],
      [250.18, 70],
      [250.18, 230],
    ],
    360,
    225,
    360.001,
    225,
  ],
] as const;

it("keeps whole-shape utilisation estimates conservative against Chromium on geometry-floor fixtures (#576 review5)", async () => {
  const sheetPage = {
    size: "tabloid" as const,
    orientation: "landscape" as const,
    widthMm: 431.8,
    heightMm: 279.4,
    marginMm: 10,
  };
  for (const [tag, other, vw, vh, width, height] of GEOMETRY_FLOOR_FIXTURES) {
    const routes = [GEOMETRY_FLOOR_CONTROL, other].map((path, i) => ({
      id: `path${i}`,
      points: path.map(([x, y]) => ({
        x: x - OUTER_SVG_PADDING - 30,
        y: y - OUTER_SVG_PADDING - 30,
      })),
    }));
    const geometry = routes
      .map(
        ({ id, points }) =>
          `<path id="${id}" class="net-path" fill="none" stroke="black" stroke-width=".4" d="${orthogonalPathData(points)}"/>`,
      )
      .join("");
    const content = `<g transform="translate(4 3)"><svg x="26" y="27" width="${width}" height="${height}" viewBox="0 0 ${vw} ${vh}" overflow="hidden">${geometry}<text x="10" y="30">Excluded text</text></svg></g>`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="431.8mm" height="279.4mm" viewBox="0 0 431.8 279.4">${content}</svg>`;
    const candidate = {
      prepared: {
        graph: {
          nodes: [],
          edges: routes.map(({ id }) => ({
            id,
            kind: "conductor" as const,
            sourcePortId: "",
            targetPortId: "",
          })),
        },
        layout: { nodes: [], edges: routes },
      },
      drafts: [{ content }],
    };
    const estimate = visibleDrawingAreaUtilisation(candidate, sheetPage);
    const g = await openSheet(page, svg);
    const browserFraction = utilisation(g)?.fraction;
    assert.ok(browserFraction !== undefined, `Missing fraction for ${tag}`);
    expect(estimate, tag).toBeLessThanOrEqual(browserFraction);
    if (tag === "outside-region") {
      expect(estimate).toBeLessThan(0.4);
      expect(browserFraction).toBeLessThan(0.4);
    }
  }
});
