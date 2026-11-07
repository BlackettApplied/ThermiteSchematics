import { createElkEngine } from "../src/layout/elk-runtime.js";
import { signalLoopFixture } from "./render-contract-fixture.js";
import { beforeAll, describe, it, expect } from "vitest";
import { compileProject, type ElectricalIr } from "@thermite/compiler";
import {
  renderSchematic,
  createSchematicRendererWithDependencies,
} from "../src/renderer.js";
import { renderSchematicPacket, renderSchematicSheets } from "../src/sheets.js";
import { acceptedTraceRoots } from "../src/intent-rules.js";
import { appendViewDrafts, assembleSheets } from "../src/packet/assembly.js";
import {
  PacketDraftError,
  withPacketViews,
  packetViewContext,
} from "../src/packet/errors.js";
import { normalizePaperPage } from "../src/packet/page.js";
import type { Draft } from "../src/packet/types.js";
let ir: ElectricalIr;
beforeAll(async () => {
  const c = await compileProject("examples/motor-starter");
  if (!c.ok) throw Error("compile");
  ir = c.ir;
});
describe("render error details", () => {
  it("lists accepted trace profiles and actual rule shapes", async () => {
    const r = await renderSchematic(ir, {
      format: "schematic-view-request/0.2",
      root: { by: "designation", value: "K1" },
      intent: {
        kind: "trace",
        to: { by: "designation", value: "PLC1" },
        includePower: false,
      },
    });
    expect(r).toMatchObject({
      ok: false,
      error: {
        code: "R001",
        reason: "root-not-accepted",
        details: {
          acceptedTraceRoots: acceptedTraceRoots(),
          rootFamilies: ["control"],
        },
      },
    });
    if (!r.ok)
      for (const rule of acceptedTraceRoots()) {
        expect(r.error.message).toContain(rule.profile);
        for (const f of rule.functions)
          expect(r.error.message).toContain(`${f.kind}/${f.terminalCount}`);
      }
  });
  it("includes reusable root profiles beyond core aliases in the accepted list", async () => {
    const r = await renderSchematic(ir, {
      format: "schematic-view-request/0.1",
      root: { by: "designation", value: "LS1" },
      family: "control",
    });
    expect(r).toMatchObject({
      ok: false,
      error: {
        reason: "root-not-accepted",
        details: {
          acceptedRoots: expect.arrayContaining([
            expect.objectContaining({
              profile: "thermite:relay",
              shapes: ["coil/2"],
            }),
          ]),
        },
      },
    });
  });
  it("uses the signal loop title before drawing and during assembly failure", async () => {
    const c = await signalLoopFixture();
    if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
    const view = {
      format: "signal-loop-view-request/0.1",
      from: { device: "PT1", function: "signal" },
      to: { device: "AI1", function: "ch0" },
    } as const;
    expect(packetViewContext(view, 2, c.ir)).toEqual({
      viewIndex: 2,
      title: "PT1 - signal loop",
    });
    const failed = await renderSchematicPacket(
      c.ir,
      { format: "schematic-packet-request/0.1", views: [view] },
      { ...c.presentation, revision: "R".repeat(500) },
    );
    expect(failed).toMatchObject({
      ok: false,
      error: {
        code: "R006",
        root: "packet",
        details: { viewTitle: "PT1 - signal loop" },
      },
    });
  });
  it("adds packet context only for an explicit packet failure", async () => {
    const view = {
      format: "schematic-view-request/0.1",
      root: { by: "designation", value: "PB1" },
      family: "power",
    } as const;
    const direct = await renderSchematicSheets(ir, view);
    const packet = await renderSchematicPacket(ir, {
      format: "schematic-packet-request/0.1",
      views: [view],
    });
    expect(direct.ok).toBe(false);
    expect(packet.ok).toBe(false);
    if (!direct.ok && !packet.ok) {
      expect(direct.error.message).not.toContain("Packet view[");
      expect(packet.error.message).toContain('Packet view[0] "PB1 / power"');
      expect(direct.error.root).toBe(packet.error.root);
    }
  });
  it("names the unfed PSU input, terminals and function in R002", async () => {
    // The starter intentionally leaves its PSU AC input unfed.
    const c = await compileProject("packages/cli/templates/starter-default");
    if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
    const r = await renderSchematic(c.ir, {
      format: "schematic-view-request/0.1",
      root: { by: "designation", value: "PS1" },
      family: "power",
    });
    expect(r).toMatchObject({
      ok: false,
      error: {
        code: "R002",
        details: {
          designation: "PS1",
          functions: expect.arrayContaining([
            expect.objectContaining({
              functionKey: "ac_input",
              terminals: expect.arrayContaining([
                expect.objectContaining({
                  designation: "PS1",
                  terminalKey: "L",
                }),
              ]),
            }),
          ]),
        },
      },
    });
    if (!r.ok) expect(r.error.message).toContain("PS1.L");
  });
  it("names R004 conductors, endpoint devices, terminals and functions", async () => {
    const c = await compileProject("examples/machine-demo");
    if (!c.ok) throw Error("compile");
    const missing = c.ir.wires.find((w) => w.designation === "W-RIO2-L+")!;
    const engine = createElkEngine(),
      layout = engine.layout.bind(engine);
    engine.layout = async (...args) => {
      const output = await layout(...args);
      output.edges!.find(
        (e) => e.id === JSON.stringify(["wire", missing.uid]),
      )!.sections![0]!.startPoint.x += 1;
      return output;
    };
    const r = await createSchematicRendererWithDependencies({
      layoutEngine: engine,
    }).render(c.ir, {
      format: "schematic-view-request/0.2",
      root: { by: "designation", value: "PS1" },
      intent: { kind: "loads" },
    });
    expect(r).toMatchObject({
      ok: false,
      error: {
        code: "R004",
        details: {
          conductors: expect.arrayContaining([
            expect.objectContaining({
              designation: "W-RIO2-L+",
              terminals: expect.arrayContaining([
                expect.objectContaining({
                  designation: "RIO2",
                  terminalKey: "L+",
                  functionKeys: expect.any(Array),
                }),
              ]),
            }),
          ]),
        },
      },
    });
    if (!r.ok) {
      expect(r.error.message).toContain("W-RIO2-L+");
      expect(r.error.message).toContain("RIO2.L+");
      expect(r.error.message).not.toMatch(/[a-f0-9]{8}-[a-f0-9]{4}-/);
    }
  });
  it("preserves the original packet view index when circuit appearance validation fails", async () => {
    const r = await renderSchematicPacket(ir, {
      format: "schematic-packet-request/0.1",
      views: [
        { format: "documentation-view-request/0.1", kind: "bom" },
        {
          format: "circuit-view-request/0.1",
          title: "Bad selection",
          groups: [
            {
              id: "bad",
              conductors: [],
              functions: [
                { device: { by: "designation", value: "K1" }, key: "ABSENT" },
              ],
            },
          ],
        },
      ],
    });
    expect(r).toMatchObject({
      ok: false,
      error: {
        code: "R006",
        details: { viewIndex: 1, viewTitle: "Bad selection" },
      },
    });
  });
  it.each([
    ["tabloid", true],
    ["a4", false],
  ] as const)(
    "only recommends compact after proving it succeeds on %s",
    async (size, rescued) => {
      const request = {
        format: "schematic-packet-request/0.1",
        page: { size },
        views: [
          {
            format: "schematic-view-request/0.1",
            root: { by: "designation", value: "M1" },
            family: "power",
            flow: "top-to-bottom",
          },
        ],
      } as const;
      const a = await renderSchematicPacket(ir, request);
      const b = await renderSchematicPacket(ir, {
        ...request,
        layout: "compact",
      });
      expect(a.ok).toBe(false);
      expect(b.ok).toBe(rescued);
      if (!a.ok) {
        expect(a.error.message.includes("--layout compact")).toBe(rescued);
        expect(a.error).toMatchObject({
          code: "R006",
          details: { viewIndex: 0, viewTitle: "M1 / power" },
        });
      }
    },
  );
  it("resolves UID packet roots to designations in the view title", async () => {
    const uid = ir.devices.find((d) => d.designation === "M1")!.uid;
    const result = await renderSchematicPacket(ir, {
      format: "schematic-packet-request/0.1",
      views: [
        {
          format: "schematic-view-request/0.1",
          family: "power",
          root: { by: "uid", value: uid },
          flow: "top-to-bottom",
        },
      ],
    });
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "R006",
        details: { viewIndex: 0, viewTitle: "M1 / power" },
      },
    });
    if (!result.ok) expect(result.error.message).not.toContain(uid);
  });
  it("does not suggest compact when final title-block assembly would fail", async () => {
    const req = {
      format: "schematic-packet-request/0.1",
      views: [
        {
          format: "schematic-view-request/0.1",
          root: { by: "designation", value: "M1" },
          family: "power",
          flow: "top-to-bottom",
        },
      ],
    } as const;
    const presentation = {
      revision: "R".repeat(500),
      backgroundColor: "#fff",
      titleBlockLines: [],
    };
    const r = await renderSchematicPacket(ir, req, presentation);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).not.toContain("--layout compact");
    expect(
      (
        await renderSchematicPacket(
          ir,
          { ...req, layout: "compact" },
          presentation,
        )
      ).ok,
    ).toBe(false);
  });
  it("lists circuit conductor and function keys when a complete conductor cannot fit", async () => {
    const copy = structuredClone(ir);
    copy.wires.find((w) => w.designation === "W-CTL-007")!.properties = {
      label: "LONG".repeat(300),
    };
    const r = await renderSchematicPacket(copy, {
      format: "schematic-packet-request/0.1",
      views: [
        {
          format: "circuit-view-request/0.1",
          title: "Coil circuit",
          groups: [
            {
              id: "coil",
              conductors: ["W-CTL-007"],
              functions: [
                { device: { by: "designation", value: "PLC1" }, key: "do0" },
                { device: { by: "designation", value: "K1" }, key: "coil" },
              ],
            },
          ],
        },
      ],
    });
    expect(r).toMatchObject({
      ok: false,
      error: {
        code: "R006",
        details: {
          circuitGroups: [
            {
              groupId: "coil",
              functionKeys: ["PLC1/do0", "K1/coil"],
              conductorKeys: ["W-CTL-007"],
            },
          ],
        },
      },
    });
    if (!r.ok) {
      expect(r.error.message).toContain("K1/coil");
      expect(r.error.message).toContain("W-CTL-007");
    }
  });
  it("keeps contributing indices and normalized titles through a real compact merge", async () => {
    const c = await compileProject("examples/network-pagination");
    if (!c.ok) throw Error("compile");
    const view = {
      format: "communication-view-request/0.1",
      medium: "ethernet",
      devices: ["N01"],
    } as const;
    const request = {
      format: "schematic-packet-request/0.1",
      layout: "compact",
      views: [view, view],
    } as const;
    const rendered = await renderSchematicPacket(c.ir, request, c.presentation);
    expect(rendered.ok, JSON.stringify(rendered)).toBe(true);
    if (!rendered.ok) return;
    expect(rendered.value.sheets).toHaveLength(1);
    const title = rendered.value.sheets[0]!.view;
    if (title.format !== "documentation-view/0.1")
      throw Error("expected topology");
    const failed = await renderSchematicPacket(c.ir, request, {
      ...c.presentation,
      revision: "R".repeat(500),
    });
    expect(failed).toMatchObject({
      ok: false,
      error: {
        code: "R006",
        details: {
          views: [
            { viewIndex: 0, title: title.title },
            { viewIndex: 1, title: title.title },
          ],
        },
      },
    });
  });
  it("retains all contributing views when compact sheets merge and final assembly fails", () => {
    const page = normalizePaperPage();
    if (!page.ok) throw Error("page");
    const draft = (): Draft => ({
      view: {
        format: "documentation-view/0.1",
        kind: "communication",
        title: "Shared title",
      },
      title: {
        projectName: "Test",
        revision: "R".repeat(500),
        backgroundColor: "#fff",
        toolVersion: "test",
        lines: [],
      },
      content: "",
      links: [],
      note: "test",
      references: [],
      drawingBounds: { x: 0, y: 0, w: 300, h: 200 },
      communicationHeight: 15,
    });
    const drafts: Draft[] = [];
    appendViewDrafts(drafts, [draft()], 0, "compact", 0);
    appendViewDrafts(drafts, [draft()], 2, "compact", 0);
    expect(drafts).toHaveLength(1);
    try {
      assembleSheets(ir, drafts, page.value);
      throw Error("expected failure");
    } catch (error) {
      expect(error).toBeInstanceOf(PacketDraftError);
      if (!(error instanceof PacketDraftError)) throw error;
      const e = withPacketViews(
        { code: "R006", root: "packet", message: error.message },
        error.views,
      );
      expect(e).toMatchObject({
        details: {
          views: [
            { viewIndex: 0, title: "Shared title" },
            { viewIndex: 2, title: "Shared title" },
          ],
        },
      });
      expect(e.root).toBe("packet");
      expect(e.message).toContain("view[2]");
    }
  });
});
