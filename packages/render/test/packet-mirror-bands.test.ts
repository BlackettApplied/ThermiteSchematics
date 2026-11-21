import { expect, it } from "vitest";
import { navigationPlacementFamily } from "../src/packet/navigation-placement.js";
import {
  allocateNavigationSlots,
  NavigationSlotFailure,
  type SheetSlotRequest,
} from "../src/packet/navigation-slots.js";
import { searchNavigationSlot } from "../src/packet/navigation-slot-search.js";
const field = { x: 0, y: 0, w: 360, h: 240 },
  owner = { x: 100, y: 100, w: 20, h: 20 };
const locality = {
  anchorMm: { x: 110, y: 110 },
  frameMm: owner,
  framesMm: [],
  ownerLocation: { sheet: 1, zone: "B2" },
};
it.each([
  [{ x: 125, y: 100, w: 55, h: 25 }, "beside"],
  [{ x: 100, y: 125, w: 55, h: 25 }, "below"],
  [{ x: 125, y: 125, w: 55, h: 25 }, "below-right"],
  [{ x: 0, y: 100, w: 35, h: 25 }, "zone-column"],
  [{ x: 100, y: 0, w: 55, h: 25 }, "margin-band"],
] as const)("classifies literal measured box %j as %s", (box, family) => {
  expect(navigationPlacementFamily(box, field, owner, locality)).toBe(family);
});
const request = (): SheetSlotRequest => ({
  owner,
  locality,
  preferBesideBelow: true,
  reservation: {
    id: "literal",
    ownerAppearance: "literal",
    ownerOccurrence: "literal",
    profileId: "literal",
    space: "sheet-slot",
    inkMm: { x: 0, y: 0, w: 55, h: 25 },
    maximumForms: ["literal"],
  },
});
it.each(["zone-column", "margin-band"] as const)(
  "exports the %s band family independently of locality",
  (family) => {
    const r = request();
    r.families = [family];
    const result = allocateNavigationSlots(
      [r],
      field,
      '<svg viewBox="0 0 360 240"><rect x="100" y="100" width="20" height="20" fill="black"/></svg>',
      1,
    )[0]!;
    expect(result.allocatedMm).toMatchObject({
      family,
      familyRule: "approach-or-outer-zone-row/1",
    });
  },
);
it.each([undefined, ["beside"]] as const)(
  "exports a local family when printed ink is local but the reservation ties (%j)",
  (families) => {
    const box = { x: 61.5, y: 132.1, w: 55, h: 25 };
    const r = request();
    r.owner = { x: 118.2, y: 153.8, w: 42, h: 30.5 };
    r.locality = {
      anchorMm: { x: 139.2, y: 169.05 },
      frameMm: r.owner,
      framesMm: [{ x: 70, y: 158.8, w: 35.35, h: 30.5 }],
      ownerLocation: { sheet: 1, zone: "C3" },
    };
    r.localityInkMm = new Map([["local", { x: 1, y: 1.6, w: 53, h: 21.935 }]]);
    r.families = families;
    expect(() =>
      allocateNavigationSlots([r], box, '<svg viewBox="0 0 360 240"/>', 1),
    ).not.toThrow();
    const result = allocateNavigationSlots(
      [r],
      box,
      '<svg viewBox="0 0 360 240"/>',
      1,
    )[0]!;
    expect(result.allocatedMm!.placement).toBe("local");
    expect(["beside", "below", "below-right"]).toContain(
      result.allocatedMm!.family,
    );
    expect(result.allocatedMm!.family).toBe("beside");
  },
);

it("prefers beside/below approaches using the same printed ink as acceptance", () => {
  const shape = {
    id: "local",
    mode: "local" as const,
    inkMm: { x: 0, y: 0, w: 55, h: 25 },
    maximumForms: [],
    wrapWidthMm: 53,
  };
  const result = searchNavigationSlot(
    [shape],
    { x: 119.5, y: 100, w: 100, h: 100 },
    owner,
    [],
    locality,
    [],
    true,
    undefined,
    new Map([["local", { x: 1.5, y: 1.6, w: 53, h: 21.9 }]]),
  );
  // Reservation overlaps the owner's right edge by 0.5 mm; its ink is beside.
  // A reservation-based re-sort incorrectly promotes the more distant below slot.
  expect(result!.box).toEqual({ x: 119.5, y: 100, w: 55, h: 25 });
});
it("reports measured blocked vacancy for every approved family without relaxing a slot", () => {
  const r = request();
  r.locality = undefined;
  try {
    allocateNavigationSlots(
      [r],
      { x: 0, y: 0, w: 60, h: 60 },
      '<svg viewBox="0 0 60 60"><rect width="30" height="60" fill="black"/></svg>',
      1,
    );
    throw Error("unexpected fit");
  } catch (error) {
    expect(error).toBeInstanceOf(NavigationSlotFailure);
    const search = (error as NavigationSlotFailure).search as {
      families: {
        family: string;
        maximumClearWidthAtRequiredHeightMm: number;
      }[];
    };
    expect(search.families.map((r) => r.family)).toEqual([
      "beside",
      "below",
      "below-right",
      "zone-column",
      "margin-band",
    ]);
    expect(
      Math.max(
        ...search.families.map((r) => r.maximumClearWidthAtRequiredHeightMm),
      ),
    ).toBeGreaterThan(28.49);
    expect(
      Math.max(
        ...search.families.map((r) => r.maximumClearWidthAtRequiredHeightMm),
      ),
    ).toBeLessThanOrEqual(28.5);
  }
});
