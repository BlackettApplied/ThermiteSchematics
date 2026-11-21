import { beforeAll, afterEach, expect, it, vi } from "vitest";
import { compileProject, type ElectricalIr } from "@thermite/compiler";
import * as renderer from "../src/renderer.js";
import * as prepared from "../src/off-view/prepared.js";
import * as build from "../src/packet/rooted-build.js";
import * as compose from "../src/packet/rooted-compose.js";
import * as settled from "../src/packet/rooted-settled.js";
import * as economy from "../src/packet/rooted-economy.js";
import * as constraint from "../src/packet/rooted-constraint.js";
import * as placement from "../src/packet/rooted-placements.js";
import * as retry from "../src/packet/rooted-jog-repair.js";
import { searchRootedCandidates } from "../src/packet/rooted-search.js";
import { sideCandidate, sidePage } from "./helpers/side-candidate.js";
import { required } from "../src/presentation/util.js";

let ir: ElectricalIr;
beforeAll(async () => {
  const c = await compileProject("examples/motor-starter");
  if (!c.ok) throw Error("Synthetic test requires the shipped fixture");
  ir = c.ir;
});
afterEach(() => vi.restoreAllMocks());

type Kind = "hidden" | "printed" | "clipped" | "near-threshold";
function fixture(kind: Kind) {
  const candidate = sideCandidate(1);
  const view = candidate.prepared.view;
  if (view.format !== "schematic-view/0.1")
    throw Error("Expected legacy fixture");
  candidate.jogs.set("wire", 1);
  const edge = required(candidate.prepared.layout.edges[0], "Fixture edge");
  const dy = kind === "near-threshold" ? 2.999999 / candidate.scale : 8;
  const points = [
    { x: 100, y: 60 },
    { x: 150, y: 60 },
    { x: 150, y: 60 + dy },
    { x: 170, y: 60 + dy },
  ];
  candidate.prepared = {
    ...candidate.prepared,
    view: { ...view, family: "power" },
    layout: {
      ...candidate.prepared.layout,
      edges: candidate.prepared.layout.edges.map((e) =>
        e === edge ? { ...e, points } : e,
      ),
    },
  };
  const draft = required(candidate.drafts[0], "Fixture draft");
  const section = required(draft.rootedSections?.[0], "Fixture viewport");
  if (kind === "hidden") section.viewport = { x: 90, y: 50, w: 55, h: 50 };
  if (kind === "clipped") section.viewport = { x: 120, y: 50, w: 80, h: 50 };
  return candidate;
}
function setup(candidate: ReturnType<typeof sideCandidate>) {
  vi.spyOn(renderer, "prepareSchematicDrawing").mockResolvedValue({
    ok: true,
    value: candidate.prepared,
  });
  vi.spyOn(prepared, "nativeDrawing").mockResolvedValue({
    ok: true,
    value: candidate.prepared,
  });
  vi.spyOn(build, "buildRootedCandidates").mockReturnValue({
    ok: true,
    value: [candidate],
  });
  vi.spyOn(build, "materializeRootedCandidate").mockReturnValue({
    ok: true,
    value: candidate.drafts,
  });
  vi.spyOn(compose, "composeRootedWinner").mockImplementation((_ir, c) => c);
  vi.spyOn(constraint, "invariantCardConstraint").mockReturnValue(undefined);
  vi.spyOn(economy, "validateEconomyCandidate").mockReturnValue(undefined);
  vi.spyOn(settled, "searchSettled").mockReturnValue(false);
  vi.spyOn(retry, "repairSearchJogs").mockResolvedValue(undefined);
}
it.each(["hidden", "printed", "clipped", "near-threshold"] as const)(
  "reserves a standard-economy slot only for a %s printed trigger",
  async (kind) => {
    const candidate = fixture(kind);
    setup(candidate);
    const observed: { reserved: boolean; fourthAllowed: boolean }[] = [];
    vi.spyOn(placement, "placements").mockImplementation(
      async (_ir, _request, _presentation, _page, run) => {
        observed.push({
          reserved: !!run.jogRetryReserved,
          fourthAllowed: !economy.economyExhausted({
            ...run,
            attempts: 3,
            economyStartedAt: 0,
          }),
        });
      },
    );
    await searchRootedCandidates(
      ir,
      {
        format: "schematic-view-request/0.1",
        family: "power",
        flow: "top-to-bottom",
        root: { by: "designation", value: "M1" },
      },
      undefined,
      sidePage,
      false,
    );
    const printed = kind === "printed" || kind === "clipped";
    expect(observed).toEqual([{ reserved: printed, fourthAllowed: !printed }]);
  },
);
