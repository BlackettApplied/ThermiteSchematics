import { expect, it, vi } from "vitest";
import { offViewFixture, parseSvg } from "./off-view-fixtures.js";
import { mirrorFixture } from "./packet-mirror-fixture.js";
import { coilUid } from "./packet-navigation-fixture.js";
import { finalizeNavigation } from "../src/packet/navigation-finalize.js";
import {
  mirrorIsLocal,
  validateMirrorLocality,
} from "../src/packet/mirror-ink.js";
import * as slots from "../src/packet/navigation-slots.js";
import type { SymbolGeometry } from "../src/packet/navigation-symbols.js";
import type {
  AnnotationReservation,
  NavigationAnnotation,
} from "../src/packet/navigation-types.js";

const field = { x: 0, y: 0, w: 120, h: 80 };
const geometry = (): SymbolGeometry => ({
  anchorMm: { x: 50, y: 40 },
  frameMm: { x: 40, y: 30, w: 20, h: 20 },
  framesMm: [],
  ownerLocation: { sheet: 1, zone: "C3" },
});
const annotation = (heading = "K1"): NavigationAnnotation => ({
  id: "literal",
  ownerOccurrence: "coil",
  ownerOccurrences: ["coil"],
  role: "mirror",
  targets: [],
  text: heading,
  mirror: {
    coil: { deviceUid: coilUid, functionKey: "coil" },
    rows: [],
    heading,
  },
  primitiveIds: ["ink"],
  reservationId: "literal",
});
const slot = (): AnnotationReservation => ({
  id: "literal",
  ownerOccurrence: "coil",
  ownerAppearance: "view",
  profileId: "literal",
  space: "sheet-slot",
  inkMm: { x: 0, y: 0, w: 20, h: 10 },
  maximumForms: ["K1 /100.D1"],
  allocatedMm: {
    sheet: 1,
    rect: { x: 65, y: 35, w: 20, h: 10 },
    placement: "local",
  },
});

it("requires the coil's zone neighbourhood in addition to distance and nearest frame", () => {
  const g = geometry();
  expect(mirrorIsLocal({ x: 65, y: 35, w: 10, h: 10 }, g, field)).toBe(true);
  // 31 mm from the coil, still its nearest frame, but column 5 is outside C3's neighbourhood.
  expect(mirrorIsLocal({ x: 81, y: 35, w: 10, h: 10 }, g, field)).toBe(false);
  expect(mirrorIsLocal({ x: 65, y: 0, w: 10, h: 10 }, g, field)).toBe(false);
});

it.each([
  "foreign-sheet",
  "over-60",
  "foreign-nearest",
  "outside-zone-band",
  "wrong-zone",
  "wrong-tag",
])("rejects the locality mutation %s", async (mutation) => {
  const source = await offViewFixture();
  try {
    const g = geometry(),
      s = slot(),
      a = annotation();
    if (mutation === "foreign-sheet") s.allocatedMm!.sheet = 2;
    if (mutation === "over-60")
      s.allocatedMm!.rect = { x: 111, y: 35, w: 5, h: 10 };
    if (mutation === "foreign-nearest")
      g.framesMm = [{ x: 85, y: 35, w: 10, h: 10 }];
    if (mutation === "outside-zone-band")
      s.allocatedMm!.rect = { x: 81, y: 35, w: 10, h: 10 };
    if (mutation === "wrong-zone" || mutation === "wrong-tag") {
      s.allocatedMm!.rect = { x: 81, y: 35, w: 10, h: 10 };
      a.mirror!.heading = mutation === "wrong-zone" ? "K1 /01.A1" : "K2 /01.C3";
    }
    expect(() => validateMirrorLocality(source.ir, a, s, g, field)).toThrow(
      /locality/,
    );
    a.mirror!.heading = "K1 /01.C3";
    if (mutation !== "foreign-sheet")
      expect(() =>
        validateMirrorLocality(source.ir, a, s, g, field),
      ).not.toThrow();
  } finally {
    await source.dispose();
  }
});

