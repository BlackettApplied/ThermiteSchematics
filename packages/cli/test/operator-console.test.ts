import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  compileProject,
  analyzeCompleteness,
  serializeIr,
} from "@thermite/compiler";
import {
  buildDocumentation,
  createProjectSnapshot,
  reviewProject,
} from "@thermite/query";
import {
  renderSchematicPacket,
  type SchematicPacketRequest,
} from "@thermite/render";
import { parseHTML } from "linkedom";
const project = "examples/operator-console";
async function fixture() {
  const c = await compileProject(project);
  if (!c.ok) throw new Error(JSON.stringify(c.diagnostics));
  const request: SchematicPacketRequest = JSON.parse(
    await readFile(`${project}/packet.request.json`, "utf8"),
  );
  return { c, request };
}
describe("operator console wiring", () => {
  it("keeps power, bonding and relay contacts separate and accounts for every external output", async () => {
    const { c } = await fixture();
    const pin = (tag: string, terminalKey: string) => ({
      deviceUid: c.ir.devices.find((d) => d.designation === tag)!.uid,
      terminalKey,
    });
    const net = (tag: string, terminalKey: string) =>
      c.ir.nets.find((n) =>
        n.terminalIds.some(
          (t) =>
            t.deviceUid === pin(tag, terminalKey).deviceUid &&
            t.terminalKey === terminalKey,
        ),
      )!;
    expect(net("HMI1", "DC-IN.1").id).toBe(net("XT-HMI", "13").id);
    expect(net("HMI1", "DC-IN.2").id).toBe(net("PS24", "-").id);
    expect(net("HMI1", "CHASSIS").id).toBe(net("PE-MC", "PE").id);
    expect(
      new Set([
        net("HMI1", "DC-IN.1").id,
        net("HMI1", "DC-IN.2").id,
        net("HMI1", "CHASSIS").id,
      ]).size,
    ).toBe(3);
    for (const [i, tag] of ["K-R", "K-Y", "K-G", "K-B"].entries()) {
      expect(net(tag, "A1").id).toBe(net("KP8", String(i + 5)).id);
      expect(
        new Set(["A1", "A2", "11", "12", "14"].map((t) => net(tag, t).id)).size,
      ).toBe(5);
    }
    expect(net("F-CON", "1").id).not.toBe(net("F-CON", "2").id);
    expect(net("F-SL", "1").id).not.toBe(net("F-SL", "2").id);
    const kp = c.ir.devices.find((d) => d.designation === "KP8")!;
    expect(
      Object.values(kp.io!.channels).filter((x) => x.usage === "in-use"),
    ).toHaveLength(4);
    expect(
      Object.values(kp.io!.channels).filter((x) => x.usage === "spare"),
    ).toHaveLength(4);
    expect(analyzeCompleteness(c.ir).counts.requiredMissing).toBe(0);
    const disconnected = structuredClone(c.ir);
    disconnected.wires = disconnected.wires.filter(
      (w) => w.designation !== "W-C06",
    );
    expect(analyzeCompleteness(disconnected).counts.requiredMissing).toBe(1);
  });
  it("preserves Ethernet cable specification and length in IR, schedules and review", async () => {
    const { c } = await fixture();
    const relation = c.ir.relations.find((r) => r.designation === "NET06")!;
    expect(relation.connection!.cable).toMatchObject({
      lengthM: 2.4384,
      specification: "Industrial Cat5e RJ45",
    });
    expect(serializeIr(c.ir)).toContain('"lengthM": 2.4384');
    const table = buildDocumentation(c.ir, {
      format: "documentation-view-request/0.1",
      kind: "network",
    });
    expect(
      table.rows.find((r) => r.key === relation.uid)!.cells.join(" "),
    ).toContain("2.4384 m");
    const before = createProjectSnapshot(c.ir);
    const changed = structuredClone(c.ir);
    changed.relations.find(
      (r) => r.uid === relation.uid,
    )!.connection!.cable!.lengthM = 3;
    expect(
      JSON.stringify(reviewProject(before, createProjectSnapshot(changed))),
    ).toContain("lengthM");
  });
  it("renders each requested wire once with source references, gauges and explicit boundaries", async () => {
    const { c, request } = await fixture();
    const serialized = serializeIr(c.ir);
    const rendered = await renderSchematicPacket(c.ir, request);
    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    expect(rendered.value.sheets).toHaveLength(11);
    for (const [i, sheet] of rendered.value.sheets.entries()) {
      const view = request.views[i]!;
      if (!view || view.format !== "wiring-view-request/0.1") continue;
      const { document } = parseHTML(sheet.svg);
      const elements = [
        ...document.querySelectorAll("[data-wiring-conductor]"),
      ];
      expect(elements).toHaveLength(view.conductors.length);
      expect(
        new Set(elements.map((e) => e.getAttribute("data-wiring-conductor")))
          .size,
      ).toBe(elements.length);
      expect(sheet.svg).toContain("AWG");
      for (const ref of sheet.references)
        expect([ref.xMm, ref.yMm].every(Number.isFinite)).toBe(true);
    }
    expect(rendered.value.sheets[0]!.svg).toContain("[ +1 ]");
    expect(serializeIr(c.ir)).toBe(serialized);
    const again = await renderSchematicPacket(c.ir, request);
    expect(again).toEqual(rendered);
  });
  it("fails unknown, duplicate, malformed, mismatched-order and unreadable requests without hiding wiring", async () => {
    const { c, request } = await fixture();
    const view = request.views[0]!;
    for (const bad of [
      { ...view, conductors: ["missing"] },
      { ...view, conductors: ["W-C01", "W-C01"] },
      {
        ...view,
        conductors: [
          "W-C01",
          c.ir.wires.find((w) => w.designation === "W-C01")!.uid,
        ],
      },
      { ...view, notes: [null] },
      { ...view, deviceOrder: ["PS24", "PS24"] },
      { ...view, flow: "top-to-bottom" },
    ])
      expect(
        (await renderSchematicPacket(c.ir, { ...request, views: [bad as any] }))
          .ok,
      ).toBe(false);
    expect(
      (
        await renderSchematicPacket(c.ir, {
          ...request,
          page: { size: "letter" },
          views: [view],
        })
      ).ok,
    ).toBe(false);
    const hostile = structuredClone(c.ir);
    hostile.deviceTypes.find(
      (t) => t.id === "console-planning:dc-feed",
    )!.description = "bad\u0000text";
    expect(
      (await renderSchematicPacket(hostile, { ...request, views: [view] })).ok,
    ).toBe(false);
  });
});
