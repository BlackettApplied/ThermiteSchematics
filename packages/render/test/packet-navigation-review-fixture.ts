import type { ElectricalIr } from "@thermite/compiler";
import { navigationFixture, coilUid } from "./packet-navigation-fixture.js";

/** Two source-authored contact functions share one literal drawn symbol. */
export function twoContactFixture(ir: ElectricalIr) {
  const f = navigationFixture(ir);
  const terminals = [
    ["1/L1", "2/T1"],
    ["3/L2", "4/T2"],
  ];
  for (const [i, draft] of f.drafts.entries()) {
    const seed = draft.navigationSeeds![0]!;
    draft.navigationSeeds = ["pole1", "pole2"].map((key, n) => ({
      ...seed,
      source: { deviceUid: coilUid, functionKey: key },
      terminals: [0, 1].map((end) => ({
        key: terminals[n]![end]!,
        primitiveId: `pin-${n}-${end}`,
      })),
    }));
    const pins = [5, 15]
      .flatMap((y, n) =>
        [10, 30].map(
          (x, end) =>
            `<circle id="pin-${n}-${end}" class="terminal-marker" data-device-uid="${coilUid}" data-terminal-key="${terminals[n]![end]!}" cx="${x}" cy="${y}" r="1"/>`,
        ),
      )
      .join("");
    draft.content = draft.content
      .replace('data-function-key="coil"', 'data-aggregate-key="contacts"')
      .replace(/<circle[^>]*\/>/g, "")
      .replace("</g></svg>", `${pins}</g></svg>`);
    f.sheets[i] = {
      ...f.sheets[i]!,
      svg: `<svg width="120" height="80" viewBox="0 0 120 80">${draft.content}</svg>`,
    };
  }
  return f;
}

export function conveyorRequest() {
  return {
    format: "schematic-packet-request/0.1" as const,
    layout: "compact" as const,
    index: true,
    views: [
      ...["M1", "M2"].map((value) => ({
        format: "schematic-view-request/0.1" as const,
        root: { by: "designation" as const, value },
        family: "power" as const,
        flow: "left-to-right",
      })),
      ...["K1", "K2"].map((value) => ({
        format: "schematic-view-request/0.1" as const,
        root: { by: "designation" as const, value },
        family: "control" as const,
        flow: "left-to-right",
      })),
      { format: "documentation-view-request/0.1", kind: "wires" },
      { format: "documentation-view-request/0.1", kind: "terminals" },
    ],
  };
}

/** Two explicit requested placements in one view, with literal unscaled geometry. */
export function sameViewFixture(
  ir: ElectricalIr,
  positions: readonly { sheet: number; x: number; y: number }[],
) {
  const f = navigationFixture(ir),
    contents: string[] = [];
  for (const [i, p] of positions.entries()) {
    const d = f.drafts[i]!,
      seed = d.navigationSeeds![0]!;
    d.navigationView = { key: "one-view", authoredOrder: 0 };
    d.navigationSeeds = [
      {
        ...seed,
        nativeId: `native-${i}`,
        logicalKey: `placement-${i}`,
        terminals: seed.terminals.map((t) => ({
          ...t,
          primitiveId: `${t.primitiveId}-${i}`,
        })),
      },
    ];
    const content = d.content
      .replace(
        /data-navigation-view="[^"]*"/,
        'data-navigation-view="one-view"',
      )
      .replace(
        '<svg x="10" y="20" width="80" height="40"',
        `<svg x="${p.x}" y="${p.y}" width="40" height="20"`,
      )
      .replaceAll('"native"', `"native-${i}"`)
      .replaceAll('"pin-a"', `"pin-a-${i}"`)
      .replaceAll('"pin-b"', `"pin-b-${i}"`);
    contents.push(content);
    d.content = content;
    f.sheets[i] = {
      ...f.sheets[i]!,
      number: p.sheet,
      svg: `<svg viewBox="0 0 120 80">${content}</svg>`,
    };
  }
  if (positions[0]!.sheet === positions[1]!.sheet) {
    f.drafts[0]!.navigationSeeds = f.drafts.flatMap((d) => d.navigationSeeds!);
    f.drafts.splice(1);
    f.sheets.splice(1);
    f.sheets[0] = {
      ...f.sheets[0]!,
      svg: `<svg viewBox="0 0 120 80">${contents.join("")}</svg>`,
    };
  }
  return f;
}
