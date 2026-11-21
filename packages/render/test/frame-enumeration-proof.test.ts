import { beforeAll, expect, it } from "vitest";
import type { ElectricalIr } from "@thermite/compiler";
import { compileCoreFixture, required } from "./fixtures.js";
import { sideCandidate, sidePage } from "./helpers/side-candidate.js";
import { frameFoldCandidate } from "./helpers/frame-fold-candidate.js";
import {
  buildGridCandidates,
  buildRootedCandidates,
  rootedSpace,
  type RootedCandidate,
} from "../src/packet/rooted-build.js";
import {
  beginFramePlanning,
  candidateLosses,
  compactPlanningReceipts,
  frameBudgetFailure,
  frameBudgetOrder,
  recordFrameBanks,
  rollbackFrameSearch,
} from "../src/packet/frame-budget.js";
import {
  continuationBanks,
  bankBounds,
} from "../src/packet/continuation-bank.js";
import { continuationGridConstraint } from "../src/packet/continuation-constraint.js";
import { useCompactFrame } from "../src/packet/frame-profile.js";
import { resolveRootedContinuations } from "../src/packet/continuation-resolve.js";
import { continuationInk, cutGap } from "../src/packet/frame-banks.js";
import { MAX_FRAME_FOLD_PLANS } from "../src/packet/frame-fold-groups.js";
import { normalizePaperPage } from "../src/packet/page.js";
import { searchSettled } from "../src/packet/rooted-settled.js";
import {
  rootedWinner,
  type RootedSearch,
} from "../src/packet/rooted-search.js";
import { SECTION_GAP } from "../src/packet/fold-stack.js";
let ir: ElectricalIr;
beforeAll(async () => {
  ir = await compileCoreFixture();
});
function uncut() {
  const reference = sideCandidate(1),
    p = reference.prepared,
    page = { ...sidePage };
  p.graph.edges = [];
  p.layout.edges = [];
  useCompactFrame(page);
  const { b, scale } = rootedSpace(p, page, false);
  reference.scale = scale;
  required(reference.drafts[0]).drawingBounds = b;
  beginFramePlanning(page, reference);
  return { reference, p, page, b, scale };
}
it("stops grid work at the first zero-loss lower bound", () => {
  const { p, page } = uncut();
  const result = buildRootedCandidates(ir, p, page);
  expect(result.ok).toBe(true);
  if (!result.ok) throw Error(result.error.message);
  expect(result.value).toHaveLength(1);
  expect(candidateLosses(required(result.value[0]), page)).toEqual([0]);
  // One recorded grid/fold build, even though a second bank remains available.
  expect(required(compactPlanningReceipts(page)[0]).candidates).toHaveLength(1);
});
it("receipts count actual bank enumeration, including a cut-free two-bank layout", async () => {
  const { p, page, b, scale } = uncut();
  const banks = continuationBanks(p, b, scale, 0, true);
  expect(banks).toHaveLength(2);
  buildRootedCandidates(ir, p, page);
  expect(
    required(compactPlanningReceipts(page)[0]).candidateLimit.banksPerLayout,
  ).toBe(banks.length);
  const before = compactPlanningReceipts(page);
  await expect(
    rollbackFrameSearch(page, async () => {
      const cut = frameFoldCandidate();
      const larger = continuationBanks(cut.p, cut.b, cut.scale, 0, true);
      expect(larger).toHaveLength(6);
      recordFrameBanks(page, cut.p, larger);
      expect(
        required(compactPlanningReceipts(page)[0]).candidateLimit
          .banksPerLayout,
      ).toBe(6);
      throw Error("abandoned search");
    }),
  ).rejects.toThrow("abandoned search");
  expect(compactPlanningReceipts(page)).toEqual(before);
});
it("selects a non-greedy contiguous fold when the default loses 2.497 percent on one sheet", () => {
  const { reference, p, page, b, scale, bank, grid } = frameFoldCandidate();
  const constraint = continuationGridConstraint(
    p,
    [bankBounds(b, bank)],
    scale,
  );
  const result = buildGridCandidates(
    p,
    page,
    undefined,
    false,
    scale,
    b,
    [{ bank, grid }],
    constraint,
  );
  const chosen = required(
    [...result.candidates].sort((a, b) => frameBudgetOrder(a, b, page))[0],
  );
  expect(chosen.foldGroups).toEqual([[0], [1, 2]]);
  expect(chosen.drafts).toHaveLength(reference.drafts.length);
  expect(frameBudgetFailure(chosen, page)).toBeUndefined();
  expect(candidateLosses(chosen, page)).toEqual([0, 0]);
  const attempts = required(compactPlanningReceipts(page)[0]).candidates;
  expect(attempts).toHaveLength(3);
  expect(attempts.length).toBeLessThanOrEqual(MAX_FRAME_FOLD_PLANS);
  expect(attempts.map((a) => [a.groups, a.pages, a.failure ?? null])).toEqual([
    [[[0, 1], [2]], 2, null],
    [[[0], [1], [2]], 3, null],
    [[[0], [1, 2]], 2, null],
  ]);
  expect(required(attempts[0]).losses[0]).toBeCloseTo(2.4969679674680747, 10);
  expect(frameBudgetFailure(required(result.candidates[0]), page)).toBe(
    "drawing-field-loss",
  );
  resolveRootedContinuations(chosen.drafts, page);
  expect(
    chosen.drafts.reduce((n, d) => n + (d.rootedContent?.figures ?? 0), 0),
  ).toBe(3);
  expect(
    chosen.drafts
      .flatMap((d) => d.rootedSections ?? [])
      .map((s) => [s.viewport.x, s.viewport.w]),
  ).toEqual([
    [-20, 520],
    [500, 520],
    [1020, 500],
  ]);
  const links = chosen.drafts.flatMap((d) => d.links);
  expect(links.map((l) => [l.id, l.end, l.provenance])).toEqual([
    ["C001", 0, { kind: "wire", uid: "w1" }],
    ["C001", 1, { kind: "wire", uid: "w1" }],
    ["C002", 0, { kind: "wire", uid: "w1" }],
    ["C002", 1, { kind: "wire", uid: "w1" }],
  ]);
  expectNativeCuts(chosen);
});

