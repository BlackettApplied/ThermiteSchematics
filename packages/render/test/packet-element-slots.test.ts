import { expect, it } from "vitest";
import type { NavigationShape } from "../src/packet/navigation-types.js";
import { searchNavigationSlot } from "../src/packet/navigation-slot-search.js";
import {
  allocateNavigationSlots,
  type SheetSlotRequest,
} from "../src/packet/navigation-slots.js";
import { navigationPlacementInk } from "../src/packet/navigation-placement.js";

const shape = (mode: NavigationShape["mode"] = "local"): NavigationShape => ({
  id: mode,
  mode,
  inkMm: { x: 0, y: 0, w: 20, h: 8 },
  maximumForms: ["literal"],
  wrapWidthMm: 18,
});
const ink = { x: 1, y: 1, w: 16, h: 4 };
const owner = { x: 0, y: 0, w: 0, h: 0 };
const area = { x: 0, y: 0, w: 18.1, h: 10 };

it("fits the printed ink and its metric margin without consuming empty emission padding", () => {
  const plain = searchNavigationSlot([shape()], area, owner, []);
  expect(plain).toBeUndefined();
  const result = searchNavigationSlot(
    [shape()],
    area,
    owner,
    [],
    undefined,
    [],
    false,
    undefined,
    new Map([["local", ink]]),
    true,
  );
  expect(result).toBeDefined();
  if (!result) return;
  const printed = navigationPlacementInk(result.box, ink);
  expect(printed.x).toBeGreaterThanOrEqual(1);
  expect(printed.y).toBeGreaterThanOrEqual(1);
  expect(printed.x + printed.w).toBeLessThanOrEqual(area.w - 1);
  expect(printed.y + printed.h).toBeLessThanOrEqual(area.h - 1);
  expect(result.protectedBox.w).toBeCloseTo(16.02, 9);
  expect(result.protectedBox.h).toBeCloseTo(4.02, 9);
  expect(printed.w).toBe(16);
  expect(printed.h).toBe(4);
  expect(
    searchNavigationSlot(
      [shape()],
      { ...area, w: 16.01 },
      owner,
      [],
      undefined,
      [],
      false,
      undefined,
      new Map([["local", ink]]),
      true,
    ),
  ).toBeUndefined();
});

it("protects actual ink between consecutive element labels, including the 4 mm text clearance", () => {
  const request = (id: string): SheetSlotRequest => ({
    owner,
    fitPrintedInk: true,
    localityInkMm: new Map([["local", ink]]),
    reservation: {
      id,
      ownerOccurrence: id,
      ownerAppearance: id,
      profileId: "literal",
      space: "sheet-slot",
      inkMm: shape().inkMm,
      maximumForms: ["literal"],
      shapes: [shape()],
    },
  });
  const result = allocateNavigationSlots(
    [request("first"), request("second")],
    { x: 0, y: 0, w: 41, h: 7 },
    '<svg width="41mm" height="7mm" viewBox="0 0 41 7"/>',
    1,
  );
  expect(result).toHaveLength(2);
  const printed = result.map((r) => {
    if (!r.allocatedMm) throw Error("Missing literal allocation");
    return navigationPlacementInk(r.allocatedMm.rect, ink);
  });
  const [first, second] = printed;
  if (!first || !second) throw Error("Missing literal ink");
  expect(second.x - first.x - first.w).toBeGreaterThanOrEqual(4);
  for (const p of printed) {
    expect(p.x).toBeGreaterThanOrEqual(1);
    expect(p.y).toBeGreaterThanOrEqual(1);
    expect(p.x + p.w).toBeLessThanOrEqual(40);
    expect(p.y + p.h).toBeLessThanOrEqual(6);
  }
});

it.each(["local", "self-located"] as const)(
  "rejects %s element ink beyond one source even when the shared centroid is nearby",
  (mode) => {
    const locality = {
      anchorMm: { x: 80, y: 20 },
      sourceAnchorsMm: [
        { x: 20, y: 20 },
        { x: 80, y: 20 },
      ],
      frameMm: { x: 70, y: 10, w: 20, h: 20 },
      framesMm: [],
      ownerLocation: { sheet: 1, zone: "A1" },
    };
    expect(
      searchNavigationSlot(
        [shape(mode)],
        { x: 100, y: 20, w: 25, h: 10 },
        locality.frameMm,
        [],
        locality,
      ),
    ).toBeUndefined();
  },
);
