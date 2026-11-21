import { expect, it } from "vitest";
import type { RenderFailure } from "../src/types.js";
import { legendBoundFailure } from "../src/packet/legend-bound-failure.js";
import { safeAxisPlans } from "../src/packet/safe-cuts.js";
import { sideCandidate } from "./helpers/side-candidate.js";
import { legendCandidateLimited } from "../src/packet/device-legend.js";
import type { LegendSearchFailure } from "../src/packet/legend-pagination.js";
import { required } from "../src/presentation/util.js";

const tail: RenderFailure = {
  code: "R006",
  root: "fixture",
  reason: "unprintable-layout",
  message: "Synthetic final span cannot fit",
  details: {
    capacityKind: "free-region",
    legendEntries: [{ designation: "SYNTHETIC", kind: "body" }],
    requiredWidthMm: 20,
    requiredHeightMm: 10,
    availableWidthMm: 5,
    availableHeightMm: 5,
  },
};
const drafts = sideCandidate(1).drafts;
function failureDetails(failure: RenderFailure | undefined) {
  return failure?.code === "R006" ? failure.details : undefined;
}

it.each(["axis-plans", "gap-points", "cuts", "sheet-limit"] as const)(
  "names the observed %s cap without claiming an unproved page-cost exhaustion",
  (cap) => {
    const failure = legendBoundFailure(
      { tail: { start: 10, failure: tail }, stops: new Set([cap]) },
      drafts,
      "Synthetic view",
    );
    expect(failure?.message).not.toContain("packet page-cost bound");
    expect(failure?.message).toContain("recorded pruning at the ");
    expect(failure?.message).not.toContain("stopped at");
    expect(failureDetails(failure)?.constraint).toBe("legend-search-limit");
    expect(failureDetails(failure)?.searchCaps).toEqual([cap]);
    expect(failure?.message).toContain(
      cap === "sheet-limit"
        ? "100-sheet packet limit"
        : cap === "axis-plans"
          ? "6 retained axis plans"
          : cap === "gap-points"
            ? "256 gap points"
            : "40 cuts",
    );
  },
);
it("does not invent a cap when the finite protected-gap candidates simply fail", () => {
  const failure = legendBoundFailure(
    { tail: { start: 10, failure: tail } },
    drafts,
    "Synthetic view",
  );
  expect(failure?.message).toContain("feasible protected-gap candidates");
  expect(failure?.message).not.toContain("page-cost bound");
  expect(failureDetails(failure)?.constraint).toBe("legend-search-exhausted");
});
it("retains page-cost wording only with an observed bound failure", () => {
  const bound: RenderFailure = {
    ...tail,
    details: {
      constraint: "page-cost-bound",
      basePages: 1,
      candidatePages: 3,
      maximumPages: 2,
    },
  };
  const failure = legendBoundFailure(
    { tail: { start: 10, failure: tail }, bound },
    drafts,
    "Synthetic view",
  );
  expect(failure?.message).toContain(
    "exhausted the 2-sheet packet page-cost bound",
  );
  expect(failureDetails(failure)?.constraint).toBe("legend-pagination-bound");
});
it("does not treat an unrelated failure as page-cost proof", () => {
  const failure = legendBoundFailure(
    { tail: { start: 10, failure: tail }, bound: tail },
    drafts,
    "Synthetic view",
  );
  expect(failure?.message).not.toContain("page-cost bound");
  expect(failureDetails(failure)?.constraint).toBe("legend-search-exhausted");
});
it("records the actual 100-sheet stop independently of packet page cost", () => {
  const source = required(drafts[0], "Fixture draft");
  const large = Array.from({ length: 101 }, () => {
    const draft = structuredClone(source);
    delete draft.rootedFit;
    return draft;
  });
  const first = {
    ...required(large[0], "Fixture first draft"),
    rootedFit: { basePages: 51, actualPages: 101, context: "Synthetic limit" },
  };
  const failures: LegendSearchFailure = {};
  expect(legendCandidateLimited([first, ...large.slice(1)], failures)).toBe(
    true,
  );
  expect(failures.bound).toBeUndefined();
  const failure = legendBoundFailure(
    failures,
    [first, ...large.slice(1)],
    "Synthetic view",
    tail,
  );
  expect(failure?.message).toContain("100-sheet packet limit");
  expect(failure?.message).not.toContain("page-cost bound");
  expect(failureDetails(failure)?.sheet).toBe("unresolved");
});
it.each(["axis-plans", "gap-points", "cuts"] as const)(
  "records the actual %s search pruning without changing its bounds",
  (cap) => {
    const observed: string[] = [];
    const record = (value: string) => observed.push(value);
    if (cap === "cuts") safeAxisPlans(41, 1, [], () => true, undefined, record);
    if (cap === "gap-points")
      safeAxisPlans(
        1000,
        1000,
        Array.from({ length: 300 }, (_, i) => ({
          start: i * 3 + 1,
          end: i * 3 + 2,
        })),
        () => true,
        () => false,
        record,
      );
    if (cap === "axis-plans")
      safeAxisPlans(
        12,
        6,
        Array.from({ length: 5 }, (_, i) => ({
          start: i * 2 + 0.5,
          end: i * 2 + 0.6,
        })),
        () => true,
        () => true,
        record,
      );
    expect(observed).toContain(cap);
  },
);
