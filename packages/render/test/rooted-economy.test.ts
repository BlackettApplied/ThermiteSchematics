import { expect, it, vi, afterEach } from "vitest";
import type { ElectricalIr } from "@thermite/compiler";
import { placements } from "../src/packet/rooted-placements.js";
import {
  validateEconomyCandidate,
  economyExhausted,
} from "../src/packet/rooted-economy.js";
import * as prepared from "../src/off-view/prepared.js";
import * as build from "../src/packet/rooted-build.js";
import * as choices from "../src/off-view/choices.js";
import type { RootedSearch } from "../src/packet/rooted-search.js";
const page = {
  size: "tabloid",
  orientation: "landscape",
  widthMm: 431.8,
  heightMm: 279.4,
  marginMm: 10,
} as const;
const request = {
  format: "schematic-view-request/0.1",
  family: "control",
  root: { by: "designation", value: "K1" },
} as const;
const ir = {} as ElectricalIr;
function setup(initial = false) {
  const p = {
    graph: { edges: [], nodes: [] },
    layout: { edges: [], ports: [], labels: [], width: 100, height: 100 },
  } as unknown as build.RootedCandidate["prepared"];
  const draft = () => ({
    links: [],
    rootedContent: { figures: 1, conductors: 1 },
    content: "",
    references: [],
    drawingBounds: { x: 20, y: 40, w: 240, h: 160 },
  });
  const candidate = {
    prepared: p,
    scale: 1,
    grid: { xs: [0, 100], ys: [0, 100] },
    drafts: Array.from({ length: 3 }, draft),
    jogs: new Map(),
    detours: new Map(),
    proximity: 0,
  } as unknown as build.RootedCandidate;
  const native = {
    ...candidate,
    drafts: Array.from({ length: 2 }, draft),
  } as unknown as build.RootedCandidate;
  const run: RootedSearch = {
    standardEconomy: true,
    candidates: initial ? [candidate] : [],
    native: [native],
    prepared: [{ p, profile: undefined }],
    errors: [],
    nativeErrors: new Map(),
    attempts: 0,
    tried: new Set(),
  };
  vi.spyOn(prepared, "repositionDrawing").mockResolvedValue({
    ok: true,
    value: p,
  });
  vi.spyOn(choices, "placementChoices").mockImplementation((_p, rank) => ({
    card: rank,
  }));
  vi.spyOn(choices, "cardGroups").mockReturnValue([]);
  vi.spyOn(build, "materializeRootedCandidate").mockImplementation(
    (_ir, c) => ({ ok: true, value: structuredClone(c.drafts) }),
  );
  return { run, candidate };
}
afterEach(() => vi.restoreAllMocks());
const failure = () => ({
  ok: false as const,
  error: {
    code: "R006" as const,
    root: "K1",
    reason: "unprintable-layout" as const,
    message: "Fixture: cut does not fit",
  },
});
it("keeps ordinary recovery past four failed alternatives and then starts economy", async () => {
  const { run, candidate } = setup();
  let attempts = 0;
  vi.spyOn(build, "buildRootedCandidates").mockImplementation(() =>
    ++attempts === 5 ? { ok: true, value: [candidate] } : failure(),
  );
  await placements(ir, request, undefined, page, run);
  expect(attempts).toBe(7); // Seven distinct uniform alternatives; no card groups.
  expect(run.economyStartedAt).toBe(5);
  expect(run.validatedCandidate).toBe(candidate);
  expect(run.localityReference).toBe(candidate);
  expect(run.settled).not.toBe(true);
});
it("exhausts four economy attempts without settling or losing the prior validated candidate", async () => {
  const { run, candidate } = setup(true);
  const attempt = vi
    .spyOn(build, "buildRootedCandidates")
    .mockImplementation(failure);
  validateEconomyCandidate(ir, run, page);
  expect(run.economyStartedAt).toBe(0);
  await placements(ir, request, undefined, page, run);
  expect(attempt).toHaveBeenCalledTimes(4);
  expect(economyExhausted(run)).toBe(true);
  expect(run.validatedCandidate).toBe(candidate);
  expect(run.localityReference).toBe(candidate);
  expect(run.candidates).toContain(candidate);
  expect(run.settled).not.toBe(true);
});
it("does not start the cap for a final materialization or page-cost failure", () => {
  const { run, candidate } = setup(true);
  candidate.drafts.push(...structuredClone(candidate.drafts));
  validateEconomyCandidate(ir, run, page);
  expect(run.economyStartedAt).toBeUndefined();
  candidate.drafts.length = 3;
  vi.mocked(build.materializeRootedCandidate).mockReturnValue(failure());
  validateEconomyCandidate(ir, run, page);
  expect(run.economyStartedAt).toBeUndefined();
});

