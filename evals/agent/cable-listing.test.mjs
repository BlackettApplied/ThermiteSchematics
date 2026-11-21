import { expect, it } from "vitest";
import { cableListingMatches } from "./cable-listing.mjs";
const objects = [
  { kind: "cable", uid: "a", designation: "CB1" },
  { kind: "cable", uid: "b", designation: "CBL1" },
  { kind: "device", uid: "d", designation: "D1" },
];
const fresh = {
  format: "cable-schedule/0.1",
  cableUid: "b",
  designation: "CBL1",
  cores: [{ id: "1", usage: "active" }],
  counts: { cores: 1 },
};
it("validates the requested cable even when another cable appears first", () => {
  const requested = [];
  expect(
    cableListingMatches({ ...fresh }, objects, (tag) => {
      requested.push(tag);
      return fresh;
    }),
  ).toBe(true);
  expect(requested).toEqual(["CBL1"]);
});
it("rejects forged identity, unlisted/non-cables and stale or extra report data", () => {
  for (const listing of [
    null,
    {},
    [],
    { ...fresh, cableUid: "a" },
    { ...fresh, designation: "OTHER" },
    { ...fresh, designation: "D1", cableUid: "d" },
    { ...fresh, counts: { cores: 2 } },
    { ...fresh, extra: "invented" },
  ])
    expect(
      cableListingMatches(listing, objects, () => fresh),
      JSON.stringify(listing),
    ).toBe(false);
});
