import { afterEach, expect, it, vi } from "vitest";
import { rootedNoticeLines, rootedNoticeSvg } from "../src/off-view/notice.js";
import type { NormalizedSchematicView } from "../src/types.js";
import * as metrics from "../src/text-metrics.js";
import { parseSvg } from "./off-view-fixtures.js";
const view = {
  format: "schematic-view/0.1",
  root: { designation: "K1" },
  family: "control",
} as NormalizedSchematicView;
afterEach(() => vi.restoreAllMocks());
it.each([60, 80, 100, 120, 160, 200, 360])(
  "prints the complete generic warning with no empty line at %s mm",
  (width) => {
    const reserved = rootedNoticeLines(view, width, 2.7).length;
    const svg = rootedNoticeSvg(view, 10, 20, width, 2.7, 4);
    const texts = [...parseSvg(svg).querySelectorAll("text")];
    expect(texts.every((t) => !!t.textContent?.trim())).toBe(true);
    const body = texts.filter((t) => t.getAttribute("font-weight") !== "700");
    expect(
      body
        .map((t) => t.textContent)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim(),
    ).toBe(
      "Selected path only; other authored connections may be outside this view.",
    );
    expect(texts.length).toBeLessThanOrEqual(reserved);
  },
);
it("refuses an overflow rather than silently dropping the new warning's tail", () => {
  vi.spyOn(metrics, "wrapText").mockImplementation((text) =>
    text.startsWith("Selected path only")
      ? [
          "Selected path only;",
          "other authored connections may be outside this view.",
        ]
      : [text],
  );
  expect(() => rootedNoticeSvg(view, 10, 20, 360, 2.7, 4)).toThrow(
    /notice.*reservation/i,
  );
});
