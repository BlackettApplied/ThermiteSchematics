import { afterEach, expect, it, vi } from "vitest";
import assert from "node:assert/strict";
import { compileProject } from "@thermite/compiler";
import { renderSchematicPacket } from "../src/sheets.js";
import type { RenderFailure } from "../src/types.js";
import * as prepared from "../src/off-view/prepared.js";
import * as build from "../src/packet/rooted-build.js";
import { frameContext } from "../src/packet/frame-budget.js";
import { hasCompactFrame } from "../src/packet/frame-profile.js";
import * as retry from "../src/packet/rooted-jog-repair.js";
import * as pagination from "../src/packet/rooted-pagination-retry.js";
import * as search from "../src/packet/rooted-search.js";

afterEach(() => vi.restoreAllMocks());

it("can attempt jog repair on the reflowed legacy reference of a compact power view", async () => {
  const c = await compileProject("examples/motor-starter");
  assert.ok(c.ok);
  const failure: RenderFailure = {
    code: "R006",
    root: "packet",
    reason: "unprintable-layout",
    message: "Forced ordinary pagination miss.",
  };
  // Force the ordinary passes to miss so the compact search can only start
  // from the reflowed reference. ELK, the reference grid and jog repair are real.
  const runSearch = search.searchRootedCandidates;
  vi.spyOn(search, "searchRootedCandidates").mockImplementation(
    async (...args) => {
      const run = await runSearch(...args);
      if (hasCompactFrame(args[3])) return run;
      const annotated = run.prepared[0]?.p;
      const native = search.nativeWinner(run)?.prepared;
      assert.ok(annotated && native);
      return {
        ...run,
        candidates: [],
        errors: [failure],
        paginationRetry: {
          annotated,
          native,
          profile: undefined,
          spacing: { parentId: "root", axes: ["height"] },
        },
      };
    },
  );
  const candidates = build.buildRootedCandidates;
  vi.spyOn(build, "buildRootedCandidates").mockImplementation((...args) => {
    const [, drawing, page, , native] = args;
    const reference = frameContext(page, drawing.view)?.reference;
    return hasCompactFrame(page) && !native && reference?.prepared !== drawing
      ? { ok: false, error: failure }
      : candidates(...args);
  });
  const repaginate = vi.spyOn(pagination, "retryRootedPagination");
  const reposition = vi.spyOn(prepared, "repositionDrawing");
  const result = await renderSchematicPacket(
    c.ir,
    {
      format: "schematic-packet-request/0.1",
      page: { size: "tabloid", orientation: "landscape", marginMm: 10 },
      views: [
        {
          format: "schematic-view-request/0.1",
          family: "power",
          root: { by: "designation", value: "M1" },
          flow: "top-to-bottom",
        },
      ],
    },
    { ...c.presentation!, format: "project-presentation/0.3" },
  );
  const recovered = await repaginate.mock.results[0]?.value;
  assert.ok(recovered);
  const move = reposition.mock.calls.findIndex(
    ([drawing]) => drawing === recovered.winner.prepared,
  );
  expect(move).toBeGreaterThanOrEqual(0);
  const moved = await reposition.mock.results[move]?.value;
  assert.ok(moved?.ok, JSON.stringify(moved));
  assert.ok(result.ok, JSON.stringify(result));
});

it("leaves the recovered jog-free A3 compact TB packet identical with or without the retry", async () => {
  const c = await compileProject("examples/motor-starter");
  if (!c.ok) throw Error("Compile failed");
  const request = {
    format: "schematic-packet-request/0.1" as const,
    layout: "compact" as const,
    page: { size: "a3" as const, orientation: "landscape" as const },
    views: (["M1", "K1"] as const).map((value) => ({
      format: "schematic-view-request/0.1" as const,
      family: value === "M1" ? ("power" as const) : ("control" as const),
      flow: "top-to-bottom" as const,
      root: { by: "designation" as const, value },
    })),
  };
  const actual = await renderSchematicPacket(c.ir, request, c.presentation);
  if (!actual.ok) throw Error(actual.error.message);
  vi.spyOn(retry, "repairSearchJogs").mockResolvedValue(undefined);
  const ordinary = await renderSchematicPacket(c.ir, request, c.presentation);
  expect(actual).toEqual(ordinary);
  expect(actual.value.sheets).toHaveLength(2);
}, 30000);

it.each([
  ["motor-starter", "M1", false],
  ["machine-demo", "M2", true],
] as const)(
  "counts every %s recovery and retry in the existing placement budget",
  async (project, value, compact) => {
    const c = await compileProject("examples/" + project);
    if (!c.ok) throw Error("Compile failed");
    const prepared = await import("../src/off-view/prepared.js");
    const search = await import("../src/packet/rooted-search.js");
    const layouts = vi.spyOn(prepared, "repositionDrawing");
    const run = await search.searchRootedCandidates(
      c.ir,
      {
        format: "schematic-view-request/0.1",
        family: "power",
        flow: "top-to-bottom",
        root: { by: "designation", value },
      },
      c.presentation,
      {
        size: "tabloid",
        orientation: "landscape",
        widthMm: 431.8,
        heightMm: 279.4,
        marginMm: 10,
      },
      compact,
    );
    expect(layouts).toHaveBeenCalledTimes(run.attempts);
    expect(run.attempts).toBeLessThanOrEqual(search.MAX_PLACEMENT_LAYOUTS);
    expect(run.jogRetryReserved).toBeUndefined();
  },
  30000,
);
