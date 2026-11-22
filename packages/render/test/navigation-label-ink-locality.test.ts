import { expect, it } from "vitest";
import { allocateNavigationSlots } from "../src/packet/navigation-slots.js";
import { resolveLabelLocality } from "../src/packet/navigation-locality.js";
import type { SymbolGeometry } from "../src/packet/navigation-symbols.js";
import type {
  AnnotationReservation,
  NavigationAnnotation,
} from "../src/packet/navigation-types.js";
import { offViewFixture } from "./off-view-fixtures.js";
import { coilUid } from "./packet-navigation-fixture.js";

const box = { x: 49.961, y: 99.655, w: 63.051, h: 5.8 };
const geometry: SymbolGeometry = {
  anchorMm: { x: 115.33, y: 77.98 },
  frameMm: { x: 115.325, y: 51.982, w: 26, h: 52 },
  framesMm: [{ x: 30, y: 51.982, w: 42, h: 20 }],
  ownerLocation: { sheet: 1, zone: "A2" },
};
const reservation: AnnotationReservation = {
  id: "D1",
  ownerAppearance: "D1",
  ownerOccurrence: "D1",
  profileId: "literal-max-roles",
  space: "sheet-slot",
  inkMm: { x: 0, y: 0, w: box.w, h: box.h },
  maximumForms: ["D1: Repeat of 100.D1 (same function)"],
  shapes: [
    {
      id: "local/0",
      mode: "local",
      inkMm: { x: 0, y: 0, w: box.w, h: box.h },
      maximumForms: ["D1: Repeat of 100.D1 (same function)"],
      wrapWidthMm: box.w - 2,
    },
  ],
  allocatedMm: { sheet: 1, rect: box, shapeId: "local/0", placement: "local" },
};

it("does not use blank max-role capacity to make short D1 ink appear nearest", () => {
  const request = {
    owner: geometry.frameMm,
    locality: geometry,
    reservation,
    // Independent literal ink bounds from the synthetic D1 plate: the reserved
    // right edge is near D1, while the shorter printed row is nearer S1.
    localityInkMm: new Map([
      ["local/0", { x: 1.35, y: 1.04, w: 34.7, h: 2.7 }],
    ]),
  };
  const svg = '<svg viewBox="0 0 200 160"/>';
  expect(() => allocateNavigationSlots([request], box, svg, 1)).toThrow(
    /cannot fit/,
  );
  // A genuinely wider printed row in the same reservation may be local.
  request.localityInkMm.set("local/0", { x: 1.35, y: 1.04, w: 61.051, h: 2.7 });
  expect(
    allocateNavigationSlots([request], box, svg, 1)[0]!.allocatedMm!.rect,
  ).toEqual(box);
});

it("rejects a local finalization when actual short text is nearer a foreign frame", async () => {
  const source = await offViewFixture();
  try {
    const ir = structuredClone(source.ir);
    ir.devices.find((d) => d.uid === coilUid)!.designation = "D1";
    const annotation: NavigationAnnotation = {
      id: "D1",
      role: "canonical",
      ownerOccurrence: "D1",
      ownerOccurrences: ["D1"],
      targets: [],
      text: "D1: Also shown 02.A2",
      primitiveIds: ["D1-ink"],
      reservationId: "D1",
    };
    expect(() =>
      resolveLabelLocality(ir, annotation, reservation, geometry, coilUid),
    ).toThrow(/locality/);
  } finally {
    await source.dispose();
  }
});
