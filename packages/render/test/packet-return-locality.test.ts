import { expect, it } from "vitest";
import { resolveReturnLocality } from "../src/packet/return-locality.js";
import type {
  AnnotationReservation,
  NavigationAnnotation,
  PlacedOccurrence,
} from "../src/packet/navigation-types.js";
const annotation: NavigationAnnotation = {
  id: "return",
  ownerOccurrence: "contact",
  ownerOccurrences: ["contact"],
  role: "return",
  targets: [],
  text: "K1 /02.C2",
  primitiveIds: [],
  reservationId: "slot",
};
const slot: AnnotationReservation = {
  id: "slot",
  ownerOccurrence: "contact",
  ownerAppearance: "native",
  profileId: "literal",
  space: "sheet-slot",
  inkMm: { x: 0, y: 0, w: 55, h: 6 },
  maximumForms: ["K1 /100.D6"],
  allocatedMm: { sheet: 1, rect: { x: 100, y: 100, w: 55, h: 6 } },
};
const owner = (sheet = 1, x = 0) =>
  ({
    id: "contact",
    destination: { sheet, zone: "A1", anchorMm: { x, y: 100 } },
  }) as PlacedOccurrence;
it("records literal contact-owner distances without imposing the mirror threshold", () => {
  expect(
    resolveReturnLocality(annotation, slot, [owner()]).returnLocality,
  ).toEqual({
    sheet: 1,
    owners: [
      { occurrenceId: "contact", anchorMm: { x: 0, y: 100 }, distanceMm: 100 },
    ],
  });
});
it.each(["foreign-sheet", "non-finite", "missing-owner"])(
  "rejects a %s return owner",
  (kind) => {
    const owners =
      kind === "missing-owner"
        ? []
        : [
            owner(
              kind === "foreign-sheet" ? 2 : 1,
              kind === "non-finite" ? NaN : 0,
            ),
          ];
    expect(() => resolveReturnLocality(annotation, slot, owners)).toThrow(
      /Return locality|return contact owner/,
    );
  },
);

it("requires the primary owner among the measured contacts", () => {
  expect(() =>
    resolveReturnLocality({ ...annotation, ownerOccurrences: [] }, slot, [
      owner(),
    ]),
  ).toThrow(/primary contact owner/);
  expect(() =>
    resolveReturnLocality({ ...annotation, ownerOccurrence: "foreign" }, slot, [
      owner(),
    ]),
  ).toThrow(/primary contact owner/);
});
