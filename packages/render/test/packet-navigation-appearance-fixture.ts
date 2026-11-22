import type { ElectricalIr } from "@thermite/compiler";
import { navigationFixture, coilUid } from "./packet-navigation-fixture.js";
export interface AppearancePlacement {
  key: string;
  x: number;
  y: number;
}
const poles = ["pole1", "pole2", "pole3"].map((key, i) => ({
  key,
  x: 50,
  y: 20 + i * 40,
}));
/** Separate authored functions, separate glyphs, one device frame per requested view. */
export function appearanceFixture(
  ir: ElectricalIr,
  views: readonly (readonly AppearancePlacement[])[] = [poles, poles],
) {
  const f = navigationFixture(ir),
    template = f.drafts[0]!;
  f.drafts = views.map((placements, i) => {
    const viewKey = ["first", "second", "third"][i] ?? `view-${i}`;
    const glyphs = placements.map(({ key, x, y }) => {
      const fn = ir.functions.find(
        (fn) => fn.id.deviceUid === coilUid && fn.id.functionKey === key,
      )!;
      if (fn.terminals.length !== 2)
        throw Error("Fixture requires two authored terminals");
      return {
        seed: {
          source: fn.id,
          logicalKey: `separate-${key}`,
          nativeId: `glyph-${key}`,
          representation: "function",
          body: { x: 0, y: 0, w: 20, h: 10 },
          terminals: fn.terminals.map((t, n) => ({
            key: t.terminalKey,
            primitiveId: `${key}-${n}`,
          })),
        },
        svg: `<g transform="translate(${x} ${y})" id="glyph-${key}" class="symbol function-symbol" data-function-key="${key}" data-device-uid="${coilUid}" data-navigation-native="glyph-${key}"><rect width="20" height="10" fill="none" stroke="black"/>${fn.terminals.map((t, n) => `<circle id="${key}-${n}" class="terminal-marker" data-device-uid="${coilUid}" data-terminal-key="${t.terminalKey}" cx="${n * 20}" cy="5" r="1"/>`).join("")}</g>`,
      };
    });
    return {
      ...structuredClone(template),
      navigationView: { key: viewKey, authoredOrder: i },
      drawingBounds: { x: 0, y: 0, w: 240, h: 160 },
      navigationSeeds: glyphs.map((g) => g.seed),
      content: `<g data-navigation-view="${viewKey}"><g data-device-uid="${coilUid}"><rect class="device-frame" x="45" y="15" width="30" height="100" fill="none" stroke="black"/></g>${glyphs.map((g) => g.svg).join("")}</g>`,
    };
  });
  f.sheets = f.drafts.map((d, i) => ({
    ...f.sheets[0]!,
    number: i + 1,
    view: d.view,
    svg: `<svg width="240" height="160" viewBox="0 0 240 160">${d.content}</svg>`,
  }));
  return f;
}
