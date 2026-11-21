import { expect, it } from "vitest";
import { offViewFixture } from "./off-view-fixtures.js";
import { appearanceFixture } from "./packet-navigation-appearance-fixture.js";
import { placeOccurrences } from "../src/packet/navigation-occurrences.js";
import {
  symbolGeometry,
  localNavigationSlot,
} from "../src/packet/navigation-symbols.js";
import {
  allocateNavigationSlots,
  type SheetSlotRequest,
} from "../src/packet/navigation-slots.js";
import { printableTextMetrics } from "../src/text-metrics.js";

it.each(["device-id", "view", "smallest"])(
  "matches the owning frame by %s with literal competing geometry",
  async (kind) => {
    const source = await offViewFixture();
    try {
      const f = appearanceFixture(source.ir),
        uid = f.drafts[0]!.navigationSeeds![0]!.source.deviceUid;
      const otherUid = source.ir.devices.find(
        (d) => d.designation === "H1",
      )!.uid;
      const frame =
        kind === "smallest"
          ? '<rect class="device-frame" x="40" y="10" width="100" height="130"/>'
          : '<rect class="device-frame" x="55" y="60" width="10" height="10"/>';
      f.sheets[0]!.svg = f.sheets[0]!.svg.replace(
        "</svg>",
        `<g data-navigation-view="${kind === "view" ? "unselected" : "first"}"><g data-device-uid="${kind === "device-id" ? otherUid : uid}">${frame}</g></g></svg>`,
      );
      const occurrences = placeOccurrences(f.ir, f.drafts, f.sheets),
        owner = occurrences[0]!;
      const actual = symbolGeometry(
        owner,
        occurrences,
        f.sheets[0]!.svg,
        f.drafts[0]!.drawingBounds!,
      );
      expect(actual.anchorMm).toEqual({ x: 60, y: 65 });
      expect(actual.frameMm).toEqual({ x: 45, y: 15, w: 30, h: 100 });
    } finally {
      await source.dispose();
    }
  },
);
it.each(["function", "terminal"])(
  "anchors all distinct appearance terminals including an unrepeated %s glyph",
  async (representation) => {
    const source = await offViewFixture();
    try {
      const poles = ["pole1", "pole2", "pole3"].map((key, i) => ({
        key,
        x: 50,
        y: 20 + i * 40,
      }));
      const f = appearanceFixture(source.ir, [
        [...poles, { key: "coil", x: 100, y: 120 }],
        poles,
      ]);
      f.drafts[0]!.navigationSeeds![3]!.representation = representation;
      const all = placeOccurrences(f.ir, f.drafts, f.sheets);
      const g = symbolGeometry(
        all[0]!,
        all,
        f.sheets[0]!.svg,
        f.drafts[0]!.drawingBounds!,
      );
      // Six pole terminals average (60,65); two coil terminals average (110,125).
      expect(g.anchorMm).toEqual({ x: 72.5, y: 80 });
      expect(g.ownerLocation).toEqual({ sheet: 1, zone: "C2" });
    } finally {
      await source.dispose();
    }
  },
);
const request = (): SheetSlotRequest => ({
  owner: { x: 0, y: 0, w: 200, h: 20 },
  locality: {
    anchorMm: { x: 10, y: 10 },
    frameMm: { x: 0, y: 0, w: 200, h: 20 },
    framesMm: [],
    ownerLocation: { sheet: 1, zone: "A1" },
  },
  reservation: {
    id: "literal",
    ownerAppearance: "literal",
    ownerOccurrence: "literal",
    profileId: "literal",
    space: "sheet-slot",
    inkMm: { x: 0, y: 0, w: 20, h: 6 },
    maximumForms: ["literal"],
  },
});
it("measures the 60 mm band from the terminal centroid rather than a long frame", () => {
  const r = request(),
    g = r.locality!;
  expect(localNavigationSlot({ x: 70, y: 10, w: 20, h: 6 }, g)).toBe(true);
  expect(localNavigationSlot({ x: 70.001, y: 10, w: 20, h: 6 }, g)).toBe(false);
  const result = allocateNavigationSlots(
    [r],
    { x: 180, y: 30, w: 20, h: 10 },
    '<svg viewBox="0 0 240 160"><rect class="device-frame" x="0" y="0" width="200" height="20"/></svg>',
    1,
  )[0]!;
  expect(result.allocatedMm!.placement).toBe("self-located");
  expect(result.allocatedMm!.rect).toEqual({ x: 180, y: 30, w: 20, h: 6 });
});
it("keeps four millimetres horizontally from overlapping native text bands", () => {
  const r = request();
  r.locality = undefined;
  r.owner = { x: 0, y: 14, w: 20, h: 6 };
  const svg =
    '<svg viewBox="0 0 120 40"><text x="0" y="18" font-size="4">HEADER</text></svg>';
  const box = allocateNavigationSlots(
    [r],
    { x: 0, y: 14, w: 120, h: 6 },
    svg,
    1,
  )[0]!.allocatedMm!.rect;
  const right = printableTextMetrics("HEADER", 4, false, true).right;
  expect(box.y).toBe(14);
  expect(box.x - right).toBeGreaterThanOrEqual(4);
  expect(box.x - right).toBeLessThan(4.03);
});
it("retains normal vertical clearance when native text bands do not overlap", () => {
  const r = request();
  r.locality = undefined;
  r.owner = { x: 0, y: 14, w: 20, h: 6 };
  const box = allocateNavigationSlots(
    [r],
    { x: 0, y: 14, w: 120, h: 6 },
    '<svg viewBox="0 0 120 40"><text x="0" y="5" font-size="4">HEADER</text></svg>',
    1,
  )[0]!.allocatedMm!.rect;
  expect(box).toEqual({ x: 0, y: 14, w: 20, h: 6 });
});
it("keeps four millimetres horizontally between allocated label envelopes", () => {
  const r = request();
  r.locality = undefined;
  r.owner = { x: 0, y: 14, w: 20, h: 6 };
  const second = structuredClone(r);
  second.reservation.id = "second";
  const slots = allocateNavigationSlots(
    [r, second],
    { x: 0, y: 14, w: 120, h: 6 },
    '<svg viewBox="0 0 120 40"/>',
    1,
  );
  expect(slots[0]!.allocatedMm!.rect.x).toBe(0);
  expect(slots[1]!.allocatedMm!.rect.x).toBeGreaterThanOrEqual(24);
});

import { repeatNoun } from "../src/packet/navigation-labels.js";
it("counts distinct source functions rather than repeated glyph occurrences in a qualifier", async () => {
  const source = await offViewFixture();
  try {
    const f = appearanceFixture(source.ir, [
      [{ key: "coil", x: 50, y: 20 }],
      [{ key: "coil", x: 50, y: 20 }],
    ]);
    const all = placeOccurrences(f.ir, f.drafts, f.sheets);
    expect(repeatNoun(f.ir, all)).toBe("function");
  } finally {
    await source.dispose();
  }
});
