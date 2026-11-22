import { expect, it } from "vitest";
import {
  boxDistance,
  localNavigationSlot,
  symbolGeometry,
} from "../src/packet/navigation-symbols.js";
import type { PlacedOccurrence } from "../src/packet/navigation-types.js";

// Literal sheet geometry reproduces the two self-loop LTR ambiguities. The
// enclosing device frames, not the small glyphs, establish nearest ownership.
const field = { x: 0, y: 0, w: 200, h: 160 };
const frames = {
  S1: { x: 30, y: 52, w: 42, h: 20 },
  D1: { x: 115.33, y: 52, w: 26, h: 52 },
};
const bodies = {
  S1: { x: 48.564, y: 56.967, w: 4.996, h: 9.844 },
  D1: { x: 124.855, y: 74.512, w: 6.939, h: 6.939 },
};
const ambiguous = {
  S1: { x: 75, y: 35.5, w: 60, h: 2.7 },
  D1: { x: 51.3, y: 100.7, w: 34.7, h: 2.7 },
};
function expectBox(actual: typeof field, expected: typeof field) {
  for (const key of ["x", "y", "w", "h"] as const)
    expect(actual[key]).toBeCloseTo(expected[key], 8);
}
function owner(tag: "S1" | "D1"): PlacedOccurrence {
  return {
    id: tag,
    source: { deviceUid: tag, functionKey: "native" },
    appearance: tag,
    role: "full-function",
    representation: "circuit",
    terminalKeys: ["1", "2"],
    sourceOrigins: [],
    destination: {
      sheet: tag === "D1" ? 1 : 2,
      zone: tag === "D1" ? "A2" : "A1",
      anchorMm: tag === "D1" ? { x: 115.33, y: 78 } : { x: 72, y: 62 },
      anchorRule: "function-terminal-centroid/2",
    },
    primitiveIds: [tag + "-glyph"],
    terminalPrimitiveIds: [tag + "-1", tag + "-2"],
    provenance: {
      symbolKey: tag + "-glyph",
      transform: [1, 0, 0, 1, 0, 0],
      clipMm: field,
      bodyMm: bodies[tag],
      view: { key: "literal-self-loop", authoredOrder: 0 },
    },
  };
}
function fixture(depth: number, frameless = false) {
  const wrap = (s: string) => "<g>".repeat(depth) + s + "</g>".repeat(depth);
  const node = (tag: "S1" | "D1") => {
    const f = frames[tag],
      b = bodies[tag],
      x = tag === "S1" ? 42 : 0;
    return `<g data-device-uid="${tag}" data-layout-width="${f.w}" transform="translate(${f.x} 45.02)">${wrap(`<g data-layout-width="${f.w}" transform="translate(0 6.98)">
<rect x="2" y="2" width="3" height="4" fill="none" stroke="none"/>
${frameless && tag === "D1" ? "" : `<rect class="circuit-device-frame" width="${f.w}" height="${f.h}"/>`}
<rect id="${tag}-glyph" x="${b.x - f.x}" y="${b.y - f.y}" width="${b.w}" height="${b.h}"/>
<circle id="${tag}-1" data-terminal-key="1" cx="${x}" cy="${tag === "S1" ? 6 : 10}" r="0.5"/>
<circle id="${tag}-2" data-terminal-key="2" cx="${x}" cy="${tag === "S1" ? 14 : 42}" r="0.5"/>
</g>`)}</g>`;
  };
  return `<svg viewBox="0 0 200 160"><g data-navigation-view="literal-self-loop"><svg width="160" height="120" viewBox="0 0 160 120">${node("S1")}${node("D1")}<g data-device-uid="clipped-out">${wrap('<rect class="circuit-device-frame" x="180" width="20" height="30"/>')}</g></svg></g></svg>`;
}

it.each([1, 3])(
  "finds device frames through %i nested wrappers and retains visible clips",
  (depth) => {
    for (const tag of ["D1", "S1"] as const) {
      const o = owner(tag),
        geometry = symbolGeometry(o, [o], fixture(depth), field, []);
      expectBox(geometry.frameMm, frames[tag]);
      expect(geometry.framesMm).toHaveLength(1);
      expectBox(geometry.framesMm[0]!, frames[tag === "D1" ? "S1" : "D1"]);
      expect(geometry.anchorMm).toEqual(o.destination.anchorMm);
      expect(localNavigationSlot(ambiguous[tag], geometry)).toBe(false);
    }
  },
);

it("compares the label box against drawn frame boxes and accepts legal local slots", () => {
  const o = owner("D1"),
    geometry = symbolGeometry(o, [o], fixture(2), field, []);
  expect(boxDistance(ambiguous.D1, geometry.frameMm)).toBeCloseTo(29.33, 8);
  expect(boxDistance(ambiguous.D1, geometry.framesMm[0]!)).toBeCloseTo(28.7, 8);
  expect(localNavigationSlot({ x: 120, y: 109, w: 30, h: 5 }, geometry)).toBe(
    true,
  );
});

it("keeps a frameless owner's measured body fallback beside a nested foreign frame", () => {
  const o = owner("D1"),
    geometry = symbolGeometry(o, [o], fixture(2, true), field, []);
  expectBox(geometry.frameMm, bodies.D1);
  expect(geometry.framesMm).toHaveLength(1);
  expectBox(geometry.framesMm[0]!, frames.S1);
});
