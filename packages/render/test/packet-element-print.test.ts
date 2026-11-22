import { expect, it } from "vitest";
import { searchNavigationSlot } from "../src/packet/navigation-slot-search.js";
import { navigationPlacementInk } from "../src/packet/navigation-placement.js";
import { printedElementInk } from "./packet-element-print-fixture.js";
import { roomiestElementSlot } from "../src/packet/navigation-element-room.js";
import { measureNavigationText } from "../src/packet/navigation-labels.js";

it("prefers the legal slot with more spare room over the first tight slot", () => {
  const tight = { x: 10, y: 7, w: 20, h: 4 };
  const roomy = { x: 30, y: 30, w: 20, h: 4 };
  expect(
    roomiestElementSlot(
      [tight, roomy],
      { x: 0, y: 0, w: 100, h: 60 },
      [],
      [{ x: 0, y: 0, w: 100, h: 3 }],
    ),
  ).toEqual(roomy);
});

it("keeps vertically stacked element ink 4 mm clear of continuation text", () => {
  const area = { x: 0, y: 0, w: 24, h: 30 };
  const ink = { x: 1, y: 1, w: 16, h: 4 };
  const other = { x: 0, y: 10, w: 24, h: 4 };
  const result = searchNavigationSlot(
    [
      {
        id: "local",
        mode: "local",
        inkMm: { x: 0, y: 0, w: 20, h: 8 },
        maximumForms: ["literal"],
        wrapWidthMm: 18,
      },
    ],
    area,
    { x: 4, y: 15.5, w: 16, h: 4 },
    [other],
    undefined,
    [other],
    false,
    undefined,
    new Map([["local", ink]]),
    true,
  );
  expect(result).toBeDefined();
  if (!result) throw Error("Missing print-clear slot");
  const printed = navigationPlacementInk(result.box, ink);
  expect(
    Math.max(other.y - printed.y - printed.h, printed.y - other.y - other.h),
  ).toBeGreaterThanOrEqual(4);
  expect(
    searchNavigationSlot(
      [
        {
          id: "local",
          mode: "local",
          inkMm: { x: 0, y: 0, w: 20, h: 8 },
          maximumForms: ["literal"],
          wrapWidthMm: 18,
        },
      ],
      { ...area, h: 14 },
      { x: 4, y: 7.5, w: 16, h: 4 },
      [{ ...other, y: 2 }],
      undefined,
      [{ ...other, y: 2 }],
      false,
      undefined,
      new Map([["local", ink]]),
      true,
    ),
  ).toBeUndefined();
});

it("measures the wrapped printed lines rather than the unwrapped semantic locator", () => {
  const printed = printedElementInk(
    '<svg><g data-navigation-annotation="wrapped"><text>OL1: NC contact</text><text>95–96 → 03.B2</text></g></svg>',
    "wrapped",
    { x: 0, y: 0 },
  );
  expect(printed.lines).toEqual(["OL1: NC contact", "95–96 → 03.B2"]);
  expect(printed.ink.h).toBeGreaterThan(4.8);
  expect(printed.ink.w).toBeLessThan(
    measureNavigationText("OL1: NC contact 95–96 → 03.B2"),
  );
});
