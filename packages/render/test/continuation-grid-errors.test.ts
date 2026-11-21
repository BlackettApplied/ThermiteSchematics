import { expect, it } from "vitest";
import type { PreparedSchematicDrawing } from "../src/renderer.js";
import { rootedBankGrids } from "../src/packet/rooted-bank-grids.js";

const bank = {
  width: 18,
  headerWidth: 18,
  single: false,
  left: 0,
  right: 0,
  top: 0,
  bottom: 0,
};
const fixture = (end = 976) =>
  ({
    graph: {
      edges: [
        {
          id: "bad-wire",
          elementIds: [{ kind: "wire", uid: "source-uid" }],
          conductor: { kind: "wire", uid: "source-uid", designation: "W-BAD" },
          label: {
            text: "",
            textSources: [{ field: "wire.properties.label", value: "" }],
          },
        },
      ],
    },
    layout: {
      width: 976,
      height: 100,
      nodes: [
        { id: "device", kind: "device", x: 170, y: 0, width: 800, height: 20 },
      ],
      labels: [],
      edges: [
        {
          id: "bad-wire",
          netId: "N",
          points: [
            { x: 0, y: 40 },
            { x: end, y: 40 },
          ],
        },
      ],
    },
  }) as unknown as PreparedSchematicDrawing;

it("retains an identity refusal from a complete fallback grid when greedy cannot cut", () => {
  const result = rootedBankGrids(
    fixture(),
    { x: 28, y: 47, w: 223.4, h: 200 },
    0.25,
    [bank],
    false,
  );
  expect(result.grids).toEqual([]);
  expect(result.cutFailure).toMatchObject({
    code: "R006",
    details: { continuationIdentity: "bad-wire" },
  });
  expect(result.cutFailure?.message).toContain("A candidate cut crosses");
  expect(result.cutFailure?.message).toContain("W-BAD");
  expect(result.cutFailure?.message).toContain("whitespace-only");
});

it("keeps an impossible protected-span refusal grid-dependent despite a bad uncut label", () => {
  const result = rootedBankGrids(
    fixture(20),
    { x: 28, y: 47, w: 100, h: 200 },
    0.25,
    [bank],
    false,
  );
  expect(result.grids).toEqual([]);
  expect(result.cutFailure).toBeUndefined();
});

it("does not let rejected cuts override grids that avoid a bad identity", () => {
  const result = rootedBankGrids(
    fixture(20),
    { x: 28, y: 47, w: 223.4, h: 200 },
    0.25,
    [bank],
    true,
  );
  expect(result.grids.length).toBeGreaterThan(0);
  expect(result.cutFailure).toBeUndefined();
});
