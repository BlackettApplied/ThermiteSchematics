import { beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseHTML } from "linkedom";
import { compileProject, type ElectricalIr } from "@thermite/compiler";
import { buildDocumentation } from "@thermite/query";
import {
  renderSchematicPacket,
  type SchematicPacketRequest,
} from "../src/sheets.js";
let ir: ElectricalIr, example: SchematicPacketRequest;
beforeAll(async () => {
  const c = await compileProject(resolve("examples/report-filtering"));
  if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
  ir = c.ir;
  example = JSON.parse(
    await readFile(resolve("examples/report-filtering/packet.json"), "utf8"),
  );
});
const id = (name: string) =>
  ir.devices.find((d) => d.designation === name)!.uid;
const tableRows = (sheets: readonly { svg: string }[]) =>
  sheets.flatMap((s) => [
    ...parseHTML(s.svg).document.querySelectorAll("[data-report-row]"),
  ]);
const request: SchematicPacketRequest = {
  format: "schematic-packet-request/0.1",
  index: true,
  page: { size: "tabloid", orientation: "landscape" },
  views: [
    { format: "communication-view-request/0.1", medium: "ethernet" },
    { format: "documentation-view-request/0.1", kind: "bom" },
  ],
};
describe("filtered packet references and report scope", () => {
  it("retains complete default references and output when no options are authored", async () => {
    const a = await renderSchematicPacket(ir, request),
      b = await renderSchematicPacket(ir, request);
    expect(a).toEqual(b);
    if (!a.ok) throw Error(a.error.message);
    expect(a.value.referenceSelection).toBeUndefined();
    expect(a.value.documentationSelections).toBeUndefined();
    const refs = a.value.sheets.filter(
      (s) => "kind" in s.view && s.view.kind === "references",
    );
    expect(tableRows(refs)).toHaveLength(ir.devices.length);
    expect(refs.some((s) => s.svg.includes("schedule appearances"))).toBe(true);
    expect(tableRows(refs).some((e) => e.textContent!.includes("DOC1"))).toBe(
      true,
    );
  });
  it.each(["standard", "compact"] as const)(
    "filters only reference rows and appearances with %s layout",
    async (layout) => {
      const before = JSON.stringify(ir);
      const full = await renderSchematicPacket(ir, { ...request, layout }),
        r = await renderSchematicPacket(ir, {
          ...request,
          layout,
          references: {
            appearances: "drawings",
            filter: { excludeTypes: ["filter-fixture:documentary"] },
          },
        });
      if (!full.ok || !r.ok) throw Error("render");
      expect(r.value.referenceSelection).toMatchObject({
        enabled: true,
        appearances: "drawings",
        totalGroups: ir.devices.length,
        retainedGroups: 2,
      });
      expect(r.value.referenceSelection!.omittedGroupKeys).toHaveLength(
        ir.devices.length - 2,
      );
      const refs = r.value.sheets.filter(
        (s) => "kind" in s.view && s.view.kind === "references",
      );
      expect(
        tableRows(refs)
          .map((e) => JSON.parse(e.getAttribute("data-report-row")!)[0])
          .sort(),
      ).toEqual([id("PLC1"), id("PLC2")].sort());
      expect(refs.map((s) => s.svg).join(" ")).toContain(
        "diagram appearances only",
      );
      const drawingSheetNumbers = r.value.sheets
        .filter((s) => "kind" in s.view && s.view.kind === "communication")
        .map((s) => s.number);
      for (const row of tableRows(refs)) {
        const text = row.textContent!;
        for (const m of text.matchAll(/(\d+) \/ [A-D][1-6]/g))
          expect(drawingSheetNumbers).toContain(Number(m[1]));
      }
      const drawings = (packet: typeof r.value) =>
        packet.sheets.filter(
          (s) => "kind" in s.view && s.view.kind === "communication",
        );
      const content = (packet: typeof r.value) =>
        drawings(packet).flatMap((s) =>
          [
            ...parseHTML(s.svg).document.querySelectorAll(
              "[data-device-uid], [data-communication-link]",
            ),
          ].map((e) => e.toString()),
        );
      expect(content(r.value)).toEqual(content(full.value));
      expect(
        drawings(r.value).map((s) => s.communicationContinuations),
      ).toEqual(drawings(full.value).map((s) => s.communicationContinuations));
      expect(r.value.coverage.topology.communicationLinks).toEqual(
        full.value.coverage.topology.communicationLinks,
      );
      expect(r.value.coverage.topology.communicationPorts).toEqual(
        full.value.coverage.topology.communicationPorts,
      );
      expect(JSON.stringify(ir)).toBe(before);
    },
  );
  it("keeps schedule appearances when requested and supports device/location filters", async () => {
    const r = await renderSchematicPacket(ir, {
      ...request,
      references: {
        appearances: "all",
        filter: {
          devices: ["TB1", "PLC1", "DOC1"],
          locations: ["Main"],
          excludeDevices: ["DOC1"],
        },
      },
    });
    if (!r.ok) throw Error(r.error.message);
    const rows = tableRows(
      r.value.sheets.filter(
        (s) => "kind" in s.view && s.view.kind === "references",
      ),
    );
    expect(
      rows.map((e) => JSON.parse(e.getAttribute("data-report-row")!)[0]).sort(),
    ).toEqual([id("PLC1"), id("TB1")].sort());
    const tb = rows.find((e) => e.textContent!.includes("TB1"))!,
      bom = r.value.sheets.find(
        (s) => "kind" in s.view && s.view.kind === "bom",
      )!;
    expect(tb.textContent).toMatch(new RegExp(`${bom.number} / [A-D][1-6]`));
  });
  it("can omit references while retaining the complete sheet index and diagram continuations", async () => {
    const r = await renderSchematicPacket(ir, {
      ...request,
      references: false,
    });
    if (!r.ok) throw Error(r.error.message);
    expect(
      r.value.sheets.some(
        (s) => "kind" in s.view && s.view.kind === "references",
      ),
    ).toBe(false);
    const indexes = r.value.sheets.filter(
      (s) => "kind" in s.view && s.view.kind === "index",
    );
    expect(indexes.length).toBeGreaterThan(0);
    expect(indexes.map((s) => s.svg).join("")).toContain(
      "reference index omitted by request",
    );
    expect(r.value.referenceSelection).toMatchObject({
      enabled: false,
      retainedGroups: 0,
      totalGroups: ir.devices.length,
    });
    expect(
      r.value.sheets.some((s) => s.communicationContinuations?.length),
    ).toBe(true);
  });
  it("shows an intentionally empty reference selection without falling back to all devices", async () => {
    const r = await renderSchematicPacket(ir, {
      ...request,
      references: { filter: { devices: ["PLC1"], excludeDevices: ["PLC1"] } },
    });
    if (!r.ok) throw Error(r.error.message);
    expect(r.value.referenceSelection!.retainedGroups).toBe(0);
    const refs = r.value.sheets.filter(
      (s) => "kind" in s.view && s.view.kind === "references",
    );
    expect(refs).toHaveLength(1);
    expect(refs[0]!.svg).toContain("No matching records");
  });
  it("records one report selection per authored view across all report sheets", async () => {
    const r = await renderSchematicPacket(ir, example);
    if (!r.ok) throw Error(r.error.message);
    expect(r.value.documentationSelections!.map((s) => s.view)).toEqual([
      2, 3, 4,
    ]);
    for (const s of r.value.documentationSelections!) {
      const v = example.views[s.view - 1]!;
      const table = buildDocumentation(ir, v as any);
      expect(s).toEqual({ ...table.selection, view: s.view });
    }
    const terminal = r.value.sheets.filter(
      (s) => "kind" in s.view && s.view.kind === "terminals",
    );
    expect(
      tableRows(terminal).map(
        (e) => JSON.parse(e.getAttribute("data-report-row")!)[1],
      ),
    ).toEqual(["2", "1"]);
    expect(terminal[0]!.svg).toContain("Filtered report:");
  });
  it.each([
    true,
    null,
    {},
    { appearances: "schedule" },
    { filter: {} },
    { filter: { devices: ["Missing"] } },
    { appearances: "all", typo: true },
  ])(
    "rejects invalid reference options %j without a partial packet",
    async (references) => {
      const r = await renderSchematicPacket(ir, {
        ...request,
        references,
      } as any);
      expect(r).toMatchObject({ ok: false, error: { code: "R006" } });
      expect(r).not.toHaveProperty("value");
    },
  );
  it("requires an enabled index for reference options and rejects invalid report filters", async () => {
    const r = await renderSchematicPacket(ir, {
      ...request,
      index: false,
      references: { appearances: "drawings" },
    });
    expect(r.ok).toBe(false);
    const bad = await renderSchematicPacket(ir, {
      format: "schematic-packet-request/0.1",
      views: [
        {
          format: "documentation-view-request/0.1",
          kind: "wires",
          filter: { devices: ["Missing"] },
        },
      ],
    });
    expect(bad.ok).toBe(false);
  });
});
