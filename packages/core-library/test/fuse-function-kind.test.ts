import { parseHTML } from "linkedom";
import { expect, it } from "vitest";
import type { ElectricalIr } from "@thermite/compiler";
import { prepareCircuitView } from "../../render/src/circuit.js";
import { renderSchematic } from "../../render/src/renderer.js";
import { renderSchematicPacket } from "../../render/src/sheets.js";
import { coreTypes, machineProbe } from "./machine-fixtures.js";

function legacyContact(ir: ElectricalIr, typeId: string, deviceUid: string) {
  const before = structuredClone(ir);
  for (const f of before.deviceTypes.find((t) => t.id === typeId)!
    .functions as any[]) {
    f.kind = "contact";
    f.normal_state = "closed";
  }
  for (const f of before.functions.filter(
    (f) => f.id.deviceUid === deviceUid,
  ) as any[]) {
    f.kind = "contact";
    f.normal_state = "closed";
  }
  return before;
}
function fuseGlyphs(svg: string) {
  const document = parseHTML(svg).document;
  return [...document.querySelectorAll('[data-symbol-id="ais:fuse"]')].map(
    (g) => {
      // Caption removal changes layout bounds and placement, not local symbol geometry.
      g.removeAttribute("transform");
      return g.outerHTML;
    },
  );
}
for (const poles of [1, 2, 3])
  for (const flow of ["left-to-right", "top-to-bottom"] as const) {
    it(`${poles}P fuse / ${flow}: preserves every power pole and circuit/packet bytes without NC captions`, async () => {
      const type = (await coreTypes()).find(
        (t) => t.id === `core:fuse-${poles}p`,
      )!;
      for (const f of Object.values(type.functions) as any[]) {
        expect(f.kind).toBe("other");
        expect(f.normal_state).toBeUndefined();
      }
      // Exercise every pole in a complete power path, not only the first pole.
      for (const key of Object.keys(type.functions)) {
        const fixture = await machineProbe(type, "power", key);
        try {
          const uid = fixture.ir.devices.find(
            (d) => d.designation === "DUT",
          )!.uid;
          const before = legacyContact(fixture.ir, type.id, uid);
          const original = await renderSchematic(before, {
            ...fixture.request,
            flow,
          });
          const actual = await renderSchematic(fixture.ir, {
            ...fixture.request,
            flow,
          });
          expect(original.ok).toBe(true);
          expect(actual.ok).toBe(true);
          if (!original.ok || !actual.ok)
            throw Error(JSON.stringify([original, actual]));
          expect(original.value.svg).not.toContain(">NC</text>");
          expect(actual.value.svg).not.toContain(">NC</text>");
          expect(fuseGlyphs(actual.value.svg)).toHaveLength(1);
          expect(fuseGlyphs(actual.value.svg)).toEqual(
            fuseGlyphs(original.value.svg),
          );
          expect(actual.value.summary).toEqual(original.value.summary);
          const request = {
            format: "circuit-view-request/0.1" as const,
            title: "Fuse shape equivalence",
            flow,
            groups: [
              {
                id: "fuse",
                functions: Object.keys(type.functions).map((key) => ({
                  device: { by: "designation" as const, value: "DUT" },
                  key,
                })),
                conductors: [],
              },
            ],
          };
          expect(await prepareCircuitView(fixture.ir, request)).toEqual(
            await prepareCircuitView(before, request),
          );
          const packetRequest = {
            format: "schematic-packet-request/0.1" as const,
            views: [request],
          };
          const oldPacket = await renderSchematicPacket(before, packetRequest);
          const packet = await renderSchematicPacket(fixture.ir, packetRequest);
          expect(oldPacket.ok).toBe(true);
          expect(packet.ok).toBe(true);
          expect(JSON.stringify(packet) === JSON.stringify(oldPacket)).toBe(
            true,
          );
        } finally {
          await fixture.dispose();
        }
      }
    }, 30000);
  }
