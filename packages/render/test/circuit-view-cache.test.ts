import { afterEach, expect, it, vi } from "vitest";
import {
  circuitInlineContext,
  circuitLayoutContext,
} from "../src/layout/circuit-inline-context.js";
import { nextCircuitLayoutRun } from "../src/layout/circuit-inline.js";
import type { ElectricalIr } from "@thermite/compiler";
import * as rooted from "../src/packet/rooted.js";
import { viewDrafts } from "../src/packet/dispatch.js";
import { failure } from "../src/packet/errors.js";
import { normalizePaperPage } from "../src/packet/page.js";
import { cachedCircuitView } from "../src/layout/circuit-view-cache.js";

afterEach(() => vi.restoreAllMocks());

it("reuses an unchanged pre-assembly view and isolates assembly mutations", async () => {
  const context = circuitLayoutContext(),
    ir = {};
  const work = vi.fn(async () => {
    nextCircuitLayoutRun();
    return {
      ok: true as const,
      value: { content: "original", links: [{ to: 1 }] },
    };
  });
  await circuitInlineContext.run(context, async () => {
    const first = await cachedCircuitView(ir, undefined, ["view", 0], work);
    if (!first.ok) throw Error("Expected view");
    first.value.links[0]!.to = 99;
    context.qualityPhase = true;
    context.cursor = 0;
    const second = await cachedCircuitView(ir, undefined, ["view", 0], work);
    expect(second).toEqual({
      ok: true,
      value: { content: "original", links: [{ to: 1 }] },
    });
    expect(work).toHaveBeenCalledTimes(1);
    if (!second.ok) throw Error("Expected view");
    second.value.content = "assembly changes";
    context.cursor = 0;
    expect(await cachedCircuitView(ir, undefined, ["view", 0], work)).toEqual({
      ok: true,
      value: { content: "original", links: [{ to: 1 }] },
    });
    expect(context.cursor).toBe(1);
    expect(context.currentRun).toBe(context.runs[0]);
    expect(context.runs[0]!.quality).toBe(false);
    expect(work).toHaveBeenCalledTimes(1);
  });
});

it("recomputes a changed selection and replays every run on subsequent reuse", async () => {
  const context = circuitLayoutContext(),
    ir = {};
  const work = vi.fn(async () => ({
    ok: true as const,
    value: [nextCircuitLayoutRun()!.quality, nextCircuitLayoutRun()!.quality],
  }));
  await circuitInlineContext.run(context, async () => {
    expect(await cachedCircuitView(ir, undefined, [], work)).toEqual({
      ok: true,
      value: [false, false],
    });
    context.qualityPhase = true;
    context.selected.add(1);
    context.cursor = 0;
    expect(await cachedCircuitView(ir, undefined, [], work)).toEqual({
      ok: true,
      value: [false, true],
    });
    context.cursor = 0;
    context.runs[0]!.quality = true;
    context.runs[1]!.quality = false;
    expect(await cachedCircuitView(ir, undefined, [], work)).toEqual({
      ok: true,
      value: [false, true],
    });
    expect(context.runs.map((r) => r.quality)).toEqual([false, true]);
    expect(context.cursor).toBe(2);
    expect(context.currentRun).toBe(context.runs[1]);
    context.selected.clear();
    context.cursor = 0;
    expect(await cachedCircuitView(ir, undefined, [], work)).toEqual({
      ok: true,
      value: [false, false],
    });
    expect(work).toHaveBeenCalledTimes(2);
  });
});

it.each([0, 1, 2, 3, 4])(
  "includes dispatch input field %i in reuse eligibility",
  async (field) => {
    const context = circuitLayoutContext(),
      ir = {},
      presentation = {};
    const work = vi.fn(async () => ({ ok: true as const, value: "draft" }));
    const input: unknown[] = [
      { root: "M1" },
      { size: "letter" },
      "standard",
      [["function", ["appearance"]]],
      0,
    ];
    await circuitInlineContext.run(context, async () => {
      await cachedCircuitView(ir, presentation, input, work);
      context.qualityPhase = true;
      const changed = structuredClone(input);
      changed[field] = "changed";
      await cachedCircuitView(ir, presentation, changed, work);
      expect(work).toHaveBeenCalledTimes(2);
    });
  },
);

