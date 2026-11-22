import { expect, it, vi } from "vitest";
import { navigationFixture } from "./packet-navigation-fixture.js";
import { offViewFixture } from "./off-view-fixtures.js";
import { finalizeNavigation } from "../src/packet/navigation-finalize.js";
import * as slots from "../src/packet/navigation-slots.js";
import type { SheetSlotRequest } from "../src/packet/navigation-slots.js";
import {
  navigationZone,
  roundNavigation,
} from "../src/packet/navigation-location.js";
import { printableTextMetrics } from "../src/text-metrics.js";
import { centroidReferences } from "../src/packet/navigation-occurrences.js";

const request = (w = 20): SheetSlotRequest => ({
  owner: { x: 40, y: 30, w: 20, h: 20 },
  locality: {
    anchorMm: { x: 50, y: 40 },
    frameMm: { x: 40, y: 30, w: 20, h: 20 },
    framesMm: [],
    ownerLocation: { sheet: 1, zone: "C3" },
  },
  reservation: {
    id: "literal",
    ownerOccurrence: "literal",
    ownerAppearance: "literal",
    profileId: "literal",
    space: "sheet-slot",
    inkMm: { x: 0, y: 0, w, h: 6 },
    maximumForms: ["literal"],
  },
});
const ownFrame =
  '<g data-device-uid="owner"><rect class="device-frame" x="40" y="30" width="20" height="20" fill="black"/></g>';
