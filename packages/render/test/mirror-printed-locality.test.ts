import { expect, it, vi } from "vitest";
import {
  resolveMirrorLocality,
  validateMirrorLocality,
} from "../src/packet/mirror-ink.js";
import { mirrorIsLocal } from "../src/packet/mirror-ink.js";
import type { SymbolGeometry } from "../src/packet/navigation-symbols.js";
import type {
  AnnotationReservation,
  NavigationAnnotation,
} from "../src/packet/navigation-types.js";
import { offViewFixture } from "./off-view-fixtures.js";
import { coilUid } from "./packet-navigation-fixture.js";
import { mirrorInk, mirrorLocalityInk } from "../src/packet/mirror-layout.js";
import { allocateNavigationSlots } from "../src/packet/navigation-slots.js";
import {
  boxDistance,
  localNavigationSlot,
} from "../src/packet/navigation-symbols.js";
import { searchNavigationSlot } from "../src/packet/navigation-slot-search.js";
import * as slots from "../src/packet/navigation-slots.js";
import { finalizeNavigation } from "../src/packet/navigation-finalize.js";
import { mirrorFixture } from "./packet-mirror-fixture.js";
import { mirrorAnnotationSvg } from "../src/packet/mirror-ink.js";
import { embedPrintableFont } from "../../cli/src/printable-font.js";
import {
  launch,
  openSheet,
  drawingContextOptions,
} from "../../../evals/draw/browser.mjs";

// Literal sheet-mm plates isolate the two #248 disagreements. The electrical
// fixture supplies only K1's identity; neither frame nor ink comes from exports.
const annotation = (): NavigationAnnotation => ({
  id: "mirror",
  ownerOccurrence: "coil",
  ownerOccurrences: ["coil"],
  role: "mirror",
  targets: [],
  text: "K1",
  primitiveIds: ["mirror-ink"],
  reservationId: "mirror",
  mirror: {
    coil: { deviceUid: coilUid, functionKey: "coil" },
    heading: "K1",
    rows: Array.from({ length: 4 }, (_, i) => ({
      source: { deviceUid: coilUid, functionKey: `pole${i + 1}` },
      state: "NO" as const,
      terminals: ["13", "14"],
      destinations: ["01.A1"],
      targets: [],
      sourceOrigins: [],
      primitiveId: `row-${i}`,
    })),
  },
});
const reservation = (
  sheet: number,
  rect: { x: number; y: number; w: number; h: number },
): AnnotationReservation => ({
  id: "mirror",
  ownerAppearance: "coil",
  ownerOccurrence: "coil",
  profileId: "literal",
  space: "sheet-slot",
  inkMm: { ...rect, x: 0, y: 0 },
  maximumForms: ["K1 /100.D1"],
  allocatedMm: { sheet, rect, placement: "local" },
});
const plates: {
  name: string;
  box: { x: number; y: number; w: number; h: number };
  geometry: SymbolGeometry;
  field: { x: number; y: number; w: number; h: number };
  heading: string;
}[] = [
  {
    name: "heading glyph inset crosses the centroid distance ceiling",
    box: { x: 28, y: 174.448, w: 55, h: 25 },
    geometry: {
      anchorMm: { x: 39.5, y: 114.96 },
      frameMm: { x: 34, y: 98.85, w: 11, h: 32.225 },
      framesMm: [{ x: 110.25, y: 45, w: 22, h: 48 }],
      ownerLocation: { sheet: 1, zone: "B1" },
    },
    field: { x: 28, y: 28, w: 240, h: 240 },
    heading: "K1 /01.B1",
  },
  {
    name: "ink insets reverse the nearest visible frame",
    box: { x: 122.027, y: 122.388, w: 55, h: 25 },
    geometry: {
      anchorMm: { x: 176.63, y: 106.69 },
      frameMm: { x: 155.427, y: 83.1875, w: 42, h: 30.5 },
      framesMm: [{ x: 74.727, y: 141.8125, w: 38.25, h: 31.5 }],
      ownerLocation: { sheet: 2, zone: "A4" },
    },
    field: { x: 28, y: 28, w: 240, h: 340 },
    heading: "K1 /02.A4",
  },
];

it.each(plates)("$name", async ({ box, geometry, field, heading }) => {
  const source = await offViewFixture();
  try {
    const a = annotation(),
      s = reservation(geometry.ownerLocation.sheet, box);
    // Ablation: the identical anchor/frames pass if blank reservation is used.
    expect(mirrorIsLocal(box, geometry, field)).toBe(true);
    expect(() =>
      validateMirrorLocality(source.ir, a, s, geometry, field),
    ).toThrow(/locality/);
    expect(() =>
      resolveMirrorLocality(source.ir, a, s, geometry, field),
    ).not.toThrow();
    const result = resolveMirrorLocality(source.ir, a, s, geometry, field);
    expect(result.mirror!.heading).toBe(heading);
    expect(result.locality!.mode).toBe("self-located");
    expect(() =>
      validateMirrorLocality(source.ir, result, s, geometry, field),
    ).not.toThrow();
  } finally {
    await source.dispose();
  }
});

