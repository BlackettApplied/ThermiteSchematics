import type { ElectricalIr } from "@thermite/compiler";
import type { Draft, RenderedSheet } from "../src/packet/types.js";
import type { NativeOccurrenceSeed } from "../src/packet/navigation-types.js";
export const coilUid = "84000000-0000-4000-8000-000000000002";
/** Explicit native geometry, unrelated to the production planner or ELK. */
export function navigationFixture(ir: ElectricalIr, coilMirror = false) {
  const source = { deviceUid: coilUid, functionKey: "coil" };
  const seed: NativeOccurrenceSeed = {
    source,
    logicalKey: "authored-placement",
    nativeId: "native",
    representation: "function",
    body: { x: 0, y: 0, w: 40, h: 20 },
    terminals: [
      { key: "A1", primitiveId: "pin-a" },
      { key: "A2", primitiveId: "pin-b" },
    ],
  };
  const make = (viewKey: string, order: number, x = 10) => {
    const content = `<g data-navigation-view="${viewKey}"><svg x="${x}" y="20" width="80" height="40" viewBox="0 0 40 20"><g id="native" class="symbol function-symbol" data-function-key="coil" data-device-uid="${coilUid}" data-navigation-native="native"><rect width="40" height="20" fill="none" stroke="black"/><circle id="pin-a" class="terminal-marker" data-device-uid="${coilUid}" data-terminal-key="A1" cx="10" cy="10" r="1"/><circle id="pin-b" class="terminal-marker" data-device-uid="${coilUid}" data-terminal-key="A2" cx="30" cy="10" r="1"/></g></svg></g>`;
    const draft: Draft = {
      navigationSeeds: [seed],
      navigationView: { key: viewKey, authoredOrder: order },
      view: {
        format: "documentation-view/0.1",
        kind: "circuit",
        title: "Synthetic",
      },
      drawingBounds: { x: 0, y: 0, w: 120, h: 80 },
      title: {
        projectName: "Synthetic",
        revision: "test",
        backgroundColor: "white",
        toolVersion: "test",
        lines: [],
      },
      content,
      links: [],
      note: "",
      references: [],
    };
    return draft;
  };
  const drafts = [make("first", 0), make("second", 1)];
  const sheets: RenderedSheet[] = drafts.map((d, i) => ({
    number: i + 1,
    view: d.view,
    references: [],
    continuations: [],
    svg: `<svg width="120" height="80" viewBox="0 0 120 80">${d.content}</svg>`,
  }));
  return {
    ir: {
      ...structuredClone(ir),
      // The M5 slot plate uses an arbitrary function key, "coil", with kind other.
      // Its 120×80 field deliberately tests repeat-only capacity. M2 opts into
      // the real coil and supplies a larger independent print plate.
      functions: structuredClone(ir.functions).map((f) =>
        !coilMirror && f.kind === "coil" ? { ...f, kind: "other" as const } : f,
      ),
      wires: [],
      jumpers: [],
      cables: [],
      cableConductors: [],
    },
    drafts,
    sheets,
  };
}
