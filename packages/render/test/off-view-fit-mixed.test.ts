import { expect, it } from "vitest";
import { compileProject } from "@thermite/compiler";
import {
  searchRootedCandidates,
  rootedWinner,
  MAX_PLACEMENT_LAYOUTS,
  type RootedSearch,
} from "../src/packet/rooted-search.js";
import {
  mixedPlacements,
  MAX_MIXED_LAYOUTS,
} from "../src/packet/rooted-mixed.js";

const page = {
  size: "tabloid" as const,
  orientation: "landscape" as const,
  widthMm: 431.8,
  heightMm: 279.4,
  marginMm: 10,
};

it("accepts conveyor M2’s guarded first placement without exhaustive optimisation", async () => {
  const c = await compileProject("examples/conveyor-line");
  if (!c.ok) throw Error("Compile failed");
  const run = await searchRootedCandidates(
    c.ir,
    {
      format: "schematic-view-request/0.1",
      root: { by: "designation", value: "M2" },
      family: "power",
      flow: "left-to-right",
    },
    c.presentation,
    page,
    true,
  );
  const best = rootedWinner(run, page);
  if (!best) throw Error(JSON.stringify(run.errors));
  expect(run.attempts).toBeLessThanOrEqual(MAX_PLACEMENT_LAYOUTS);
  expect(run.earlyExit).toBe(true);
  expect(run.attempts).toBe(0);
  expect(best.drafts.length).toBeLessThanOrEqual(2);
  for (const draft of best.drafts) {
    expect(draft.rootedContent!.figures).toBeGreaterThan(0);
    const b = draft.drawingBounds!;
    for (const shape of draft.rootedShapes!) {
      expect(shape.x).toBeGreaterThanOrEqual(b.x - 0.001);
      expect(shape.x + shape.w).toBeLessThanOrEqual(b.x + b.w + 0.001);
    }
  }
}, 30000);

it("bounds mixed choices fairly, deterministically and to existing quadrants", async () => {
  async function probe() {
    const run = {
      attempts: 24,
      candidates: [],
      native: [],
      errors: [],
      tried: new Set(),
      prepared: [undefined, "compact", "dense"].map((profile) => ({
        profile,
        p: {
          graph: {
            nodes: [
              {
                kind: "rail",
                deviceUid: "source",
                labels: ["L1", "L2", "L3", "PE"].map((id) => ({
                  id,
                  offView: { placementRank: 0 },
                })),
              },
            ],
          },
        },
      })),
    } as unknown as RootedSearch;
    const choices: unknown[] = [];
    await mixedPlacements(run, page, new Map(), async (profile, value) => {
      expect(Object.values(value).every((v) => v >= -4 && v <= -1)).toBe(true);
      choices.push([profile, value]);
      run.attempts++;
    });
    expect(run.attempts - 24).toBeLessThanOrEqual(MAX_MIXED_LAYOUTS);
    for (const profile of [undefined, "compact", "dense"])
      expect(
        choices.filter((v) => (v as unknown[])[0] === profile),
      ).toHaveLength(8);
    return choices;
  }
  expect(await probe()).toEqual(await probe());
});
