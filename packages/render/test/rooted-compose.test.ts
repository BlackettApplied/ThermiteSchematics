import { afterEach, expect, it, vi } from "vitest";
import type { ElectricalIr } from "@thermite/compiler";
import { composeRootedWinner } from "../src/packet/rooted-compose.js";
import { compositionFits } from "../src/packet/composition-fit.js";
import { sideSections } from "../src/packet/fold-side.js";
import * as emitter from "../src/svg/emitter.js";
import * as layout from "../src/layout/elk-adapter.js";
import * as scores from "../src/packet/rooted-score.js";
import * as routes from "../src/packet/rooted-clipped-routes.js";
import * as resolve from "../src/packet/continuation-resolve.js";
import * as labels from "../src/packet/continuation-label.js";
import * as captions from "../src/packet/rooted-caption.js";
import { PacketDraftError } from "../src/packet/errors.js";
import {
  sideCandidate,
  sidePage,
  fixtureInk,
} from "./helpers/side-candidate.js";
const ir = {} as ElectricalIr;
afterEach(() => vi.restoreAllMocks());
function source() {
  const c = sideCandidate();
  vi.spyOn(emitter, "emitSchematicSvg").mockReturnValue({
    ok: true,
    value: `<svg>${fixtureInk}</svg>`,
  });
  return c;
}
it("compares at most the winner and one materialized alternative with no ELK work", () => {
  const c = source(),
    snapshot = structuredClone(c);
  const elk = vi.spyOn(layout, "layoutPresentationGraph");
  const compare = vi.spyOn(scores, "compareCandidates");
  const selected = composeRootedWinner(ir, c, c, sidePage);
  expect(selected).not.toBe(c);
  expect(selected.drafts).toHaveLength(1);
  expect(selected.prepared).toBe(c.prepared); // Phase/gang geometry and owners are unchanged.
  expect(selected.grid).toBe(c.grid);
  expect(selected.scale).toBe(c.scale);
  expect(c).toEqual(snapshot);
  expect(elk).not.toHaveBeenCalled();
  expect(emitter.emitSchematicSvg).toHaveBeenCalledTimes(1);
  expect(compare).toHaveBeenCalledTimes(1);
  expect(compare).toHaveBeenCalledWith(
    selected,
    c,
    c.jogs,
    sidePage,
    c.detours,
    c,
    c,
  );
});
it("does not materialize another state when an eligible grouping does not exist", () => {
  const c = source();
  c.grid.xs.push(500);
  expect(composeRootedWinner(ir, c, c, sidePage)).toBe(c);
  expect(emitter.emitSchematicSvg).not.toHaveBeenCalled();
});
it.each([false, true])(
  "rejects per-identity route growth before any page saving (clipped=%s)",
  (clipped) => {
    const c = source();
    vi.spyOn(routes, "routeGrowth").mockImplementation((_a, _b, mode = true) =>
      mode === clipped ? [0, 0, 1, 0.25] : [0, 0, 0, 0],
    );
    expect(composeRootedWinner(ir, c, c, sidePage)).toBe(c);
  },
);
it("uses the D2 comparator rather than accepting every shorter alternative", () => {
  const c = source();
  vi.spyOn(scores, "compareCandidates").mockReturnValue(1);
  expect(composeRootedWinner(ir, c, c, sidePage)).toBe(c);
});
it("treats failed re-emission of a validated winner as a defensive invariant", () => {
  const c = source();
  vi.mocked(emitter.emitSchematicSvg).mockReturnValue({
    ok: false,
    error: {
      code: "R004",
      root: "fixture",
      reason: "invalid-layout",
      message: "Fixture refuses",
    },
  } as never);
  expect(() => composeRootedWinner(ir, c, c, sidePage)).toThrow(
    "Presentation invariant: Validated rooted winner failed re-emission during composition",
  );
});
it("rejects final peer, page-cost and post-trim caption failures", () => {
  const c = source(),
    drafts = sideSections(c, fixtureInk)!;
  const alternative = { ...c, drafts };
  expect(compositionFits(alternative, c, sidePage)).toBe(true);
  const broken = structuredClone(drafts);
  broken[0]!.links[0]!.to = 12;
  expect(compositionFits({ ...c, drafts: broken }, c, sidePage)).toBe(false);
  expect(compositionFits(alternative, { ...c, drafts: [] }, sidePage)).toBe(
    false,
  );
  vi.spyOn(captions, "postTrimCaptionConstraint").mockReturnValue(
    "Lengthened caption cannot fit",
  );
  expect(composeRootedWinner(ir, c, c, sidePage)).toBe(c);
});
it.each(["reciprocity", "ink"])(
  "retains the original for the expected %s invariant",
  (kind) => {
    const c = source(),
      error =
        kind === "ink"
          ? new labels.ContinuationLabelError("Final ink is too wide")
          : new PacketDraftError("Missing reciprocal peer", []);
    if (kind === "ink")
      vi.spyOn(labels, "continuationLabelSvg").mockImplementation(() => {
        throw error;
      });
    else
      vi.spyOn(resolve, "resolveRootedContinuations").mockImplementation(() => {
        throw error;
      });
    expect(composeRootedWinner(ir, c, c, sidePage)).toBe(c);
  },
);
it.each(["emitter", "peer", "label"])(
  "propagates unrelated %s errors",
  (kind) => {
    const c = source(),
      error = new TypeError("Unrelated implementation failure");
    const fail = () => {
      throw error;
    };
    if (kind === "emitter")
      vi.spyOn(emitter, "emitSchematicSvg").mockImplementation(fail);
    if (kind === "peer")
      vi.spyOn(resolve, "resolveRootedContinuations").mockImplementation(fail);
    if (kind === "label")
      vi.spyOn(labels, "continuationLabelSvg").mockImplementation(fail);
    expect(() => composeRootedWinner(ir, c, c, sidePage)).toThrow(error);
  },
);

it("checks adjacent continued-caption ink against other captions after translation", () => {
  const c = source(),
    drafts = sideSections(c, fixtureInk)!;
  drafts[0]!.links = [];
  drafts[0]!.rootedCaptionInk = [captions.textInk("LOCATION", 30, 46, 2.5)];
  const alternative = { ...c, drafts };
  expect(compositionFits(alternative, c, sidePage)).toBe(true);
  drafts[0]!.rootedCaptionInk.push(captions.textInk("LOCATION", 31, 46, 2.5));
  expect(compositionFits(alternative, c, sidePage)).toBe(false);
});
it("rejects final frame/notice clearance after translated link anchors change", () => {
  const c = source(),
    drafts = sideSections(c, fixtureInk)!;
  const alternative = { ...c, drafts };
  expect(compositionFits(alternative, c, sidePage)).toBe(true);
  drafts[0]!.links[0]!.x = 2;
  expect(compositionFits(alternative, c, sidePage)).toBe(false);
});
