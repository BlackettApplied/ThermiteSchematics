import type { ElectricalIr } from "@thermite/compiler";
import type { Draft, RenderedSheet } from "../src/packet/types.js";
import { escapeXmlAttribute as attr } from "../src/svg/escape.js";

export interface MirrorPlacement {
  uid: string;
  key: string;
  x: number;
  y: number;
}
/** Literal native function/terminal geometry, independent of navigation planning. */
export function mirrorFixture(
  ir: ElectricalIr,
  pages: MirrorPlacement[][],
  gangs = false,
) {
  const drafts: Draft[] = pages.map((placements, i) => {
    const view = { key: `view-${i}`, authoredOrder: i };
    const symbols = placements.map((p, index) => {
      const fn = ir.functions.find(
        (f) => f.id.deviceUid === p.uid && f.id.functionKey === p.key,
      );
      if (!fn) throw Error("Missing native fixture function");
      const id = `native-${index}`;
      return {
        seed: {
          source: fn.id,
          logicalKey: `placement-${index}`,
          nativeId: id,
          representation: "function",
          body: { x: 0, y: 0, w: 20, h: 12 },
          terminals: fn.terminals.map((t, n) => ({
            key: t.terminalKey,
            primitiveId: `${id}-pin-${n}`,
          })),
        },
        svg: `<g id="${id}" data-navigation-native="${id}" class="symbol function-symbol" data-device-uid="${attr(p.uid)}" data-function-key="${attr(p.key)}" transform="translate(${p.x} ${p.y})"><rect class="device-frame" width="20" height="12" fill="none" stroke="black"/>${fn.terminals.map((t, n) => `<circle id="${id}-pin-${n}" class="terminal-marker" data-device-uid="${attr(p.uid)}" data-terminal-key="${attr(t.terminalKey)}" cx="${(20 * n) / Math.max(1, fn.terminals.length - 1)}" cy="6" r="0.7"/>`).join("")}</g>`,
      };
    });
    const links = gangs
      ? ir.gangedGroups
          .flatMap((g) => {
            const members = placements.filter((p) =>
              g.functionIds.some(
                (f) => f.deviceUid === p.uid && f.functionKey === p.key,
              ),
            );
            return members.length < 2
              ? []
              : [
                  `<path data-mechanical-association="ganged" data-ganged-functions="${attr(JSON.stringify(members.map((p) => ({ deviceUid: p.uid, functionKey: p.key }))))}" d="M ${members[0]!.x + 10} ${members[0]!.y + 6} L ${members[members.length - 1]!.x + 10} ${members[members.length - 1]!.y + 6}" stroke="black" stroke-dasharray="1 1" fill="none"/>`,
                ];
          })
          .join("")
      : "";
    return {
      navigationView: view,
      navigationSeeds: symbols.map((s) => s.seed),
      view: {
        format: "documentation-view/0.1",
        kind: "circuit",
        title: "Synthetic mirror plate",
      },
      drawingBounds: { x: 0, y: 0, w: 360, h: 240 },
      title: {
        projectName: "Synthetic",
        revision: "test",
        backgroundColor: "white",
        toolVersion: "test",
        lines: [],
      },
      content: `<g data-navigation-view="${view.key}">${symbols.map((s) => s.svg).join("")}${links}</g>`,
      links: [],
      note: "",
      references: [],
    };
  });
  const sheets: RenderedSheet[] = drafts.map((d, i) => ({
    number: i + 1,
    view: d.view,
    references: [],
    continuations: [],
    svg: `<svg width="360mm" height="240mm" viewBox="0 0 360 240">${d.content}</svg>`,
  }));
  return {
    ir: {
      ...structuredClone(ir),
      wires: [],
      jumpers: [],
      cables: [],
      cableConductors: [],
    },
    drafts,
    sheets,
  };
}

/** One native authored drawing, cut at x=200 between the second and third poles. */
export function sameViewSplitGangFixture(ir: ElectricalIr, uid: string) {
  const f = mirrorFixture(
    ir,
    [
      [
        { uid, key: "coil", x: 100, y: 40 },
        { uid, key: "pole1", x: 100, y: 100 },
        { uid, key: "pole2", x: 160, y: 100 },
        { uid, key: "pole3", x: 220, y: 100 },
      ],
    ],
    true,
  );
  const native = f.drafts[0]!;
  f.drafts = [0, 200].map((x, i) => ({
    ...structuredClone(native),
    content: `<svg x="0" y="0" width="${i ? 160 : 200}" height="240" viewBox="${x} 0 ${i ? 160 : 200} 240">${native.content}</svg>`,
  }));
  f.sheets = f.drafts.map((d, i) => ({
    ...f.sheets[0]!,
    number: i + 1,
    svg: `<svg width="360mm" height="240mm" viewBox="0 0 360 240">${d.content}</svg>`,
  }));
  return f;
}
