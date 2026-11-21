import { afterEach, expect, it, vi } from "vitest";
import type { ElectricalIr } from "@thermite/compiler";
import * as renderer from "../src/renderer.js";
import * as prepared from "../src/off-view/prepared.js";
import * as build from "../src/packet/rooted-build.js";
import * as settled from "../src/packet/rooted-settled.js";
import * as economy from "../src/packet/rooted-economy.js";
import * as constraint from "../src/packet/rooted-constraint.js";
import * as placement from "../src/packet/rooted-placements.js";
import * as retry from "../src/packet/rooted-jog-repair.js";
import { searchRootedCandidates } from "../src/packet/rooted-search.js";
import {
  chargeElkWork,
  elkWorkScope,
  elkWorkTrace,
} from "../src/layout/elk-work.js";
import {
  beginFramePlanning,
  recordFrameAttempt,
  compactPlanningReceipts,
} from "../src/packet/frame-budget.js";
import { sideCandidate, sidePage } from "./helpers/side-candidate.js";
import { required } from "../src/presentation/util.js";

const ir = {} as ElectricalIr;
afterEach(() => vi.restoreAllMocks());
function fixture(flow: "left-to-right" | "top-to-bottom") {
  const candidate = sideCandidate(1),
    page = { ...sidePage };
  candidate.printableDrafts = candidate.drafts;
  candidate.prepared.view = {
    ...candidate.prepared.view,
    family: "power",
    flow,
  };
  vi.spyOn(renderer, "prepareSchematicDrawing").mockImplementation(async () => {
    chargeElkWork();
    return { ok: true, value: candidate.prepared };
  });
  vi.spyOn(prepared, "nativeDrawing").mockImplementation(async () => {
    chargeElkWork();
    return { ok: true, value: candidate.prepared };
  });
  vi.spyOn(build, "buildRootedCandidates").mockReturnValue({
    ok: true,
    value: [candidate],
  });
  vi.spyOn(constraint, "invariantCardConstraint").mockReturnValue(undefined);
  vi.spyOn(economy, "validateEconomyCandidate").mockReturnValue(undefined);
  vi.spyOn(settled, "searchSettled").mockReturnValue(false);
  const placements = vi
    .spyOn(placement, "placements")
    .mockResolvedValue(undefined);
  const repair = vi
    .spyOn(retry, "repairSearchJogs")
    .mockResolvedValue(undefined);
  const search = (compact = false) =>
    searchRootedCandidates(
      ir,
      {
        format: "schematic-view-request/0.1",
        family: "power",
        flow,
        root: { by: "designation", value: "M1" },
      },
      undefined,
      page,
      compact,
    );
  return { candidate, placements, repair, search, page };
}
it.each([47, 48])(
  "TTB retry bypasses the new ledger after %i requests, including adapter alternatives",
  async (count) => {
    const f = fixture("top-to-bottom"),
      ledgers: NonNullable<Parameters<typeof elkWorkTrace.run>[0]> = [];
    if (count === 47) {
      f.candidate.jogs.set("wire", 1);
      const edge = required(
        f.candidate.prepared.layout.edges[0],
        "Fixture route",
      );
      const points = [
        { x: 100, y: 60 },
        { x: 150, y: 60 },
        { x: 150, y: 68 },
        { x: 170, y: 68 },
      ];
      f.candidate.prepared = {
        ...f.candidate.prepared,
        layout: {
          ...f.candidate.prepared.layout,
          edges: f.candidate.prepared.layout.edges.map((e) =>
            e === edge ? { ...e, points } : e,
          ),
        },
      };
    }
    f.placements.mockImplementation(
      async (_ir, _request, _presentation, _page, run) => {
        expect(!!run.jogRetryReserved).toBe(count === 47);
        for (let i = 2; i < count; i++) chargeElkWork();
        if (count === 48) f.candidate.jogs.set("wire", 1);
        run.attempts = 43;
      },
    );
    f.repair.mockImplementation(async () => {
      chargeElkWork();
      chargeElkWork();
    });
    const run = await elkWorkTrace.run(ledgers, () => f.search());
    expect(run.candidates).toEqual([f.candidate]);
    expect(run.elkWork).toBeUndefined();
    expect(ledgers).toEqual([]);
    expect(f.repair).toHaveBeenCalledTimes(1);
  },
);
it.each(["initial", "placements", "retry"] as const)(
  "LTR exhaustion at %s retains the exact legacy search without escaping",
  async (boundary) => {
    const f = fixture("left-to-right");
    const consume = async () => {
      for (let i = 0; i < 49; i++) chargeElkWork();
    };
    if (boundary === "initial")
      vi.mocked(renderer.prepareSchematicDrawing).mockImplementation(
        async () => {
          await consume();
          return { ok: true, value: f.candidate.prepared };
        },
      );
    if (boundary === "placements") f.placements.mockImplementation(consume);
    if (boundary === "retry") f.repair.mockImplementation(consume);
    const run = await f.search();
    expect(run.candidates).toEqual([f.candidate]);
    expect(run.elkWork?.calls).toBeLessThanOrEqual(48);
    expect(
      (run.elkWork as { exhausted?: boolean } | undefined)?.exhausted,
    ).toBe(true);
  },
);
it("three compact profiles with sixteen recoveries each keep the legacy result before placements", async () => {
  const f = fixture("left-to-right");
  vi.mocked(renderer.prepareSchematicDrawing).mockImplementation(async () => {
    for (let i = 0; i < 17; i++) chargeElkWork();
    return { ok: true, value: f.candidate.prepared };
  });
  const run = await f.search(true);
  expect(run.prepared).toHaveLength(3);
  expect(run.elkWork?.calls).toBe(48);
  expect((run.elkWork as { exhausted?: boolean } | undefined)?.exhausted).toBe(
    true,
  );
  expect(f.placements).toHaveBeenCalledTimes(1);
  expect(elkWorkScope.getStore()).toBeUndefined();
});

it("discards capped frame receipts before the legacy result is rebuilt", async () => {
  const f = fixture("left-to-right");
  beginFramePlanning(f.page, f.candidate);
  vi.mocked(renderer.prepareSchematicDrawing).mockImplementation(async () => {
    const c = elkWorkScope.getStore()
      ? structuredClone(f.candidate)
      : f.candidate;
    recordFrameAttempt(
      f.page,
      c.prepared,
      undefined,
      c.bank,
      c.grid,
      undefined,
      c.scale,
      c.drafts.map((d) => d.drawingBounds!),
    );
    for (let i = 0; i < 49; i++) chargeElkWork();
    return { ok: true, value: f.candidate.prepared };
  });
  await f.search();
  const attempts = compactPlanningReceipts(f.page)[0]!.candidates;
  expect(attempts).toHaveLength(1);
  expect(JSON.parse(attempts[0]!.id)[0]).toBe(0);
});
