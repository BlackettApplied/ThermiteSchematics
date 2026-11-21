import { beforeAll, expect, it } from "vitest";
import { compileCoreFixture } from "./fixtures.js";
import type { ElectricalIr } from "@thermite/compiler";
import type {
  PacketRequest,
  Presentation,
} from "../src/internal/title-data/model.js";
import { renderTitleFrameBenchmark } from "../src/internal/title-data/entry.js";
import { renderSchematicPacket } from "../src/sheets.js";
import type { SchematicPacketRequest } from "../src/packet/types.js";
let ir: ElectricalIr;
beforeAll(async () => {
  ir = await compileCoreFixture();
});
const presentation: Presentation = { format: "project-presentation/0.3" };
const request: PacketRequest = {
  format: "schematic-packet-request/0.2",
  views: [{ format: "documentation-view-request/0.1", kind: "bom" }],
};
it("prints supplied personnel, current revision and history on every final sheet", async () => {
  const result = await renderTitleFrameBenchmark(
    ir,
    {
      ...request,
      titleData: {
        defaults: {
          values: {
            drawnBy: "AB",
            checkedBy: "CD",
            approvedBy: "EF",
            date: "2026-11-13",
            customer: "SYNTHETIC",
            drawingNumber: "FIXTURE",
          },
          revision: "CURRENT",
          revisionRows: [
            { version: "HISTORY", comment: "Fixture", drawnBy: "GH" },
          ],
        },
      },
    },
    presentation,
  );
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.presentationFormat).toBe("project-presentation/0.3");
  for (const sheet of result.value.sheets) {
    expect(sheet.sheetKey).toMatch(/^sheet\/1\/[0-9a-f]{64}$/);
    for (const value of [
      "AB",
      "CD",
      "EF",
      "2026-11-13",
      "SYNTHETIC",
      "FIXTURE",
      "CURRENT",
      "HISTORY",
      "Fixture",
      "GH",
    ])
      expect(sheet.svg).toContain(value);
    expect(sheet.svg).not.toContain("Revision history: UNSPECIFIED");
  }
});
it.each(["border", "title", "metadata"] as const)(
  "renders generatorStamp %s in its selected location",
  async (generatorStamp) => {
    const result = await renderTitleFrameBenchmark(ir, request, {
      ...presentation,
      frame: { generatorStamp },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const svg = result.value.sheets[0]?.svg ?? "";
    expect(svg).toContain("<metadata>Generator: Thermite Schematics");
    expect(svg.includes("Tool: Thermite Schematics")).toBe(
      generatorStamp === "title",
    );
    expect(svg.includes(">Thermite 0.3.0-alpha.2</text>")).toBe(
      generatorStamp === "border",
    );
  },
);
it("keeps unknown fields labelled and an unknown current revision UNSPECIFIED", async () => {
  const result = await renderTitleFrameBenchmark(ir, request, presentation);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const svg = result.value.sheets[0]?.svg ?? "";
  for (const label of [
    "Drawn by:",
    "Checked by:",
    "Approved by:",
    "Date:",
    "Customer:",
    "DWG NO:",
    "REV:",
  ])
    expect(svg).toContain(label);
  expect(svg).toContain(">UNSPECIFIED</text>");
  expect(svg).toContain("Revision history: UNSPECIFIED");
});
const invalidViews: unknown[] = [
  null,
  [],
  "view",
  {},
  { format: "no-view" },
  { format: "documentation-view-request/0.1", kind: "unknown" },
  { format: "documentation-view-request/0.1", kind: "bom", extra: true },
  {
    format: "documentation-view-request/0.1",
    kind: "bom",
    filter: { extra: true },
  },
  { format: "documentation-view-request/0.1", kind: "bom", page: {} },
  {
    format: "schematic-view-request/0.1",
    root: { by: "designation", value: "K1" },
    family: "unknown",
  },
  {
    format: "schematic-view-request/0.2",
    root: { by: "designation", value: "K1" },
    intent: { kind: "unknown" },
  },
  { format: "communication-view-request/0.1", medium: "unknown" },
  { format: "connector-assembly-view-request/0.1", extra: true },
  { format: "wiring-view-request/0.1", extra: true },
  { format: "signal-loop-view-request/0.1", extra: true },
  { format: "circuit-view-request/0.1", extra: true },
];
it.each(invalidViews.map((view, index) => ({ view, index })))(
  "uses identical existing per-view rejection for invalid view $index",
  async ({ view }) => {
    const legacy = {
      format: "schematic-packet-request/0.1",
      views: [view],
    } as SchematicPacketRequest;
    const modern = {
      ...legacy,
      format: "schematic-packet-request/0.2",
    } as PacketRequest;
    const a = await renderSchematicPacket(ir, legacy);
    const b = await renderTitleFrameBenchmark(ir, modern, presentation);
    expect(a.ok).toBe(false);
    expect(b).toEqual(a);
    expect(await renderSchematicPacket(ir, modern)).toEqual(a);
    expect(
      await renderSchematicPacket(ir, modern, {
        format: "project-presentation/0.3",
        revision: "UNSPECIFIED",
        backgroundColor: "#ffffff",
        titleBlockLines: [],
      }),
    ).toEqual(a);
  },
);

it("rejects unsupported title glyphs with title-field ownership", async () => {
  const result = await renderTitleFrameBenchmark(
    ir,
    { ...request, titleData: { defaults: { values: { drawnBy: "🧭" } } } },
    presentation,
  );
  expect(result).toMatchObject({
    ok: false,
    error: {
      code: "R005",
      ownerKind: "title-field",
      field: "/titleData/defaults/values/drawnBy",
    },
  });
});
it("reports derived project capacity as R006 on 0.3 while legacy stays R005", async () => {
  const long = { ...ir, project: { ...ir.project, name: "x".repeat(161) } };
  const modern = await renderTitleFrameBenchmark(long, request, presentation);
  expect(modern).toMatchObject({
    ok: false,
    error: {
      code: "R006",
      reason: "unprintable-layout",
      message: expect.stringMatching(/Sheet 1 field project/),
    },
  });
});
it("measures supplied headings and custom labels before pagination", async () => {
  const result = await renderTitleFrameBenchmark(
    ir,
    {
      ...request,
      titleData: { byView: [{ viewIndex: 1, sheetTitle: "SHORT" }] },
    },
    {
      ...presentation,
      titleBlock: {
        fields: {
          sheetTitle: {
            slot: "sheetTitle",
            label: "Drawing",
            bind: "sheet.title",
          },
        },
      },
    },
  );
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.sheets[0]?.svg).toContain("Drawing: SHORT");
});

it.each([NaN, Infinity, 42, { toJSON: () => "AB" }])(
  "rejects a non-string metadata value without JSON coercion: %s",
  async (value) => {
    const bad = {
      ...request,
      titleData: { defaults: { values: { drawnBy: value } } },
    } as unknown as PacketRequest;
    const result = await renderTitleFrameBenchmark(ir, bad, presentation);
    expect(result).toMatchObject({
      ok: false,
      error: { code: "R006", reason: "invalid-packet" },
    });
  },
);

it("snapshots supplied title facts without freezing caller objects", async () => {
  const input = {
    ...request,
    titleData: { defaults: { values: { customer: "BEFORE" } } },
  };
  const pending = renderTitleFrameBenchmark(ir, input, presentation);
  expect(() => {
    input.titleData.defaults.values.customer = "AFTER";
  }).not.toThrow();
  const result = await pending;
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.sheets[0]?.svg).toContain(">BEFORE</text>");
  expect(result.value.sheets[0]?.svg).not.toContain(">AFTER</text>");
});
