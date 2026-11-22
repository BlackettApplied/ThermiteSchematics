import { afterEach, expect, it, vi } from "vitest";
import { compileProject } from "@thermite/compiler";
import {
  fitLegendDrafts,
  type legendSheets,
} from "../src/packet/device-legend.js";
import type { Draft } from "../src/packet/types.js";
import { required } from "../src/presentation/util.js";
import { sideCandidate, sidePage } from "./helpers/side-candidate.js";
import * as pagination from "../src/packet/legend-pagination.js";

afterEach(() => vi.restoreAllMocks());

function failure(): Extract<ReturnType<typeof legendSheets>, { ok: false }> {
  return {
    ok: false,
    error: {
      code: "R006",
      root: "CB1",
      reason: "unprintable-layout",
      message:
        "Device CB1 legend field description cannot be placed: raw message",
      details: {
        device: "CB1",
        field: "description",
        capacityKind: "free-region",
        legendEntries: [{ designation: "CB1", kind: "body" }],
        requiredWidthMm: 20,
        requiredHeightMm: 10,
        availableWidthMm: 5,
        availableHeightMm: 5,
      },
    },
    failedSheet: 0,
  };
}

function fixture(rooted: boolean) {
  const candidate = sideCandidate(1),
    source = required(candidate.drafts[0], "Fixture draft"),
    context = { viewIndex: 0, title: "Plain view" };
  const plain: Draft = {
    view: source.view,
    title: source.title,
    content: source.content,
    links: [],
    note: source.note,
  };
  const draft: Draft = {
    ...(rooted ? { ...source, rootedBank: candidate.bank } : plain),
    views: [context],
  };
  return { drafts: [draft], context };
}

it.each([false, true])(
  "preserves the device failure byte-for-byte with zero candidates (rooted: %s)",
  async (rooted) => {
    const compiled = await compileProject("examples/motor-starter");
    if (!compiled.ok) throw Error("Fixture compilation failed");
    const { drafts, context } = fixture(rooted);
    expect(drafts[0]?.rootedPartAxis).toBeUndefined();
    expect(drafts[0]?.rootedLegendSource).toBeUndefined();
    expect(!!drafts[0]?.rootedSections).toBe(rooted);
    const original = failure();
    const render = vi.fn(() => original);
    const result = fitLegendDrafts(
      compiled.ir,
      drafts,
      [{ drafts, viewIndex: 0, context }],
      sidePage,
      undefined,
      render,
    );
    expect(render).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(false);
    if (result.ok) throw Error("Expected the original legend failure");
    expect(result.error.message).toBe(original.error.message);
    expect(result.error).toHaveProperty("root", "CB1");
    expect(JSON.stringify(result)).toBe(JSON.stringify(original));
    expect(result).toBe(original);
  },
);

it("keeps fallback wording when the real sheet-limit check rejects a candidate", async () => {
  const compiled = await compileProject("examples/motor-starter");
  if (!compiled.ok) throw Error("Fixture compilation failed");
  const { drafts, context } = fixture(true);
  const large = Array.from({ length: 101 }, () =>
    structuredClone(required(drafts[0], "Fixture draft")),
  );
  required(large[0], "First candidate draft").rootedFit = {
    basePages: 51,
    actualPages: 101,
    context: "Synthetic packet limit",
  };
  vi.spyOn(pagination, "legendPagination").mockImplementation(function* () {
    yield large;
  });
  const render = vi.fn(() => failure());
  const result = fitLegendDrafts(
    compiled.ir,
    drafts,
    [{ drafts, viewIndex: 0, context }],
    sidePage,
    undefined,
    render,
  );
  expect(render).toHaveBeenCalledTimes(1);
  expect(result.ok).toBe(false);
  if (result.ok) throw Error("Expected the recorded sheet-limit failure");
  expect(result.error).toHaveProperty("root", "packet");
  expect(result.error.message).toContain(
    "recorded pruning at the 100-sheet packet limit",
  );
  expect(result.error.message).not.toContain("page-cost bound");
});
