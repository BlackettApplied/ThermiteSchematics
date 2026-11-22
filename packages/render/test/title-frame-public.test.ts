import { beforeAll, expect, it } from "vitest";
import { printableTextMetrics } from "../src/text-metrics.js";
import { parseJson } from "@thermite/schema";
import type {
  ElectricalIr,
  CompiledProjectPresentation,
} from "@thermite/compiler";
import { renderSchematicPacket } from "@thermite/render";
import { compileCoreFixture } from "./fixtures.js";
import type { PacketRequest } from "../src/internal/title-data/model.js";
let ir: ElectricalIr;
beforeAll(async () => {
  ir = await compileCoreFixture();
});
const p: CompiledProjectPresentation = {
  format: "project-presentation/0.3",
  revision: "UNSPECIFIED",
  backgroundColor: "#ffffff",
  titleBlockLines: [],
};
const q: PacketRequest = {
  format: "schematic-packet-request/0.2",
  views: [{ format: "documentation-view-request/0.1", kind: "bom" }],
};
it("uses packet source positions for glyph and stale-sheet diagnostics", async () => {
  for (const text of [
    '{\n"format":"schematic-packet-request/0.2",\n"views":[{"format":"documentation-view-request/0.1","kind":"bom"}],\n"titleData":{"defaults":{"values":{"drawnBy":"😀"}}}\n}',
    '{\n"format":"schematic-packet-request/0.2",\n"views":[{"format":"documentation-view-request/0.1","kind":"bom"}],\n"titleData":{"bySheet":[{"sheetKey":"sheet/1/' +
      "0".repeat(64) +
      '","revision":"X"}]}\n}',
  ]) {
    const parsed = parseJson(text, "synthetic-packet.json");
    const result = await renderSchematicPacket(
      ir,
      parsed.value as unknown as PacketRequest,
      p,
      { source: { file: "synthetic-packet.json", nodes: parsed.nodes } },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.details?.titleDiagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ file: "synthetic-packet.json", line: 4 }),
      ]),
    );
  }
});
it("rejects unsupported runtime versions and metadata on a legacy frame", async () => {
  expect(
    (
      await renderSchematicPacket(
        ir,
        { ...q, format: "unknown" } as unknown as PacketRequest,
        p,
      )
    ).ok,
  ).toBe(false);
  expect(
    (
      await renderSchematicPacket(ir, {
        ...q,
        titleData: { defaults: { revision: "X" } },
      })
    ).ok,
  ).toBe(false);
});
it("plans long per-view and exact-sheet headings before page partitioning", async () => {
  const base: PacketRequest = {
    ...q,
    page: { size: "a4", orientation: "portrait", marginMm: 25 },
    views: [
      {
        format: "documentation-view-request/0.1",
        kind: "bom",
        filter: { devices: ["K1"] },
      },
    ],
  };
  const initial = await renderSchematicPacket(ir, base, p);
  expect(initial.ok).toBe(true);
  if (!initial.ok) return;
  const key = initial.value.sheets[0]?.sheetKey;
  expect(key).toMatch(/^sheet\/1\//);
  if (!key) return;
  const title = "gjpqy ".repeat(26).trim();
  for (const titleData of [
    { byView: [{ viewIndex: 1, sheetTitle: title }] },
    { bySheet: [{ sheetKey: key, sheetTitle: title }] },
  ]) {
    const result = await renderSchematicPacket(ir, { ...base, titleData }, p);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sheets).toHaveLength(1);
    const svg = result.value.sheets[0]?.svg ?? "";
    const rows = [...svg.matchAll(/<text\b([^>]*)>([^<]*gjpqy[^<]*)<\/text>/g)];
    expect(rows).toHaveLength(3);
    const authorTop =
      result.value.page.heightMm - result.value.page.marginMm - 13;
    for (const row of rows) {
      const baseline = Number(/\by="([^"]+)"/.exec(row[1] ?? "")?.[1]);
      const inkBottom =
        baseline - printableTextMetrics(row[2] ?? "", 2.8).bottom;
      expect(authorTop - inkBottom).toBeGreaterThanOrEqual(1);
    }
  }
});
it("preserves labelled empty personnel and clears supplied values with null", async () => {
  const result = await renderSchematicPacket(
    ir,
    {
      ...q,
      titleData: {
        defaults: { values: { drawnBy: "TEST", customer: "TEST" } },
        byView: [{ viewIndex: 1, values: { drawnBy: null, customer: null } }],
      },
    },
    p,
  );
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const svg = result.value.sheets[0]?.svg ?? "";
  expect(svg).not.toContain(">TEST</text>");
  // The author row contains precisely the four labels when all facts are unknown.
  const text = [...svg.matchAll(/<text\b([^>]*)>([^<]*)<\/text>/g)];
  const drawn = text.find((m) => m[2] === "Drawn by:");
  expect(drawn).toBeDefined();
  const y = /\by="([^"]+)"/.exec(drawn?.[1] ?? "")?.[1];
  expect(
    text.filter((m) => m[1]?.includes(`y="${y}"`)).map((m) => m[2]),
  ).toEqual(["Drawn by:", "Date:", "Checked by:", "Approved by:"]);
});

it.each([
  undefined,
  "project-presentation/0.1",
  "project-presentation/0.2",
] as const)(
  "keeps metadata-free 0.2 packets byte-identical on legacy presentation %s",
  async (format) => {
    const presentation = format
      ? {
          format,
          revision: "SOURCE",
          backgroundColor: "#ffffff",
          titleBlockLines: ["Source note"],
        }
      : undefined;
    const old = await renderSchematicPacket(
      ir,
      { ...q, format: "schematic-packet-request/0.1" },
      presentation,
    );
    const modern = await renderSchematicPacket(ir, q, presentation);
    expect(old.ok).toBe(true);
    expect(JSON.stringify(modern)).toBe(JSON.stringify(old));
  },
);
