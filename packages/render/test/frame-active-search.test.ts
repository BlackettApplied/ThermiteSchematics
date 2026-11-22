import { beforeAll, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import {
  compileProject,
  type CompiledProjectPresentation,
  type ElectricalIr,
} from "@thermite/compiler";
import { drawingDrafts } from "../src/packet/rooted.js";
import {
  beginFramePlanning,
  frameCandidate,
  candidateLosses,
  compactPlanningReceipts,
  frameBudgetFailure,
} from "../src/packet/frame-budget.js";
import {
  searchRootedCandidates,
  rootedWinner,
  nativeWinner,
} from "../src/packet/rooted-search.js";
import {
  buildRootedCandidates,
  rootedSpace,
} from "../src/packet/rooted-build.js";
import { compareCandidates } from "../src/packet/rooted-score.js";
import { searchSettled } from "../src/packet/rooted-settled.js";
import { normalizePaperPage } from "../src/packet/page.js";
import { useCompactFrame } from "../src/packet/frame-profile.js";
import { required } from "./fixtures.js";
let ir: ElectricalIr, presentation: CompiledProjectPresentation;
beforeAll(async () => {
  const compiled = await compileProject(
    fileURLToPath(new URL("../../../examples/machine-demo/", import.meta.url)),
  );
  if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
  ir = compiled.ir;
  presentation = compiled.presentation;
});
const requests = {
  M1: {
    format: "schematic-view-request/0.1",
    root: { by: "designation", value: "M1" },
    family: "power",
    flow: "left-to-right",
  },
  LS1: {
    format: "schematic-view-request/0.2",
    root: { by: "designation", value: "LS1" },
    intent: {
      kind: "trace",
      to: { by: "designation", value: "PLC1" },
      includePower: true,
    },
    flow: "left-to-right",
  },
  LS2: {
    format: "schematic-view-request/0.2",
    root: { by: "designation", value: "LS2" },
    intent: {
      kind: "trace",
      to: { by: "designation", value: "RIO1" },
      includePower: true,
    },
    flow: "left-to-right",
  },
} as const;
async function active(root: keyof typeof requests) {
  const normalized = normalizePaperPage({
    size: "a3",
    orientation: "landscape",
  });
  if (!normalized.ok) throw Error(normalized.error.message);
  const page = normalized.value,
    request = requests[root];
  const legacy = await drawingDrafts(
    ir,
    request,
    presentation,
    page,
    "compact",
  );
  if (!legacy.ok) throw Error(legacy.error.message);
  const reference = frameCandidate(legacy.value);
  useCompactFrame(page);
  beginFramePlanning(page, reference);
  const run = await searchRootedCandidates(
    ir,
    request,
    presentation,
    page,
    true,
  );
  return { reference, page, run, winner: required(rootedWinner(run, page)) };
}
it("the saved legacy-reference layout uniquely wins the real M1 search", async () => {
  const { reference, page, run, winner } = await active("M1");
  expect(frameBudgetFailure(winner, page)).toBeUndefined();
  expect(winner.prepared).toBe(reference.prepared);
  const native = required(nativeWinner(run));
  const alternatives = run.candidates.filter((c) => c !== winner);
  expect(alternatives.length).toBeGreaterThan(0);
  for (const other of alternatives)
    expect(
      compareCandidates(
        winner,
        other,
        native.jogs,
        page,
        native.detours,
        native,
        run.localityReference,
      ),
    ).toBeLessThan(0);
  expect(candidateLosses(winner, page)).toEqual([0]);
}, 30000);
it("an active positive-loss search remains unsettled until its later zero-loss candidate", async () => {
  const { page, run, winner } = await active("LS1");
  const positive = required(
    run.candidates.find(
      (c) =>
        !frameBudgetFailure(c, page) &&
        candidateLosses(c, page).some((loss) => loss > 0),
    ),
  );
  expect(candidateLosses(winner, page)).toEqual([0]);
  expect(run.attempts).toBe(11);
  const attempts = required(compactPlanningReceipts(page)[0]).candidates;
  const positiveIndex = attempts.findIndex(
    (a) => !a.failure && a.pages === 1 && a.losses.some((n) => n > 0 && n <= 2),
  );
  const zeroIndex = attempts.findIndex(
    (a) => !a.failure && a.pages === 1 && a.losses.every((n) => n === 0),
  );
  expect(positiveIndex).toBeGreaterThanOrEqual(0);
  expect(zeroIndex).toBeGreaterThan(positiveIndex);
  // Replay actual candidates against the search's real native baseline. A page
  // clone omits only the private frame context, proving every other settlement
  // guard passes for the positive-loss candidate.
  expect(searchSettled({ ...run, candidates: [positive] }, { ...page })).toBe(
    true,
  );
  expect(searchSettled({ ...run, candidates: [positive] }, page)).toBe(false);
  expect(searchSettled({ ...run, candidates: [winner] }, page)).toBe(true);
}, 30000);
it("a different saved legacy scale binds actual candidate construction", async () => {
  const { page, run, reference } = await active("LS2");
  const ordinary = required(
    run.prepared.find(
      ({ p, profile }) =>
        rootedSpace(p, page, !!profile).scale !== reference.scale,
    ),
  );
  const unframed = buildRootedCandidates(
    ir,
    ordinary.p,
    { ...page },
    ordinary.profile,
  );
  const framed = buildRootedCandidates(ir, ordinary.p, page, ordinary.profile);
  expect(unframed.ok).toBe(true);
  expect(framed.ok).toBe(true);
  if (!unframed.ok || !framed.ok) throw Error("Scale fixture did not build");
  expect(required(unframed.value[0]).scale).not.toBe(reference.scale);
  expect(framed.value.map((c) => c.scale)).toEqual(
    framed.value.map(() => reference.scale),
  );
  expect(reference.scale).toBeCloseTo(0.3184601924759405, 14);
}, 30000);