it.each(plates)(
  "search rejects the reservation-only local slot: $name",
  ({ box, geometry }) => {
    const a = annotation(),
      s = reservation(geometry.ownerLocation.sheet, box);
    const result = allocateNavigationSlots(
      [
        {
          reservation: s,
          owner: geometry.frameMm,
          locality: geometry,
          localityInkMm: mirrorLocalityInk(a, s),
        },
      ],
      box,
      '<svg viewBox="0 0 400 400"/>',
      geometry.ownerLocation.sheet,
    )[0]!;
    expect(result.allocatedMm!.rect).toEqual(box);
    expect(result.allocatedMm!.placement).toBe("self-located");
  },
);

it("includes the rule endpoints and the heading glyph inset in printed locality", () => {
  const ink = mirrorInk(annotation(), plates[1]!.box);
  expect(ink.x).toBe(123.027);
  expect(ink.w).toBeCloseTo(53, 9);
  expect(ink.y).toBeCloseTo(123.989, 2);
  expect(boxDistance(ink, plates[1]!.geometry.frameMm)).toBeCloseTo(10.3015, 2);
  expect(boxDistance(ink, plates[1]!.geometry.framesMm[0]!)).toBeCloseTo(
    10.05,
    5,
  );
});

it("ranks accepted local candidates by printed ink rather than blank capacity", () => {
  const shape = {
    id: "local",
    mode: "local" as const,
    inkMm: { x: 0, y: 0, w: 50, h: 10 },
    maximumForms: [],
    wrapWidthMm: 48,
  };
  const geometry: SymbolGeometry = {
    anchorMm: { x: 100, y: 50 },
    frameMm: { x: 90, y: 40, w: 20, h: 20 },
    framesMm: [],
    ownerLocation: { sheet: 1, zone: "C4" },
  };
  const result = searchNavigationSlot(
    [shape],
    { x: 0, y: 0, w: 200, h: 100 },
    geometry.frameMm,
    [],
    geometry,
    [],
    false,
    undefined,
    new Map([["local", { x: 1, y: 1, w: 10, h: 2 }]]),
  );
  expect(result!.box).toEqual({ x: 90, y: 61.51, w: 50, h: 10 });
});

it("rejects a nearest-frame advantage inside the 0.02 mm browser-safe ambiguity band", () => {
  const geometry: SymbolGeometry = {
    anchorMm: { x: 30, y: 25 },
    frameMm: { x: 20, y: 20, w: 20, h: 10 },
    framesMm: [{ x: 70.015, y: 20, w: 10, h: 10 }],
    ownerLocation: { sheet: 1, zone: "A1" },
  };
  expect(localNavigationSlot({ x: 50, y: 20, w: 10, h: 10 }, geometry)).toBe(
    false,
  );
  geometry.framesMm = [{ x: 70.03, y: 20, w: 10, h: 10 }];
  expect(localNavigationSlot({ x: 50, y: 20, w: 10, h: 10 }, geometry)).toBe(
    true,
  );
});

it("passes actual mirror ink into production slot search", async () => {
  const source = await offViewFixture(),
    allocate = slots.allocateNavigationSlots;
  let mirrors = 0;
  const spy = vi
    .spyOn(slots, "allocateNavigationSlots")
    .mockImplementation((requests, ...args) => {
      for (const request of requests.filter((r) =>
        r.reservation.profileId.startsWith("mirror-"),
      )) {
        mirrors++;
        const ink = request.localityInkMm?.get("local");
        expect(ink).toBeDefined();
        expect(ink!.x).toBe(1);
        expect(ink!.y).toBeCloseTo(1.6, 2);
      }
      return allocate(requests, ...args);
    });
  try {
    const f = mirrorFixture(source.ir, [
      [{ uid: coilUid, key: "coil", x: 100, y: 100 }],
    ]);
    expect(finalizeNavigation(f.ir, f.drafts, f.sheets).ok).toBe(true);
    expect(mirrors).toBe(1);
  } finally {
    spy.mockRestore();
    await source.dispose();
  }
});

it("matches browser printed glyphs and rule endpoints for full, wrapped and self-located tables", async () => {
  // This calibration needs float glyph bounds, not the upstream integer fallback.
  const browser = await launch([
    "--enable-blink-features=CanvasTextMetricsPreciseBounds",
  ]);
  try {
    const page = await (
      await browser.newContext(drawingContextOptions)
    ).newPage();
    for (const kind of ["full", "wrapped", "located"] as const) {
      const a = annotation(),
        box = plates[1]!.box;
      if (kind === "wrapped") a.mirror!.rows = [];
      if (kind === "located") a.mirror!.heading = "K1 /02.A4";
      const s = reservation(2, box),
        expected = mirrorInk(a, box);
      const svg = embedPrintableFont(
        `<svg xmlns="http://www.w3.org/2000/svg" width="300mm" height="300mm" viewBox="0 0 300 300">${mirrorAnnotationSvg(a, s)}</svg>`,
      );
      const g = await openSheet(page, svg);
      const boxes = [...g.texts, ...g.shapes].map(
        (r: { bbox: { x: number; y: number; w: number; h: number } }) => r.bbox,
      );
      const x = Math.min(...boxes.map((b: { x: number }) => b.x)),
        y = Math.min(...boxes.map((b: { y: number }) => b.y));
      const actual = {
        x,
        y,
        w:
          Math.max(...boxes.map((b: { x: number; w: number }) => b.x + b.w)) -
          x,
        h:
          Math.max(...boxes.map((b: { y: number; h: number }) => b.y + b.h)) -
          y,
      };
      for (const key of ["x", "y", "w", "h"] as const)
        expect(actual[key]).toBeCloseTo(expected[key], 2);
    }
  } finally {
    await browser.close();
  }
});