it.each([true, false])(
  "binds locality only after a route-unsafe initial candidate is repaired (standard=%s)",
  (standard) => {
    const { run, candidate } = setup(true);
    run.standardEconomy = standard;
    const wire = { kind: "wire", uid: "authored-wire" };
    candidate.prepared = {
      ...candidate.prepared,
      graph: {
        ...candidate.prepared.graph,
        edges: [{ id: "edge", kind: "conductor", elementIds: [wire] }],
      },
      layout: {
        ...candidate.prepared.layout,
        edges: [
          {
            id: "edge",
            points: [
              { x: 0, y: 0 },
              { x: 0, y: 10 },
              { x: 1, y: 10 },
              { x: 1, y: 20 },
            ],
          },
        ],
      },
    } as unknown as build.RootedCandidate["prepared"];
    candidate.drafts[0]!.rootedSections = [
      { viewport: { x: 0, y: 0, w: 100, h: 100 }, continuedLocationIds: [] },
    ];
    validateEconomyCandidate(ir, run, page);
    expect(candidate.printableDrafts).toBeDefined();
    expect(run.localityReference).toBeUndefined();
    expect(run.economyStartedAt).toBe(standard ? 0 : undefined);
    const safe = { ...candidate, prepared: run.native[0]!.prepared };
    run.candidates = [safe];
    run.attempts = 2;
    validateEconomyCandidate(ir, run, page);
    expect(run.localityReference).toBe(safe);
    expect(run.economyStartedAt).toBe(standard ? 0 : undefined);
    run.candidates = [{ ...safe }];
    validateEconomyCandidate(ir, run, page);
    expect(run.localityReference).toBe(safe);
  },
);

it.each(["reciprocity", "unresolved label", "final ink"])(
  "keeps recovery available when an intermediate winner fails %s",
  async (kind) => {
    const { run, candidate } = setup(true);
    const { continuationLabel } =
      await import("../src/packet/continuation-label.js");
    const first = {
      id: "C001",
      conductor: "W1",
      netId: "N1",
      to: 2,
      end: 0 as const,
      side: "right" as const,
      x: 100,
      y: 100,
    };
    const second = { ...first, to: 1, end: 1 as const };
    if (kind === "final ink") {
      Object.assign(first, { label: continuationLabel(first, 1, 1) });
      Object.assign(second, { label: continuationLabel(second, 1, 1) });
    }
    candidate.drafts[0]!.links.push(first);
    if (kind !== "reciprocity") candidate.drafts[1]!.links.push(second);
    expect(() => validateEconomyCandidate(ir, run, page)).not.toThrow();
    expect(run.economyStartedAt).toBeUndefined();
    expect(run.validatedCandidate).toBeUndefined();
    expect(run.localityReference).toBeUndefined();
    expect(candidate.printableDrafts).toBeUndefined();
    const later = {
      ...candidate,
      drafts: candidate.drafts.slice(1).map((d) => ({ ...d, links: [] })),
    };
    vi.spyOn(build, "buildRootedCandidates").mockReturnValue({
      ok: true,
      value: [later],
    });
    await placements(ir, request, undefined, page, run);
    expect(run.validatedCandidate).toBe(later);
    expect(run.economyStartedAt).toBe(1);
    expect(run.settled).toBe(true);
  },
);
it.each(["resolve", "label"])(
  "propagates unrelated errors from %s checks",
  async (kind) => {
    const { run, candidate } = setup(true);
    const error = new TypeError("Unrelated implementation failure");
    if (kind === "resolve") {
      const module = await import("../src/packet/continuation-resolve.js");
      vi.spyOn(module, "resolveRootedContinuations").mockImplementation(() => {
        throw error;
      });
    } else {
      const module = await import("../src/packet/continuation-label.js");
      vi.spyOn(module, "continuationLabelSvg").mockImplementation(() => {
        throw error;
      });
      candidate.drafts[0]!.links.push({
        id: "C001",
        conductor: "W1",
        netId: "N1",
        to: 2,
        end: 0,
        side: "right",
        x: 100,
        y: 100,
      });
      candidate.drafts[1]!.links.push({
        ...candidate.drafts[0]!.links[0]!,
        end: 1,
        to: 1,
      });
    }
    expect(() => validateEconomyCandidate(ir, run, page)).toThrow(error);
    expect(run.economyStartedAt).toBeUndefined();
  },
);
it("holds one of the four economy attempts for the printed-jog retry", async () => {
  const { run } = setup(true);
  validateEconomyCandidate(ir, run, page);
  run.jogRetryReserved = true;
  vi.spyOn(build, "buildRootedCandidates").mockReturnValue(failure());
  await placements(ir, request, undefined, page, run);
  expect(prepared.repositionDrawing).toHaveBeenCalledTimes(3);
  expect(run.attempts).toBe(3);
  expect(economyExhausted(run)).toBe(true);
  delete run.jogRetryReserved;
  expect(economyExhausted(run)).toBe(false);
});
