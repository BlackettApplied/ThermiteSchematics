import { beforeAll, describe, expect, it, vi } from "vitest";
import { resolve } from "node:path";
import { parseHTML } from "linkedom";
import { openSync } from "fontkit";
import BundledElk from "elkjs/lib/elk.bundled.js";
import type { ELK, ElkNode } from "elkjs/lib/elk-api.js";
import { compileProject, type ElectricalIr } from "@thermite/compiler";
import {
  prepareCommunicationDrawing,
  type CommunicationViewRequest,
} from "../src/communication.js";
import { renderSchematicPacket, type RenderedPacket } from "../src/sheets.js";
let ir: ElectricalIr;
const font = openSync(
  resolve("packages/cli/assets/fonts/NotoSans-Regular.ttf"),
);
if (!("unitsPerEm" in font)) throw new Error("Expected a single font.");
beforeAll(async () => {
  const c = await compileProject(resolve("examples/network-pagination"));
  if (!c.ok) throw new Error(JSON.stringify(c.diagnostics));
  expect(c.diagnostics.every((d) => d.code === "W904")).toBe(true);
  ir = c.ir;
});
const view = (
  medium: "ethernet" | "nrg-bus" = "ethernet",
): CommunicationViewRequest => ({
  format: "communication-view-request/0.1",
  medium,
});
const identity = (p: { deviceUid: string; portKey: string }) =>
  JSON.stringify([p.deviceUid, p.portKey]);
