import { afterEach, expect, it, vi } from "vitest";
import type { ElectricalIr } from "@thermite/compiler";
import { sideSections } from "../src/packet/fold-side.js";
import { composeRootedWinner } from "../src/packet/rooted-compose.js";
import { compositionFits } from "../src/packet/composition-fit.js";
import { postTrimCaptionConstraint } from "../src/packet/rooted-caption.js";
import * as emitter from "../src/svg/emitter.js";
import { sideLocation } from "./helpers/side-location.js";
import { sidePage } from "./helpers/side-candidate.js";
const ir = {} as ElectricalIr;
afterEach(() => vi.restoreAllMocks());
it("checks a caption that only becomes too long after horizontal trimming", () => {
  const { candidate: c, inner } = sideLocation(6);
  expect(c.drafts.every((d) => !d.continuedCaption)).toBe(true);
  expect(compositionFits(c, c, sidePage)).toBe(true);
  const trimmed = sideSections(c, inner)!;
  expect(trimmed[0]!.continuedCaption).toContain("LOCATION-5");
  expect(postTrimCaptionConstraint(trimmed, sidePage)).toMatch(/header width/u);
  vi.spyOn(emitter, "emitSchematicSvg").mockReturnValue({
    ok: true,
    value: `<svg>${inner}</svg>`,
  });
  expect(composeRootedWinner(ir, c, c, sidePage)).toBe(c);
});
it("omits only the original heading wholly outside all final horizontal viewports", () => {
  const { candidate: c, inner } = sideLocation(1, 0, 200, 100);
  expect(c.drafts[0]!.content).toContain('class="label-location"');
  vi.spyOn(emitter, "emitSchematicSvg").mockReturnValue({
    ok: true,
    value: `<svg>${inner}</svg>`,
  });
  const selected = composeRootedWinner(ir, c, c, sidePage);
  expect(selected).not.toBe(c);
  expect(selected.drafts[0]!.content).toContain("CONTINUED LOCATION: FIELD");
  expect(selected.drafts[0]!.content).not.toContain('class="label-location"');
  expect(c.drafts[0]!.content).toContain('class="label-location"');
});
it("expands a partly intersected X heading and retains the original text", () => {
  const { candidate: c, inner } = sideLocation(1, 90, 300);
  vi.spyOn(emitter, "emitSchematicSvg").mockReturnValue({
    ok: true,
    value: `<svg>${inner}</svg>`,
  });
  const selected = composeRootedWinner(ir, c, c, sidePage);
  expect(selected).not.toBe(c);
  expect(selected.drafts[0]!.rootedSections![0]!.viewport.x).toBeLessThan(90);
  expect(selected.drafts[0]!.content).toContain('class="label-location"');
});
