import { expect, it } from "vitest";
import {
  localNavigationSlot,
  symbolGeometry,
} from "../src/packet/navigation-symbols.js";
import type { PlacedOccurrence } from "../src/packet/navigation-types.js";

// Literal section geometry, independent of the navigation planner.
const owner: PlacedOccurrence = {
  id: "owner",
  source: { deviceUid: "owner-device", functionKey: "coil" },
  appearance: "owner",
  role: "full-function",
  representation: "function",
  terminalKeys: ["A1", "A2"],
  sourceOrigins: [],
  destination: {
    sheet: 1,
    zone: "B2",
    anchorMm: { x: 40, y: 30 },
    anchorRule: "function-terminal-centroid/2",
  },
  primitiveIds: ["owner-symbol"],
  terminalPrimitiveIds: ["a1", "a2"],
  provenance: {
    symbolKey: "owner-symbol",
    transform: [1, 0, 0, 1, 10, 10],
    clipMm: { x: 10, y: 10, w: 80, h: 40 },
    bodyMm: { x: 30, y: 20, w: 20, h: 20 },
    view: { key: "literal", authoredOrder: 0 },
  },
};
const field = { x: 0, y: 0, w: 200, h: 100 };
const svg = `<svg viewBox="0 0 200 100"><g data-navigation-view="literal">
<svg x="10" y="10" width="80" height="40" viewBox="0 0 80 40">
<g data-device-uid="owner-device"><rect class="device-frame" width="120" height="60"/>
<g id="owner-symbol"><circle id="a1" data-terminal-key="A1" cx="25" cy="20"/><circle id="a2" data-terminal-key="A2" cx="35" cy="20"/></g></g>
<g data-device-uid="partial"><rect class="device-frame" x="70" y="20" width="30" height="30"/></g>
<g data-device-uid="visible"><rect class="device-frame" x="10" y="5" width="10" height="5"/></g>
<g data-device-uid="clipped-out"><rect class="device-frame" x="90" width="20" height="20"/></g>
<g data-device-uid="edge-only"><rect class="device-frame" x="80" width="20" height="20"/></g>
</svg></g></svg>`;

it("exports only the visible parts of own and foreign device frames", () => {
  const geometry = symbolGeometry(owner, [owner], svg, field);
  expect(geometry.anchorMm).toEqual({ x: 40, y: 30 });
  expect(geometry.frameMm).toEqual({ x: 10, y: 10, w: 80, h: 40 });
  expect(geometry.framesMm).toEqual([
    { x: 80, y: 30, w: 10, h: 20 },
    { x: 20, y: 15, w: 10, h: 5 },
  ]);
});

it("uses the clipped own frame when deciding which device is nearest", () => {
  const geometry = symbolGeometry(
    owner,
    [owner],
    svg.replace(
      'x="70" y="20" width="30" height="30"',
      'x="70" y="30" width="10" height="10"',
    ),
    field,
  );
  // The full own frame would surround this box. The visible foreign frame is
  // tied with the visible own frame, so a local heading would be ambiguous.
  expect(localNavigationSlot({ x: 91, y: 50, w: 10, h: 5 }, geometry)).toBe(
    false,
  );
});