it("prefers the nearest local slot with literal centroid/frame geometry", () => {
  const result = slots.allocateNavigationSlots(
    [request()],
    { x: 0, y: 0, w: 120, h: 80 },
    `<svg viewBox="0 0 120 80">${ownFrame}</svg>`,
    1,
  )[0]!.allocatedMm!;
  expect(result.placement).toBe("local");
  expect(result.rect.x).toBe(40);
  expect(
    Math.min(Math.abs(result.rect.y - 22.49), Math.abs(result.rect.y - 51.51)),
  ).toBeCloseTo(0, 9);
});
it("keeps 1.5 mm clearance when a closer candidate has only a 1 mm gap", () => {
  const r = request();
  r.locality = undefined;
  r.owner = { x: 0, y: 0, w: 10, h: 10 };
  const svg =
    '<svg viewBox="0 0 20 40"><rect class="device-frame" width="10" height="10" fill="black"/><rect x="0" y="18.51" width="20" height="4" fill="black"/></svg>';
  const b = slots.allocateNavigationSlots(
    [r],
    { x: 0, y: 0, w: 20, h: 40 },
    svg,
    1,
  )[0]!.allocatedMm!.rect;
  expect(b.y).toBeGreaterThanOrEqual(24.01);
});
it("self-locates space within 60 mm when a foreign frame is nearer", () => {
  const r = request();
  r.owner = { x: 40, y: 50, w: 20, h: 20 };
  r.locality!.anchorMm = { x: 50, y: 60 };
  r.locality!.frameMm = r.owner;
  r.locality!.framesMm = [{ x: 40, y: 0, w: 20, h: 10 }];
  const svg =
    '<svg viewBox="0 0 120 80"><rect class="device-frame" x="40" y="50" width="20" height="20" fill="black"/><rect class="device-frame" x="40" y="0" width="20" height="10" fill="black"/></svg>';
  const b = slots.allocateNavigationSlots(
    [r],
    { x: 40, y: 12, w: 20, h: 18 },
    svg,
    1,
  )[0]!.allocatedMm!;
  expect(b.placement).toBe("self-located");
  expect(b.rect).toEqual({ x: 40, y: 24, w: 20, h: 6 });
});
it("self-locates a real label whose nearest free space exceeds 60 mm", async () => {
  const source = await offViewFixture();
  try {
    const f = navigationFixture(source.ir);
    const barriers =
      '<rect x="0" y="0" width="150" height="18.49" fill="black"/><rect x="0" y="61.51" width="150" height="18.49" fill="black"/><rect x="0" y="18.49" width="8.49" height="43.02" fill="black"/><rect x="91.51" y="18.49" width="58.49" height="43.02" fill="black"/>';
    for (const [i, sheet] of f.sheets.entries()) {
      f.drafts[i]!.drawingBounds = { x: 0, y: 0, w: 320, h: 80 };
      f.sheets[i] = {
        ...sheet,
        svg: sheet.svg
          .replace('<rect width="40"', '<rect class="device-frame" width="40"')
          .replace(
            'width="120" height="80" viewBox="0 0 120 80"',
            'width="320" height="80" viewBox="0 0 320 80"',
          )
          .replace("</svg></g></svg>", `</svg></g>${barriers}</svg>`),
      };
    }
    const r = finalizeNavigation(f.ir, f.drafts, f.sheets);
    if (!r.ok) throw Error(JSON.stringify(r.error));
    expect(r.value.navigation.annotations.map((a) => a.text)).toEqual([
      "K1 (01.C1): Also shown 02.C1",
      "K1 (02.C1): Repeat of 01.C1 (same function)",
    ]);
    for (const a of r.value.navigation.annotations) {
      expect(a.locality!.mode).toBe("self-located");
      expect(a.locality!.anchorMm).toEqual({ x: 50, y: 40 });
      expect(a.locality!.distanceMm).toBeGreaterThan(60);
    }
  } finally {
    await source.dispose();
  }
});
it.each(["foreign-locality", "undersized-ink"])(
  "refuses production finalization for %s",
  async (mutation) => {
    const source = await offViewFixture();
    const spy = vi
      .spyOn(slots, "allocateNavigationSlots")
      .mockImplementation((requests, _area, _svg, sheet) =>
        requests.map(({ reservation }) => ({
          ...reservation,
          allocatedMm: {
            sheet,
            placement: "local",
            rect:
              mutation === "undersized-ink"
                ? { x: 50, y: 40, w: 1, h: 1 }
                : { x: 250, y: 0, w: 100, h: 10 },
          },
        })),
      );
    try {
      const f = navigationFixture(source.ir),
        r = finalizeNavigation(f.ir, f.drafts, f.sheets);
      expect(r.ok).toBe(false);
      if (!r.ok)
        expect(r.error.message).toMatch(
          mutation === "undersized-ink" ? /actual ink exceeds/ : /locality/,
        );
    } finally {
      spy.mockRestore();
      await source.dispose();
    }
  },
);
it("uses the widest three-digit token and all preselected appearances despite a fragment", async () => {
  const source = await offViewFixture();
  try {
    const f = navigationFixture(source.ir),
      d = structuredClone(f.drafts[1]!);
    d.navigationView = { key: "third", authoredOrder: 2 };
    d.content = d.content.replace(
      'data-navigation-view="second"',
      'data-navigation-view="third"',
    );
    f.drafts.push(d);
    f.sheets.push({
      ...f.sheets[1]!,
      number: 3,
      svg: f.sheets[1]!.svg.replace(
        'data-navigation-view="second"',
        'data-navigation-view="third"',
      ),
    });
    f.sheets[1] = {
      ...f.sheets[1]!,
      svg: f.sheets[1]!.svg.replace(
        'width="80" height="40" viewBox="0 0 40 20"',
        'width="60" height="40" viewBox="5 0 30 20"',
      ),
    };
    const r = finalizeNavigation(f.ir, f.drafts, f.sheets);
    if (!r.ok) throw Error(JSON.stringify(r.error));
    expect(r.value.navigation.reservations).toHaveLength(2);
    const literal = "K1: Repeat of 100.D1 (same function)",
      ink = printableTextMetrics(literal, 3.502);
    for (const reservation of r.value.navigation.reservations) {
      expect(reservation.maximumForms[0]).toBe("K1: Also shown 100.D1, 100.D1");
      expect(reservation.inkMm.w).toBeGreaterThanOrEqual(
        Math.max(ink.advance, ink.right) - Math.min(ink.left, 0) + 2,
      );
      expect(reservation.profileId).toBe("repeat-max-roles/2/2/1");
    }
  } finally {
    await source.dispose();
  }
});
it("keeps a clipped body with both terminals a fragment and locates its report row", async () => {
  const source = await offViewFixture();
  try {
    const f = navigationFixture(source.ir);
    f.sheets[1] = {
      ...f.sheets[1]!,
      svg: f.sheets[1]!.svg.replace(
        'width="80" height="40" viewBox="0 0 40 20"',
        'width="60" height="40" viewBox="5 0 30 20"',
      ),
    };
    f.drafts[1]!.references = [
      {
        deviceUid: f.drafts[1]!.navigationSeeds![0]!.source.deviceUid,
        designation: "K1",
        functions: ["coil"],
        xMm: 0,
        yMm: 0,
        zone: "A1",
      },
    ];
    const r = finalizeNavigation(f.ir, f.drafts, f.sheets);
    if (!r.ok) throw Error(JSON.stringify(r.error));
    expect(r.value.navigation.occurrences[1]!.terminalKeys).toEqual([
      "A1",
      "A2",
    ]);
    expect(r.value.navigation.occurrences[1]!.role).toBe("boundary-fragment");
    expect(r.value.navigation.annotations).toEqual([]);
    centroidReferences(f.drafts, r.value.navigation.occurrences);
    expect(f.drafts[1]!.references![0]).toMatchObject({
      xMm: 40,
      yMm: 40,
      zone: "C3",
    });
  } finally {
    await source.dispose();
  }
});
it("keeps IDs unchanged when final layout moves a terminal centroid", async () => {
  const source = await offViewFixture();
  try {
    const f = navigationFixture(source.ir),
      before = finalizeNavigation(f.ir, f.drafts, f.sheets);
    if (!before.ok) throw Error(JSON.stringify(before.error));
    f.sheets[0] = {
      ...f.sheets[0]!,
      svg: f.sheets[0]!.svg.replace('<svg x="10"', '<svg x="14"'),
    };
    const after = finalizeNavigation(f.ir, f.drafts, f.sheets);
    if (!after.ok) throw Error(JSON.stringify(after.error));
    expect(after.value.navigation.occurrences[0]!.destination.anchorMm).toEqual(
      { x: 54, y: 40 },
    );
    expect(after.value.navigation.occurrences.map((o) => o.id)).toEqual(
      before.value.navigation.occurrences.map((o) => o.id),
    );
  } finally {
    await source.dispose();
  }
});
it("classifies against rounded fractional grid lines and exact half-way anchors", () => {
  expect(
    navigationZone(20, 20, { x: 0.003, y: 0.003, w: 120.02, h: 80.01 }),
  ).toBe("B2");
  const b = { x: 0, y: 0, w: 6.03, h: 4.02 };
  expect(navigationZone(1.004, 1.004, b)).toBe("A1");
  expect(navigationZone(1.005, 1.005, b)).toBe("B2");
  expect(roundNavigation(0.0000001)).toBe(0);
  expect(roundNavigation(1e-2)).toBe(0.01);
});

it("associates a sibling-layer device frame with its own symbol by UID, view and centroid", async () => {
  const source = await offViewFixture();
  try {
    const f = navigationFixture(source.ir);
    const uid = f.drafts[0]!.navigationSeeds![0]!.source.deviceUid;
    for (const [i, sheet] of f.sheets.entries()) {
      f.sheets[i] = {
        ...sheet,
        svg: sheet.svg.replace(
          /(<g data-navigation-view="[^"]+">)/,
          `$1<g data-device-uid="${uid}"><rect class="device-frame" x="10" y="20" width="80" height="40" fill="none" stroke="black"/></g>`,
        ),
      };
    }
    const r = finalizeNavigation(f.ir, f.drafts, f.sheets);
    if (!r.ok) throw Error(JSON.stringify(r.error));
    expect(r.value.navigation.annotations.map((a) => a.text)).toEqual([
      "K1: Also shown 02.C3",
      "K1: Repeat of 01.C3 (same function)",
    ]);
    for (const a of r.value.navigation.annotations) {
      expect(a.locality!.mode).toBe("local");
      expect(a.locality!.frameMm).toEqual({ x: 10, y: 20, w: 80, h: 40 });
    }
  } finally {
    await source.dispose();
  }
});