it("derives a self-located heading from geometry even when allocation claims local", async () => {
  const source = await offViewFixture(),
    allocate = slots.allocateNavigationSlots;
  const spy = vi
    .spyOn(slots, "allocateNavigationSlots")
    .mockImplementation((requests, area, svg, sheet) =>
      allocate(requests, area, svg, sheet).map((r) =>
        r.profileId.startsWith("mirror-")
          ? {
              ...r,
              allocatedMm: {
                ...r.allocatedMm!,
                placement: "local" as const,
                rect: { x: 220, y: 100, w: r.inkMm.w, h: r.inkMm.h },
              },
            }
          : r,
      ),
    );
  try {
    const f = mirrorFixture(source.ir, [
        [{ uid: coilUid, key: "coil", x: 100, y: 100 }],
      ]),
      r = finalizeNavigation(f.ir, f.drafts, f.sheets);
    if (!r.ok) throw Error(JSON.stringify(r.error));
    const a = r.value.navigation.annotations.find((a) => a.role === "mirror")!;
    expect(a.mirror!.heading).toBe("K1 /01.B2");
    expect(a.locality).toMatchObject({
      mode: "self-located",
      anchorMm: { x: 110, y: 106 },
      ownerLocation: { sheet: 1, zone: "B2" },
    });
    const visible = parseSvg(r.value.sheets[0]!.svg).querySelector(
      '[data-navigation-role="mirror"] text',
    )!;
    expect(visible.textContent).toBe("K1 /01.B2");
    expect(visible.getAttribute("font-size")).toBe("3.782");
  } finally {
    spy.mockRestore();
    await source.dispose();
  }
});

it("refuses a forged foreign-sheet mirror allocation in production finalization", async () => {
  const source = await offViewFixture(),
    allocate = slots.allocateNavigationSlots;
  const spy = vi
    .spyOn(slots, "allocateNavigationSlots")
    .mockImplementation((requests, area, svg, sheet) =>
      allocate(requests, area, svg, sheet).map((r) =>
        r.profileId.startsWith("mirror-")
          ? { ...r, allocatedMm: { ...r.allocatedMm!, sheet: sheet + 1 } }
          : r,
      ),
    );
  try {
    const f = mirrorFixture(source.ir, [
        [{ uid: coilUid, key: "coil", x: 100, y: 100 }],
      ]),
      r = finalizeNavigation(f.ir, f.drafts, f.sheets);
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(r.error.message).toContain("coil and mirror must share a sheet");
  } finally {
    spy.mockRestore();
    await source.dispose();
  }
});

it("enforces 60 mm even inside a neighbouring zone with the coil still nearest", () => {
  const g: SymbolGeometry = {
    anchorMm: { x: 180, y: 120 },
    frameMm: { x: 170, y: 110, w: 20, h: 20 },
    framesMm: [],
    ownerLocation: { sheet: 1, zone: "C4" },
  };
  const field = { x: 0, y: 0, w: 360, h: 240 };
  expect(mirrorIsLocal({ x: 240, y: 115, w: 20, h: 10 }, g, field)).toBe(true);
  expect(mirrorIsLocal({ x: 240.01, y: 115, w: 20, h: 10 }, g, field)).toBe(
    false,
  );
});

it.each(["same-device", "foreign-device"])(
  "compares a %s circuit body by device ownership",
  async (kind) => {
    const source = await offViewFixture(),
      allocate = slots.allocateNavigationSlots;
    const spy = vi
      .spyOn(slots, "allocateNavigationSlots")
      .mockImplementation((requests, area, svg, sheet) =>
        allocate(requests, area, svg, sheet).map((r) =>
          r.profileId.startsWith("mirror-")
            ? {
                ...r,
                allocatedMm: {
                  ...r.allocatedMm!,
                  rect: { x: 160, y: 100, w: r.inkMm.w, h: r.inkMm.h },
                },
              }
            : r,
        ),
      );
    try {
      const ir = structuredClone(source.ir);
      const uid =
        kind === "same-device"
          ? coilUid
          : ir.devices.find((d) => d.uid !== coilUid)!.uid;
      if (kind === "foreign-device") {
        const contact = structuredClone(
          ir.functions.find(
            (f) => f.id.deviceUid === coilUid && f.id.functionKey === "pole1",
          )!,
        );
        contact.id.deviceUid = uid;
        ir.functions.push(contact);
      }
      const f = mirrorFixture(ir, [
        [
          { uid: coilUid, key: "coil", x: 100, y: 100 },
          { uid, key: "pole1", x: 220, y: 100 },
        ],
      ]);
      f.drafts[0]!.navigationSeeds = f.drafts[0]!.navigationSeeds!.map((s) => ({
        ...s,
        representation: "circuit",
      }));
      f.sheets[0]!.svg = f.sheets[0]!.svg.replace(
        /(<g [^>]*class="symbol function-symbol"[^>]*?) data-device-uid="[^"]*"/g,
        "$1",
      );
      const r = finalizeNavigation(f.ir, f.drafts, f.sheets);
      if (!r.ok) throw Error(JSON.stringify(r.error));
      // Coil frame is x=100..120; the table ends at 215, 5 mm from the contact's x=220 frame.
      expect(
        r.value.navigation.annotations.find((a) => a.role === "mirror")!.mirror!
          .heading,
      ).toBe(kind === "same-device" ? "K1" : "K1 /01.B2");
    } finally {
      spy.mockRestore();
      await source.dispose();
    }
  },
);