it.each(["ir", "presentation", "cursor"])(
  "does not reuse a changed %s",
  async (field) => {
    const context = circuitLayoutContext(),
      ir = {},
      presentation = {};
    const work = vi.fn(async () => {
      nextCircuitLayoutRun();
      return { ok: true as const, value: "draft" };
    });
    await circuitInlineContext.run(context, async () => {
      await cachedCircuitView(ir, presentation, [], work);
      context.qualityPhase = true;
      if (field === "cursor") nextCircuitLayoutRun();
      context.cursor = field === "cursor" ? 1 : 0;
      await cachedCircuitView(
        field === "ir" ? {} : ir,
        field === "presentation" ? {} : presentation,
        [],
        work,
      );
      expect(work).toHaveBeenCalledTimes(2);
    });
  },
);

it("isolates packets, leaves calls outside a search uncached and propagates errors", async () => {
  const ir = {},
    work = vi.fn(async () => ({ ok: true as const, value: "draft" }));
  for (const context of [circuitLayoutContext(), circuitLayoutContext()])
    await circuitInlineContext.run(context, async () => {
      context.qualityPhase = true;
      await cachedCircuitView(ir, undefined, [], work);
      await cachedCircuitView(ir, undefined, [], work);
    });
  expect(work).toHaveBeenCalledTimes(2);
  await cachedCircuitView(ir, undefined, [], work);
  await cachedCircuitView(ir, undefined, [], work);
  expect(work).toHaveBeenCalledTimes(4);
  await circuitInlineContext.run(circuitLayoutContext(), async () => {
    const failure = vi.fn(async () => {
      throw new Error("synthetic programming error");
    });
    await expect(cachedCircuitView(ir, undefined, [], failure)).rejects.toThrow(
      "synthetic programming error",
    );
  });
});

it.each(["same", "view", "page", "layout", "appearances", "offset"] as const)(
  "dispatch reuse respects %s inputs",
  async (change) => {
    const context = circuitLayoutContext(),
      ir = {} as ElectricalIr;
    const drawing = vi
      .spyOn(rooted, "drawingDrafts")
      .mockImplementation(async () => {
        nextCircuitLayoutRun();
        return { ok: true, value: [] };
      });
    const page = normalizePaperPage({
      size: "letter",
      orientation: "landscape",
    });
    if (!page.ok) throw Error("Expected paper");
    const view = {
      format: "schematic-view-request/0.1",
      family: "power",
      flow: "left-to-right",
      root: { by: "designation", value: "M1" },
    };
    await circuitInlineContext.run(context, async () => {
      await viewDrafts(
        ir,
        view,
        undefined,
        page.value,
        "standard",
        new Map(),
        0,
      );
      context.qualityPhase = true;
      context.cursor = 0;
      await viewDrafts(
        ir,
        change === "view"
          ? { ...view, root: { by: "designation", value: "M2" } }
          : view,
        undefined,
        change === "page"
          ? { ...page.value, widthMm: page.value.widthMm + 1 }
          : page.value,
        change === "layout" ? "compact" : "standard",
        change === "appearances"
          ? new Map([["function", ["appearance"]]])
          : new Map(),
        change === "offset" ? 1 : 0,
      );
      expect(drawing).toHaveBeenCalledTimes(change === "same" ? 1 : 2);
    });
  },
);

it("does not retain failed view composition as reusable work", async () => {
  const context = circuitLayoutContext(),
    ir = {};
  const work = vi.fn(async () =>
    failure("unprintable-layout", "synthetic fit failure"),
  );
  await circuitInlineContext.run(context, async () => {
    context.qualityPhase = true;
    await cachedCircuitView(ir, undefined, [], work);
    await cachedCircuitView(ir, undefined, [], work);
    expect(work).toHaveBeenCalledTimes(2);
  });
});
