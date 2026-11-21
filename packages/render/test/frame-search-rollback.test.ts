import { expect, it } from "vitest";
import { sideCandidate, sidePage } from "./helpers/side-candidate.js";
import {
  beginFramePlanning,
  compactPlanningReceipts,
  recordFrameAttempt,
  rollbackFrameSearch,
} from "../src/packet/frame-budget.js";

it("rolls back appended receipt work, weak identities and ordinals before legacy fallback", async () => {
  const page = { ...sidePage },
    original = sideCandidate(1);
  beginFramePlanning(page, original);
  const second = structuredClone(original),
    third = structuredClone(original);
  const record = (c: typeof original) =>
    recordFrameAttempt(
      page,
      c.prepared,
      c.profile,
      c.bank,
      c.grid,
      undefined,
      c.scale,
      c.drafts.map((d) => d.drawingBounds!),
    );
  record(original);
  const before = compactPlanningReceipts(page),
    error = new Error("abort capped search");
  await expect(
    rollbackFrameSearch(page, async () => {
      record(second);
      record(third);
      throw error;
    }),
  ).rejects.toBe(error);
  expect(compactPlanningReceipts(page)).toEqual(before);
  record(third);
  record(second);
  expect(
    compactPlanningReceipts(page)[0]!.candidates.map(
      (c) => JSON.parse(c.id)[0],
    ),
  ).toEqual([0, 1, 2]);
  const count = compactPlanningReceipts(page)[0]!.candidates.length;
  record(second);
  expect(compactPlanningReceipts(page)[0]!.candidates.length).toBe(count);
});
it("keeps successful receipt work and never absorbs a search error", async () => {
  const page = { ...sidePage },
    c = sideCandidate(1);
  beginFramePlanning(page, c);
  expect(
    await rollbackFrameSearch(page, async () => {
      recordFrameAttempt(
        page,
        c.prepared,
        undefined,
        c.bank,
        c.grid,
        undefined,
        c.scale,
        c.drafts.map((d) => d.drawingBounds!),
      );
      return "selected";
    }),
  ).toBe("selected");
  expect(compactPlanningReceipts(page)[0]!.candidates).toHaveLength(1);
});