async function conservation(
  packet: RenderedPacket,
  request: CommunicationViewRequest,
) {
  const original = (await prepareCommunicationDrawing(ir, request))
    .topologyCoverage!;
  const sheets = packet.sheets.filter((s) => s.view.kind === "communication");
  const docs = sheets.map((s) => parseHTML(s.svg).document);
  const links = docs.flatMap((d) => [
    ...d.querySelectorAll("[data-communication-link]"),
  ]);
  expect(
    links.map((e) => e.getAttribute("data-communication-link")).sort(),
  ).toEqual([...original.relationIds].sort());
  for (const e of links) {
    const entry = packet.coverage.topology.communicationLinks.find(
      (l) => l.id === e.getAttribute("data-communication-link"),
    )!;
    expect(JSON.parse(e.getAttribute("data-communication-endpoints")!)).toEqual(
      entry.endpoints,
    );
    expect(entry.appearances).toHaveLength(1);
  }
  const ports = docs.flatMap((d) =>
    [...d.querySelectorAll("[data-device-uid]")].flatMap((owner) =>
      [...owner.querySelectorAll("[data-communication-port]")].map((e) =>
        identity({
          deviceUid: owner.getAttribute("data-device-uid")!,
          portKey: e.getAttribute("data-communication-port")!,
        }),
      ),
    ),
  );
  expect(ports.sort()).toEqual(original.ports.map(identity).sort());
  expect(
    [
      ...new Set(
        docs.flatMap((d) =>
          [...d.querySelectorAll("[data-device-uid]")].map((e) =>
            e.getAttribute("data-device-uid"),
          ),
        ),
      ),
    ].sort(),
  ).toEqual([...original.deviceUids].sort());
  expect(packet.coverage.counts.conductors.represented).toBe(0);
  for (const [i, document] of docs.entries()) {
    const sheet = sheets[i]!;
    expect(document.documentElement.textContent).toContain("Part ");
    expect(sheet.svg).not.toContain("data-net-id=");
    for (const e of document.querySelectorAll("text[font-size='2.7']")) {
      let scale = 1;
      for (let owner = e.parentElement; owner; owner = owner.parentElement) {
        const m = owner.getAttribute("transform")?.match(/scale\(([\d.]+)\)/);
        if (m) scale *= Number(m[1]);
      }
      expect(2.7 * scale).toBeGreaterThanOrEqual(2.5);
    }
    for (const e of document.querySelectorAll(
      "[data-communication-continuation-device] text",
    )) {
      const width =
        (font
          .layout(e.textContent!)
          .glyphs.reduce((n, g) => n + g.advanceWidth, 0) *
          2.5) /
        font.unitsPerEm;
      expect(Number(e.getAttribute("x")) + width).toBeLessThanOrEqual(
        packet.page.widthMm - packet.page.marginMm - 18,
      );
      expect(Number(e.getAttribute("y"))).toBeLessThan(
        packet.page.heightMm - packet.page.marginMm - 35,
      );
    }
    for (const c of sheet.communicationContinuations ?? []) {
      const target = packet.sheets[c.toSheet - 1]!;
      expect(target.references.some((r) => r.deviceUid === c.deviceUid)).toBe(
        true,
      );
      expect(target.communicationContinuations).toContainEqual({
        view: c.view,
        fromPart: c.toPart,
        toPart: c.fromPart,
        toSheet: sheet.number,
        deviceUid: c.deviceUid,
      });
    }
  }
}
describe("bounded communication packets", () => {
  for (const medium of ["ethernet", "nrg-bus"] as const)
    for (const size of ["tabloid", "a3", "a4", "letter"] as const)
      it(`conserves whole ${medium} links and ports on ${size}`, async () => {
        const before = JSON.stringify(ir);
        const request = {
          format: "schematic-packet-request/0.1" as const,
          page: { size, orientation: "landscape" as const },
          views: [view(medium)],
        };
        const r = await renderSchematicPacket(ir, request);
        if (!r.ok) throw new Error(r.error.message);
        expect(r.value.sheets.length).toBeGreaterThan(1);
        await conservation(r.value, view(medium));
        expect(await renderSchematicPacket(ir, request)).toEqual(r);
        expect(JSON.stringify(ir)).toBe(before);
        expect(ir.nets).toHaveLength(0);
      });
  it("preserves original selector boundaries without expanding through adjacent devices", async () => {
    const request = { ...view(), devices: ["N05", "N08", "ISO1"] };
    const r = await renderSchematicPacket(ir, {
      format: "schematic-packet-request/0.1",
      views: [request],
    });
    if (!r.ok) throw new Error(r.error.message);
    await conservation(r.value, request);
    const represented = r.value.coverage.topology.communicationLinks
      .filter((l) => l.appearances.length)
      .map((l) => l.designation);
    expect(represented.sort()).toEqual([
      "BR1",
      "BR2",
      "BR3",
      "NET04",
      "NET05",
      "NET07",
      "NET08",
    ]);
    for (const s of r.value.sheets) {
      const d = parseHTML(s.svg).document;
      for (const owner of d.querySelectorAll("[data-device-uid]")) {
        const designation = ir.devices.find(
          (x) => x.uid === owner.getAttribute("data-device-uid"),
        )!.designation;
        expect(owner.textContent!.includes("Boundary (schedule)")).toBe(
          !request.devices.includes(designation),
        );
      }
    }
    expect(
      r.value.coverage.topology.communicationPorts.find(
        (p) => p.designation === "N06.OUT",
      )!.appearances,
    ).toHaveLength(0);
    expect(
      r.value.coverage.topology.devices.find((p) => p.designation === "ISO1")!
        .appearances,
    ).toHaveLength(1);
  });
  it.each(["standard", "compact"] as const)(
    "resolves sheet references for independent repeated views and indexes with %s layout",
    async (layout) => {
      const small = { ...view(), devices: ["N01"] };
      const request = {
        format: "schematic-packet-request/0.1" as const,
        layout,
        index: true,
        views: [
          small,
          view(),
          view(),
          {
            format: "documentation-view-request/0.1" as const,
            kind: "network" as const,
          },
        ],
      };
      const r = await renderSchematicPacket(ir, request);
      if (!r.ok) throw new Error(r.error.message);
      expect(r.value.sheets[0]!.communicationContinuations).toBeUndefined();
      for (const s of r.value.sheets)
        for (const c of s.communicationContinuations ?? []) {
          expect([2, 3]).toContain(c.view);
          const target = r.value.sheets[c.toSheet - 1]!;
          expect(
            target.communicationContinuations!.every((t) => t.view === c.view),
          ).toBe(true);
          expect(target.communicationContinuations).toContainEqual({
            view: c.view,
            fromPart: c.toPart,
            toPart: c.fromPart,
            toSheet: s.number,
            deviceUid: c.deviceUid,
          });
          const d = parseHTML(s.svg).document;
          const e = [
            ...d.querySelectorAll("[data-communication-continuation-device]"),
          ].find(
            (e) =>
              e.getAttribute("data-communication-continuation-device") ===
              c.deviceUid,
          )!;
          expect(
            JSON.parse(e.getAttribute("data-destination-sheets")!),
          ).toContain(c.toSheet);
          expect(e.textContent).toContain(
            `P${c.toPart}/S${String(c.toSheet).padStart(2, "0")}`,
          );
        }
      expect(r.value.sheets.at(-1)!.view.kind).toBe("references");
      expect(r.value.sheets.some((s) => s.view.kind === "network")).toBe(true);
    },
  );
  it("retains a fitting view and its single-drawing API exactly", async () => {
    const request = { ...view(), devices: ["N01"] };
    const drawing = await prepareCommunicationDrawing(ir, request);
    expect(drawing.pagination).toBeUndefined();
    const r = await renderSchematicPacket(ir, {
      format: "schematic-packet-request/0.1",
      views: [request],
    });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.sheets).toHaveLength(1);
    expect(r.value.sheets[0]!.svg).toContain(drawing.content);
    expect(r.value.sheets[0]!.communicationContinuations).toBeUndefined();
    expect(r.value.sheets[0]!.view.title).not.toContain("Part ");
  });
  it("keeps disconnected port-bearing bodies without claiming individual port coverage", async () => {
    const isolated = structuredClone(ir);
    isolated.relations = [];
    isolated.devices = Array.from({ length: 60 }, (_, i) => ({
      ...ir.devices[0]!,
      uid: `77000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
      designation: `ISO${i + 1}`,
    }));
    const r = await renderSchematicPacket(isolated, {
      format: "schematic-packet-request/0.1",
      page: { size: "letter", orientation: "landscape" },
      views: [view()],
    });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.sheets.length).toBeGreaterThan(1);
    expect(r.value.coverage.topology.counts.devices.represented).toBe(60);
    expect(
      r.value.coverage.topology.counts.communicationPorts.represented,
    ).toBe(0);
    expect(
      r.value.coverage.topology.devices.every(
        (d) => d.appearances.length === 1,
      ),
    ).toBe(true);
  });
  it.each([
    "original missing edge",
    "original detached endpoint",
    "projected missing edge",
  ])("fails invalid layout without retries: %s", async (scenario) => {
    const prototype = (BundledElk as unknown as { prototype: ELK }).prototype,
      layout = prototype.layout;
    const spy = vi.spyOn(prototype, "layout");
    if (scenario.startsWith("projected"))
      spy.mockImplementationOnce(function (this: ELK, g: ElkNode) {
        return layout.call(this, g);
      });
    spy.mockImplementationOnce(async function (this: ELK, g: ElkNode) {
      const r = await layout.call(this, g);
      if (scenario.includes("missing")) r.edges!.pop();
      else r.edges![0]!.sections![0]!.startPoint.x += 2;
      return r;
    });
    try {
      const r = await renderSchematicPacket(ir, {
        format: "schematic-packet-request/0.1",
        views: [view()],
      });
      expect(r).toMatchObject({ ok: false, error: { code: "R006" } });
      expect(r).not.toHaveProperty("value");
      expect(spy).toHaveBeenCalledTimes(
        scenario.startsWith("projected") ? 2 : 1,
      );
    } finally {
      spy.mockRestore();
    }
  });
  it("fails a complete unit whose labels cannot fit and retains the original device limit", async () => {
    const tall = structuredClone(ir);
    for (const type of tall.deviceTypes)
      type.description = "Detailed interface ".repeat(100);
    const r = await renderSchematicPacket(tall, {
      format: "schematic-packet-request/0.1",
      views: [view()],
    });
    expect(r).toMatchObject({ ok: false, error: { code: "R006" } });
    expect(r).not.toHaveProperty("value");
    const many = structuredClone(ir);
    many.relations = [];
    many.devices = Array.from({ length: 81 }, (_, i) => ({
      ...ir.devices[0]!,
      uid: `78000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
      designation: `ISO${i + 1}`,
    }));
    const tooMany = await renderSchematicPacket(many, {
      format: "schematic-packet-request/0.1",
      views: [view()],
    });
    expect(tooMany).toMatchObject({ ok: false, error: { code: "R006" } });
    if (!tooMany.ok) expect(tooMany.error.message).toContain("80 devices");
  });
});