function expectNativeCuts(candidate: RootedCandidate) {
  for (const d of candidate.drafts) {
    let offset = 0,
      linkIndex = 0;
    for (const [i, part] of (d.rootedParts ?? [d]).entries()) {
      const field = required(part.drawingBounds),
        viewport = required(part.rootedSections?.[0]).viewport;
      for (const source of part.links) {
        const link = required(d.links[linkIndex++]);
        const cutX =
          source.side === "left" ? viewport.x : viewport.x + viewport.w;
        expect(cutX).toBeGreaterThan(120);
        expect(cutX).toBeLessThan(1320);
        expect(link.x).toBeCloseTo(
          field.x + (cutX - viewport.x) * candidate.scale,
          8,
        );
        expect(link.y).toBeCloseTo(
          field.y + (200 - viewport.y) * candidate.scale + offset,
          8,
        );
        for (const ink of continuationInk(link, true))
          expect(cutGap(link, ink)).toBeGreaterThanOrEqual(3.15 - 1e-8);
      }
      offset += required(d.rootedPartSizes?.[i]) + SECTION_GAP;
    }
  }
}

function settlementCandidates() {
  const fold = frameFoldCandidate(),
    p = structuredClone(fold.p);
  const normalized = normalizePaperPage({
    size: "a4",
    orientation: "landscape",
  });
  if (!normalized.ok) throw Error(normalized.error.message);
  const page = normalized.value,
    scale = 0.25,
    grid = fold.grid;
  p.layout.nodes.forEach((node) => {
    node.height = 150;
  });
  useCompactFrame(page);
  const { b } = rootedSpace(p, page, false);
  const banks = continuationBanks(p, b, scale, 0, true);
  const zeroBank = required(banks[0]),
    positiveBank = required(banks[2]);
  const constraint = continuationGridConstraint(
    p,
    banks.map((bank) => bankBounds(b, bank)),
    scale,
  );
  // No off-view cards exist in this graph. Its strict, unadorned build is the
  // native baseline, retaining the same view caption and route geometry.
  const reference = required(
    buildGridCandidates(
      p,
      page,
      undefined,
      false,
      scale,
      b,
      [{ bank: zeroBank, grid }],
      constraint,
    ).candidates[0],
  );
  beginFramePlanning(page, reference);
  const result = buildGridCandidates(
    p,
    page,
    undefined,
    false,
    scale,
    b,
    [
      { bank: positiveBank, grid },
      { bank: zeroBank, grid },
    ],
    constraint,
  );
  const run: RootedSearch = {
    candidates: [],
    native: [reference],
    errors: [],
    nativeErrors: new Map(),
    prepared: [],
    attempts: 0,
    tried: new Set(),
  };
  return { page, run, candidates: result.candidates };
}
it("visits positive bank candidates until the later zero-loss settlement", () => {
  const { page, run, candidates } = settlementCandidates();
  const positive = required(candidates[0]);
  expect(frameBudgetFailure(positive, page)).toBeUndefined();
  expect(candidateLosses(positive, page)).toEqual([
    1.4739671392031966, 0.7369835696015983,
  ]);
  // This exact candidate and native baseline pass every independent route,
  // page and content guard. Only the active frame guard can prevent settlement.
  expect(searchSettled({ ...run, candidates: [positive] }, { ...page })).toBe(
    true,
  );
  const visited: number[][] = [];
  for (const candidate of candidates) {
    run.candidates.push(candidate);
    visited.push(candidateLosses(candidate, page));
    if (searchSettled(run, page)) break;
  }
  expect(visited).toHaveLength(4);
  expect(candidateLosses(required(rootedWinner(run, page)), page)).toEqual([
    0, 0,
  ]);
  expect(required(compactPlanningReceipts(page)[0]).candidates).toHaveLength(4);
});
