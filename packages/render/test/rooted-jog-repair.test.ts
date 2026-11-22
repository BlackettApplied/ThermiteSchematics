import { afterEach, expect, it, vi } from "vitest";
import type { ElectricalIr } from "@thermite/compiler";
import { repairRootedJogs } from "../src/packet/rooted-jog-repair.js";
import {
  MAX_PLACEMENT_LAYOUTS,
  type RootedSearch,
} from "../src/packet/rooted-search.js";
import { STANDARD_ECONOMY_ATTEMPTS } from "../src/packet/rooted-economy.js";
import * as prepared from "../src/off-view/prepared.js";
import * as build from "../src/packet/rooted-build.js";
import * as compose from "../src/packet/rooted-compose.js";
import * as fit from "../src/packet/composition-fit.js";
import * as score from "../src/packet/rooted-score.js";
import { sideCandidate, sidePage } from "./helpers/side-candidate.js";
import { required } from "../src/presentation/util.js";

const ir = {} as ElectricalIr;
afterEach(() => vi.restoreAllMocks());
function fixture() {
  const original = sideCandidate(1);
  original.prepared = {
    ...original.prepared,
    view: { ...original.prepared.view, family: "power" },
  };
  original.jogs = new Map([["wire", 1]]);
  original.prepared.layout.edges[0]!.points = [
    { x: 100, y: 60 },
    { x: 150, y: 60 },
    { x: 150, y: 68 },
    { x: 170, y: 68 },
  ];
  const candidate = structuredClone(original);
  candidate.jogs = new Map();
  candidate.prepared.layout.edges[0]!.points = [
    { x: 100, y: 60 },
    { x: 170, y: 60 },
    { x: 170, y: 68 },
  ];
  const run = { attempts: 0 } as RootedSearch;
  const layout = vi
    .spyOn(prepared, "repositionDrawing")
    .mockResolvedValue({ ok: true, value: candidate.prepared });
  vi.spyOn(build, "buildRootedCandidates").mockReturnValue({
    ok: true,
    value: [candidate],
  });
  vi.spyOn(build, "materializeRootedCandidate").mockImplementation(
    (_ir, c) => ({
      ok: true,
      value: c.drafts,
    }),
  );
  const check = vi.spyOn(fit, "compositionFits").mockReturnValue(true);
  vi.spyOn(compose, "composeRootedWinner").mockImplementation((_ir, c) => c);
  return { original, candidate, run, layout, check };
}
it("does not dispatch a retry for a printed turn inside CHECK's numerical band", async () => {
  const { original, run, layout } = fixture();
  const edge = required(original.prepared.layout.edges[0], "Fixture route");
  const dy = 2.999999 / original.scale;
  const points = [
    { x: 100, y: 60 },
    { x: 150, y: 60 },
    { x: 150, y: 60 + dy },
    { x: 170, y: 60 + dy },
  ];
  original.prepared = {
    ...original.prepared,
    layout: {
      ...original.prepared.layout,
      edges: original.prepared.layout.edges.map((e) =>
        e === edge ? { ...e, points } : e,
      ),
    },
  };
  expect(await repairRootedJogs(ir, original, original, sidePage, run)).toBe(
    original,
  );
  expect(layout).not.toHaveBeenCalled();
  expect(run.attempts).toBe(0);
});
it("charges the retry to the existing budget and keeps the source drawing immutable", async () => {
  const { original, candidate, run, layout } = fixture(),
    before = structuredClone(original);
  expect(
    await repairRootedJogs(ir, original, original, sidePage, run, 42),
  ).toBe(candidate);
  expect(run.attempts).toBe(1);
  expect(layout).toHaveBeenCalledTimes(1);
  expect(build.buildRootedCandidates).toHaveBeenCalledWith(
    ir,
    candidate.prepared,
    sidePage,
    undefined,
    false,
    false,
    42,
  );
  expect(original).toEqual(before);
});
it.each(["placement", "economy"])(
  "does not extend the %s budget",
  async (budget) => {
    const { original, run, layout } = fixture();
    run.attempts =
      budget === "placement"
        ? MAX_PLACEMENT_LAYOUTS
        : STANDARD_ECONOMY_ATTEMPTS;
    if (budget === "economy") run.economyStartedAt = 0;
    expect(await repairRootedJogs(ir, original, original, sidePage, run)).toBe(
      original,
    );
    expect(layout).not.toHaveBeenCalled();
  },
);
it.each(["pages", "composed-pages", "sparse", "worse-jog", "fit", "gang"])(
  "retains the original on a %s regression",
  async (failure) => {
    const { original, candidate, run, layout, check } = fixture();
    if (failure === "pages")
      candidate.drafts.push(structuredClone(candidate.drafts[0]!));
    if (failure === "worse-jog")
      candidate.prepared.layout.edges[0]!.points = [
        { x: 100, y: 60 },
        { x: 150, y: 60 },
        { x: 150, y: 64 },
        { x: 170, y: 64 },
      ];
    if (failure === "composed-pages")
      vi.mocked(compose.composeRootedWinner).mockImplementation((_ir, c) =>
        c.prepared === candidate.prepared
          ? { ...c, drafts: [...c.drafts, ...c.drafts] }
          : c,
      );
    if (failure === "fit") check.mockReturnValue(false);
    if (failure === "sparse") {
      run.standardEconomy = false;
      vi.spyOn(score, "candidateUtilisation").mockImplementation((c) =>
        c.prepared === original.prepared ? 0.5 : 0.399999,
      );
    }
    if (failure === "gang")
      layout.mockResolvedValue({
        ok: false,
        error: {
          code: "R006",
          root: "fixture",
          reason: "unprintable-layout",
          message: "Mechanical gang cannot paint all links",
        },
      });
    expect(await repairRootedJogs(ir, original, original, sidePage, run)).toBe(
      original,
    );
    expect(run.attempts).toBe(1);
  },
);

it("does not spend a layout on an internal jog outside the printed fragment", async () => {
  const { original, run, layout } = fixture();
  original.drafts[0]!.rootedSections![0]!.viewport = {
    x: 90,
    y: 50,
    w: 55,
    h: 50,
  };
  expect(await repairRootedJogs(ir, original, original, sidePage, run)).toBe(
    original,
  );
  expect(layout).not.toHaveBeenCalled();
  expect(run.attempts).toBe(0);
});

it("requires the printed short turn to improve even if the internal count falls", async () => {
  const { original, candidate, run } = fixture();
  candidate.prepared.layout.edges[0]!.points = structuredClone(
    original.prepared.layout.edges[0]!.points,
  );
  expect(await repairRootedJogs(ir, original, original, sidePage, run)).toBe(
    original,
  );
});

it.each([true, false])(
  "keeps min(40%%, base) utilisation in standard economy=%s",
  async (standardEconomy) => {
    for (const [base, next, accepted] of [
      [0.6, 0.399999, false],
      [0.6, 0.4, true],
      [0.3, 0.299999, false],
      [0.3, 0.3, true],
    ] as const) {
      const { original, candidate, run } = fixture();
      run.standardEconomy = standardEconomy;
      vi.spyOn(score, "candidateUtilisation").mockImplementation((c) =>
        c.prepared === original.prepared ? base : next,
      );
      expect(
        await repairRootedJogs(ir, original, original, sidePage, run),
      ).toBe(accepted ? candidate : original);
      vi.restoreAllMocks();
    }
  },
);
